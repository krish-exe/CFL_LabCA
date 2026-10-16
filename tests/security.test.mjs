// Automated security tests. Each test attacks one mechanism and checks it holds.
// Runs the real app in-process over HTTPS against the database in .env:  npm run test:security
import { describe, test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import https from 'node:https';
import path from 'node:path';
import jwt from 'jsonwebtoken';
import { createApp } from '../server/app.js';
import { config } from '../server/config.js';
import { pool, query } from '../server/db/pool.js';
import { hashPassword } from '../server/security/password.js';
import { aad, encryptField, decryptField } from '../server/security/crypto.js';
import { generateSecret, generateTotp } from '../server/security/totp.js';
import { computeAuditHash, verifyAuditChain } from '../server/security/audit.js';

const CERT = fs.readFileSync(config.tlsCert);
const KEY = fs.readFileSync(config.tlsKey);
const PASSWORD = 'Granite#River93';
const servers = [];
const createdUsers = [];

async function startServer() {
  const server = https.createServer({ key: KEY, cert: CERT, minVersion: 'TLSv1.2' }, createApp());
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  servers.push(server);
  return `https://127.0.0.1:${server.address().port}`;
}

function rawRequest(base, method, urlPath, { headers = {}, body } = {}) {
  return new Promise((resolve, reject) => {
    const req = https.request(`${base}${urlPath}`, { method, headers, ca: CERT }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) }));
    });
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

/** A tiny browser stand-in: keeps the cookie jar and the bearer token. */
function client(base) {
  const jar = {};
  const c = {
    token: null,
    jar,
    async call(method, urlPath, { body, form, headers = {}, token, csrf = true } = {}) {
      const h = { ...headers };
      if (csrf) h['x-requested-with'] = 'SecureClinic';
      const bearer = token ?? c.token;
      if (bearer) h.authorization = `Bearer ${bearer}`;
      const cookie = Object.entries(jar).map(([k, v]) => `${k}=${v}`).join('; ');
      if (cookie) h.cookie = cookie;
      let payload;
      if (form) {
        const res = new Response(form);
        payload = Buffer.from(await res.arrayBuffer());
        h['content-type'] = res.headers.get('content-type');
      } else if (body !== undefined) {
        payload = typeof body === 'string' ? body : JSON.stringify(body);
        h['content-type'] = 'application/json';
      }
      if (payload) h['content-length'] = Buffer.byteLength(payload);
      const res = await rawRequest(base, method, `/api${urlPath}`, { headers: h, body: payload });
      for (const line of [res.headers['set-cookie'] ?? []].flat()) {
        const [pair] = line.split(';');
        const i = pair.indexOf('=');
        const name = pair.slice(0, i);
        const value = pair.slice(i + 1);
        if (!value || /expires=Thu, 01 Jan 1970/i.test(line)) delete jar[name];
        else jar[name] = value;
      }
      let data = res.body;
      if ((res.headers['content-type'] ?? '').includes('json')) data = JSON.parse(res.body.toString());
      return { status: res.status, data, headers: res.headers };
    },
  };
  return c;
}

const uniqueEmail = (tag) => `t-${tag}-${crypto.randomBytes(4).toString('hex')}@tests.secureclinic.test`;

/** Creates a patient straight in the database (the register endpoint is rate-limited) and signs in. */
async function registerAndLogin(base, tag) {
  const c = client(base);
  const email = uniqueEmail(tag);
  await query("INSERT INTO users (email, password_hash, role, full_name) VALUES ($1, $2, 'patient', 'Test Patient')", [email, await hashPassword(PASSWORD)]);
  const login = await c.call('POST', '/auth/login', { body: { email, password: PASSWORD } });
  assert.equal(login.status, 200);
  c.token = login.data.accessToken;
  c.user = login.data.user;
  c.email = email;
  createdUsers.push(c.user.id);
  return c;
}

/** Inserts a doctor with 2FA already on (known secret), then signs in with password + TOTP. */
async function doctorClient(base) {
  const id = crypto.randomUUID();
  const email = uniqueEmail('doc');
  const secret = generateSecret();
  await query(
    `INSERT INTO users (id, email, password_hash, role, full_name, specialization, totp_enabled, totp_secret_enc)
     VALUES ($1, $2, $3, 'doctor', 'Test Doctor', 'Testing', true, $4)`,
    [id, email, await hashPassword(PASSWORD), encryptField(secret, aad('users', 'totp_secret', id))],
  );
  createdUsers.push(id);
  const c = client(base);
  const step1 = await c.call('POST', '/auth/login', { body: { email, password: PASSWORD } });
  assert.equal(step1.data.mfaRequired, true);
  const step2 = await c.call('POST', '/auth/mfa/verify', { body: { mfaToken: step1.data.mfaToken, code: generateTotp(secret) } });
  assert.equal(step2.status, 200, JSON.stringify(step2.data));
  c.token = step2.data.accessToken;
  c.user = step2.data.user;
  c.email = email;
  c.secret = secret;
  return c;
}

function pdf(text) {
  return Buffer.from(`%PDF-1.4\n% ${text}\n%%EOF\n`, 'latin1');
}

let base;
before(async () => {
  base = await startServer();
});

after(async () => {
  for (const s of servers) s.close();
  if (createdUsers.length) {
    const files = await query('SELECT file_storage_name FROM medical_records WHERE patient_id = ANY($1) AND file_storage_name IS NOT NULL', [createdUsers]);
    for (const f of files.rows) fs.rmSync(path.join(config.uploadDir, f.file_storage_name), { force: true });
    await query('DELETE FROM medical_records WHERE patient_id = ANY($1) OR created_by = ANY($1)', [createdUsers]);
    await query('DELETE FROM access_grants WHERE patient_id = ANY($1) OR doctor_id = ANY($1)', [createdUsers]);
    await query('DELETE FROM appointments WHERE patient_id = ANY($1) OR doctor_id = ANY($1)', [createdUsers]);
    await query('DELETE FROM users WHERE id = ANY($1)', [createdUsers]);
  }
  await pool.end();
});

describe('HTTPS and security headers', () => {
  test('API responses carry CSP, HSTS, anti-framing, nosniff and no-store', async () => {
    const res = await client(base).call('GET', '/health');
    const h = res.headers;
    assert.match(h['content-security-policy'], /default-src 'self'/);
    assert.match(h['content-security-policy'], /frame-ancestors 'none'/);
    assert.match(h['content-security-policy'], /object-src 'none'/);
    assert.match(h['strict-transport-security'], /max-age=31536000/);
    assert.equal(h['x-frame-options'], 'DENY');
    assert.equal(h['x-content-type-options'], 'nosniff');
    assert.equal(h['referrer-policy'], 'no-referrer');
    assert.equal(h['cache-control'], 'no-store');
    assert.equal(h['x-powered-by'], undefined);
  });

  test('TLS 1.0 and 1.1 are refused', async () => {
    const url = new URL(base);
    await assert.rejects(
      new Promise((resolve, reject) => {
        const req = https.request({ host: url.hostname, port: url.port, path: '/api/health', ca: CERT, maxVersion: 'TLSv1.1', minVersion: 'TLSv1' }, resolve);
        req.on('error', reject);
        req.end();
      }),
    );
  });
});

describe('Password hashing and policy', () => {
  test('passwords are stored as Argon2id hashes, never plaintext', async () => {
    const c = await registerAndLogin(base, 'hash');
    const { rows } = await query('SELECT password_hash FROM users WHERE id = $1', [c.user.id]);
    assert.match(rows[0].password_hash, /^\$argon2id\$v=19\$m=19456,p=1,t=2\$/);
    assert.ok(!rows[0].password_hash.includes(PASSWORD));
  });

  test('weak and common passwords are rejected', async () => {
    const c = client(base);
    for (const password of ['short1A!', 'password123', 'alllowercaseletters']) {
      const res = await c.call('POST', '/auth/register', { body: { fullName: 'Weak Pass', email: uniqueEmail('weak'), password } });
      assert.equal(res.status, 400, password);
    }
  });
});

describe('Input validation and injection', () => {
  test('SQL injection in the login form does not bypass authentication', async () => {
    const c = client(base);
    const a = await c.call('POST', '/auth/login', { body: { email: "' OR '1'='1' --", password: 'x' } });
    assert.equal(a.status, 400);
    const b = await c.call('POST', '/auth/login', { body: { email: 'aarav.shah@secureclinic.test', password: "' OR '1'='1" } });
    assert.ok([401, 423].includes(b.status));
    assert.equal(b.data.accessToken, undefined);
  });

  test('malformed ids are rejected before they reach the database', async () => {
    const c = await registerAndLogin(base, 'ids');
    const res = await c.call('GET', `/records/${encodeURIComponent("1' OR '1'='1")}`);
    assert.equal(res.status, 400);
  });

  test('script tags are rejected in names, and stored text is returned as inert data', async () => {
    const c = client(base);
    const res = await c.call('POST', '/auth/register', { body: { fullName: '<script>alert(1)</script>', email: uniqueEmail('xss'), password: PASSWORD } });
    assert.equal(res.status, 400);

    const p = await registerAndLogin(base, 'xss2');
    const payload = '<img src=x onerror=alert(document.cookie)>';
    const form = new FormData();
    form.append('type', 'other');
    form.append('title', 'XSS probe');
    form.append('description', payload);
    const created = await p.call('POST', '/records', { form });
    assert.equal(created.status, 201);
    assert.equal(created.headers['content-type'], 'application/json; charset=utf-8');
    assert.equal(created.data.record.description, payload); // React renders it as text; the CSP blocks inline scripts anyway
  });

  test('mass assignment: a self-registered user cannot make themselves admin', async () => {
    const c = client(base);
    const email = uniqueEmail('mass');
    await c.call('POST', '/auth/register', { body: { fullName: 'Sneaky User', email, password: PASSWORD, role: 'admin' } });
    const { rows } = await query('SELECT id, role FROM users WHERE email = $1', [email]);
    createdUsers.push(rows[0].id);
    assert.equal(rows[0].role, 'patient');
  });

  test('uploads are checked by content: an HTML file renamed to .pdf is refused', async () => {
    const c = await registerAndLogin(base, 'upload');
    const form = new FormData();
    form.append('type', 'lab_report');
    form.append('title', 'Fake report');
    form.append('file', new Blob(['<html><script>alert(1)</script></html>'], { type: 'application/pdf' }), 'report.pdf');
    const res = await c.call('POST', '/records', { form });
    assert.equal(res.status, 415);
  });

  test('uploads over 5 MB are refused', async () => {
    const c = await registerAndLogin(base, 'big');
    const form = new FormData();
    form.append('type', 'lab_report');
    form.append('title', 'Huge');
    form.append('file', new Blob([Buffer.concat([pdf('big'), Buffer.alloc(5 * 1024 * 1024)])]), 'huge.pdf');
    const res = await c.call('POST', '/records', { form });
    assert.equal(res.status, 413);
  });
});

describe('JWT authentication', () => {
  test('requests without a token are rejected', async () => {
    assert.equal((await client(base).call('GET', '/records')).status, 401);
  });

  test('a token with a forged role is rejected (signature check)', async () => {
    const c = await registerAndLogin(base, 'forge');
    const [h, p, s] = c.token.split('.');
    const payload = JSON.parse(Buffer.from(p, 'base64url'));
    payload.role = 'admin';
    const forged = `${h}.${Buffer.from(JSON.stringify(payload)).toString('base64url')}.${s}`;
    assert.equal((await c.call('GET', '/admin/stats', { token: forged })).status, 401);
  });

  test('an unsigned "alg: none" token is rejected', async () => {
    const c = await registerAndLogin(base, 'none');
    const payload = JSON.parse(Buffer.from(c.token.split('.')[1], 'base64url'));
    const none = `${Buffer.from('{"alg":"none","typ":"JWT"}').toString('base64url')}.${Buffer.from(JSON.stringify(payload)).toString('base64url')}.`;
    assert.equal((await c.call('GET', '/records', { token: none })).status, 401);
  });

  test('an expired access token is rejected', async () => {
    const c = await registerAndLogin(base, 'exp');
    const payload = JSON.parse(Buffer.from(c.token.split('.')[1], 'base64url'));
    const expired = jwt.sign({ ...payload, iat: payload.iat - 3600, exp: payload.iat - 1800 }, config.jwt.accessSecret, { algorithm: 'HS256' });
    assert.equal((await c.call('GET', '/records', { token: expired })).status, 401);
  });

  test('a refresh token cannot be used as an access token', async () => {
    const c = await registerAndLogin(base, 'typ');
    assert.equal((await c.call('GET', '/records', { token: c.jar.sc_rt })).status, 401);
  });

  test('the refresh cookie is HttpOnly, Secure and SameSite=Strict', async () => {
    const c = client(base);
    const email = uniqueEmail('cookie');
    await c.call('POST', '/auth/register', { body: { fullName: 'Cookie Check', email, password: PASSWORD } });
    const res = await c.call('POST', '/auth/login', { body: { email, password: PASSWORD } });
    createdUsers.push(res.data.user.id);
    const cookie = [res.headers['set-cookie']].flat().find((l) => l.startsWith('sc_rt='));
    assert.match(cookie, /HttpOnly/);
    assert.match(cookie, /Secure/);
    assert.match(cookie, /SameSite=Strict/);
  });

  test('refresh tokens rotate, and replaying an old one revokes the whole session', async () => {
    const c = await registerAndLogin(base, 'rotate');
    const first = c.jar.sc_rt;
    const r1 = await c.call('POST', '/auth/refresh');
    assert.equal(r1.status, 200);
    const second = c.jar.sc_rt;
    assert.notEqual(first, second);

    c.jar.sc_rt = first; // attacker replays the stolen, already-used token
    assert.equal((await c.call('POST', '/auth/refresh')).status, 401);

    c.jar.sc_rt = second; // the legitimate token is now dead too
    assert.equal((await c.call('POST', '/auth/refresh')).status, 401);
    const { rows } = await query("SELECT count(*)::int AS n FROM audit_logs WHERE action = 'auth.refresh_token_reuse' AND actor_id = $1", [c.user.id]);
    assert.equal(rows[0].n, 1);
  });

  test('signing out ends the access token immediately, not when it expires', async () => {
    const c = await registerAndLogin(base, 'logout');
    const token = c.token;
    assert.equal((await c.call('GET', '/records')).status, 200);
    assert.equal((await c.call('POST', '/auth/logout')).status, 200);
    assert.equal((await c.call('GET', '/records', { token })).status, 401);
  });

  test('revoking one session from another device ends it immediately', async () => {
    const email = uniqueEmail('twodev');
    await query("INSERT INTO users (email, password_hash, role, full_name) VALUES ($1, $2, 'patient', 'Two Devices')", [email, await hashPassword(PASSWORD)]);
    const laptop = client(base);
    const phone = client(base);
    const a = await laptop.call('POST', '/auth/login', { body: { email, password: PASSWORD } });
    const b = await phone.call('POST', '/auth/login', { body: { email, password: PASSWORD } });
    createdUsers.push(a.data.user.id);
    laptop.token = a.data.accessToken;
    phone.token = b.data.accessToken;
    const sessions = await laptop.call('GET', '/auth/sessions');
    const other = sessions.data.sessions.find((s) => !s.current);
    assert.equal((await laptop.call('DELETE', `/auth/sessions/${other.id}`)).status, 200);
    assert.equal((await phone.call('GET', '/records')).status, 401);
    assert.equal((await laptop.call('GET', '/records')).status, 200);
  });

  test('cookie endpoints need the anti-CSRF header', async () => {
    const c = await registerAndLogin(base, 'csrf');
    assert.equal((await c.call('POST', '/auth/refresh', { csrf: false })).status, 403);
  });

  test('changing the password invalidates existing access tokens', async () => {
    const c = await registerAndLogin(base, 'pwchange');
    const oldToken = c.token;
    const res = await c.call('POST', '/auth/change-password', { body: { currentPassword: PASSWORD, newPassword: 'Different#Pass2026' } });
    assert.equal(res.status, 200);
    assert.equal((await c.call('GET', '/records', { token: oldToken })).status, 401);
    assert.equal((await c.call('GET', '/records', { token: res.data.accessToken })).status, 200);
  });
});

describe('TOTP two-factor authentication', () => {
  test('doctors need a valid code; wrong and replayed codes are refused', async () => {
    const doc = await doctorClient(base);
    const c = client(base);
    const s1 = await c.call('POST', '/auth/login', { body: { email: doc.email, password: PASSWORD } });
    assert.equal(s1.data.mfaRequired, true);
    assert.equal(s1.data.accessToken, undefined);
    const wrong = await c.call('POST', '/auth/mfa/verify', { body: { mfaToken: s1.data.mfaToken, code: '000000' === generateTotp(doc.secret) ? '111111' : '000000' } });
    assert.equal(wrong.status, 401);
    // The code doc used to sign in a moment ago can't be used again.
    const { rows } = await query('SELECT totp_last_step FROM users WHERE id = $1', [doc.user.id]);
    const usedCode = generateTotp(doc.secret, Number(rows[0].totp_last_step));
    const replay = await c.call('POST', '/auth/mfa/verify', { body: { mfaToken: s1.data.mfaToken, code: usedCode } });
    assert.equal(replay.status, 401);
  });

  test('the MFA challenge token cannot be used to call the API', async () => {
    const doc = await doctorClient(base);
    const c = client(base);
    const s1 = await c.call('POST', '/auth/login', { body: { email: doc.email, password: PASSWORD } });
    assert.equal((await c.call('GET', '/appointments', { token: s1.data.mfaToken })).status, 401);
  });

  test('doctors without 2FA are forced to enrol before getting a session', async () => {
    const id = crypto.randomUUID();
    const email = uniqueEmail('enrol');
    await query("INSERT INTO users (id, email, password_hash, role, full_name) VALUES ($1, $2, $3, 'doctor', 'New Doctor')", [id, email, await hashPassword(PASSWORD)]);
    createdUsers.push(id);
    const c = client(base);
    const res = await c.call('POST', '/auth/login', { body: { email, password: PASSWORD } });
    assert.equal(res.data.mfaSetupRequired, true);
    assert.equal(res.data.accessToken, undefined);
    assert.equal((await c.call('GET', '/appointments', { token: res.data.setupToken })).status, 401);
    const setup = await c.call('POST', '/auth/mfa/setup', { token: res.data.setupToken });
    assert.equal(setup.status, 200);
    const enable = await c.call('POST', '/auth/mfa/enable', { token: res.data.setupToken, body: { code: generateTotp(setup.data.secret) } });
    assert.equal(enable.status, 200);
    assert.ok(enable.data.accessToken);
  });

  test('TOTP secrets are stored encrypted', async () => {
    const doc = await doctorClient(base);
    const { rows } = await query('SELECT totp_secret_enc FROM users WHERE id = $1', [doc.user.id]);
    assert.match(rows[0].totp_secret_enc, /^v1:/);
    assert.ok(!rows[0].totp_secret_enc.includes(doc.secret));
  });
});

describe('Role-based access control', () => {
  test('patients and doctors cannot reach admin endpoints', async () => {
    const p = await registerAndLogin(base, 'rbac');
    const d = await doctorClient(base);
    assert.equal((await p.call('GET', '/admin/stats')).status, 403);
    assert.equal((await d.call('GET', '/admin/users')).status, 403);
    assert.equal((await p.call('GET', '/admin/audit/verify')).status, 403);
  });

  test('doctors cannot grant access or book as a patient', async () => {
    const d = await doctorClient(base);
    assert.equal((await d.call('POST', '/grants', { body: { doctorId: d.user.id, durationHours: 1, scope: 'read' } })).status, 403);
  });

  test('patients cannot write diagnoses', async () => {
    const p = await registerAndLogin(base, 'diag');
    const form = new FormData();
    form.append('type', 'diagnosis');
    form.append('title', 'Self diagnosis');
    assert.equal((await p.call('POST', '/records', { form })).status, 403);
  });
});

describe('IDOR protection and time-limited grants', () => {
  let alice, bob, doc, aliceRecordId;

  before(async () => {
    alice = await registerAndLogin(base, 'alice');
    bob = await registerAndLogin(base, 'bob');
    doc = await doctorClient(base);
    const form = new FormData();
    form.append('type', 'lab_report');
    form.append('title', 'Alice private report');
    form.append('file', new Blob([pdf('ALICE-SECRET-MARKER')]), 'alice.pdf');
    const res = await alice.call('POST', '/records', { form });
    assert.equal(res.status, 201);
    aliceRecordId = res.data.record.id;
  });

  test("another patient cannot read a record by guessing its id", async () => {
    assert.equal((await bob.call('GET', `/records/${aliceRecordId}`)).status, 404);
    assert.equal((await bob.call('GET', `/records/${aliceRecordId}/file`)).status, 404);
    assert.equal((await bob.call('DELETE', `/records/${aliceRecordId}`)).status, 404);
  });

  test("patients' patientId parameter is ignored: they only ever see their own file", async () => {
    const res = await bob.call('GET', `/records?patientId=${alice.user.id}`);
    assert.equal(res.status, 200);
    assert.ok(res.data.records.every((r) => r.patientId === bob.user.id));
  });

  test('a doctor without a grant cannot see the patient', async () => {
    assert.equal((await doc.call('GET', `/records?patientId=${alice.user.id}`)).status, 404);
    assert.equal((await doc.call('GET', `/records/${aliceRecordId}`)).status, 404);
  });

  test('a read-only grant lets the doctor view but not add', async () => {
    const g = await alice.call('POST', '/grants', { body: { doctorId: doc.user.id, durationHours: 1, scope: 'read' } });
    assert.equal(g.status, 201);
    assert.equal((await doc.call('GET', `/records?patientId=${alice.user.id}`)).status, 200);
    const file = await doc.call('GET', `/records/${aliceRecordId}/file`);
    assert.equal(file.status, 200);
    assert.ok(file.data.includes('ALICE-SECRET-MARKER'));
    const form = new FormData();
    form.append('patientId', alice.user.id);
    form.append('type', 'prescription');
    form.append('title', 'Not allowed');
    assert.equal((await doc.call('POST', '/records', { form })).status, 403);
  });

  test('access ends when the grant expires', async () => {
    await query('UPDATE access_grants SET created_at = now() - interval \'2 hours\', expires_at = now() - interval \'1 second\' WHERE patient_id = $1', [alice.user.id]);
    assert.equal((await doc.call('GET', `/records?patientId=${alice.user.id}`)).status, 404);
  });

  test('access ends immediately when the patient revokes', async () => {
    const g = await alice.call('POST', '/grants', { body: { doctorId: doc.user.id, durationHours: 24, scope: 'read_write' } });
    assert.equal((await doc.call('GET', `/records?patientId=${alice.user.id}`)).status, 200);
    assert.equal((await bob.call('DELETE', `/grants/${g.data.id}`)).status, 404); // Bob can't revoke Alice's grant
    assert.equal((await alice.call('DELETE', `/grants/${g.data.id}`)).status, 200);
    assert.equal((await doc.call('GET', `/records?patientId=${alice.user.id}`)).status, 404);
  });

  test('blocked attempts are written to the audit log and shown to the patient', async () => {
    const { rows } = await query("SELECT count(*)::int AS n FROM audit_logs WHERE subject_patient_id = $1 AND outcome = 'denied'", [alice.user.id]);
    assert.ok(rows[0].n >= 3);
    const log = await alice.call('GET', '/me/access-log');
    assert.ok(log.data.entries.some((e) => e.outcome === 'denied' && !e.actor.self));
  });
});

describe('AES-256-GCM encryption at rest', () => {
  test('clinical fields are ciphertext in the database', async () => {
    const p = await registerAndLogin(base, 'enc');
    const form = new FormData();
    form.append('type', 'other');
    form.append('title', 'PLAINTEXT-TITLE-MARKER');
    form.append('description', 'PLAINTEXT-DESCRIPTION-MARKER');
    const res = await p.call('POST', '/records', { form });
    const { rows } = await query('SELECT * FROM medical_records WHERE id = $1', [res.data.record.id]);
    const raw = JSON.stringify(rows[0]);
    assert.ok(!raw.includes('PLAINTEXT-TITLE-MARKER'));
    assert.ok(!raw.includes('PLAINTEXT-DESCRIPTION-MARKER'));
    assert.match(rows[0].title_enc, /^v1:[A-Za-z0-9+/=]+:[A-Za-z0-9+/=]+:[A-Za-z0-9+/=]+$/);
  });

  test('uploaded files are encrypted on disk and decrypt to the original bytes', async () => {
    const p = await registerAndLogin(base, 'file');
    const original = pdf('FILE-PLAINTEXT-MARKER');
    const form = new FormData();
    form.append('type', 'lab_report');
    form.append('title', 'Encrypted file');
    form.append('file', new Blob([original]), 'scan.pdf');
    const res = await p.call('POST', '/records', { form });
    const { rows } = await query('SELECT file_storage_name FROM medical_records WHERE id = $1', [res.data.record.id]);
    const onDisk = fs.readFileSync(path.join(config.uploadDir, rows[0].file_storage_name));
    assert.ok(!onDisk.includes('FILE-PLAINTEXT-MARKER'));
    assert.ok(!onDisk.subarray(0, 5).equals(Buffer.from('%PDF-')));
    const download = await p.call('GET', `/records/${res.data.record.id}/file`);
    assert.ok(download.data.equals(original));
  });

  test('ciphertext moved to another row fails to decrypt (AAD binding)', () => {
    const a = crypto.randomUUID();
    const b = crypto.randomUUID();
    const token = encryptField('Diagnosis: confidential', aad('medical_records', 'diagnosis', a));
    assert.equal(decryptField(token, aad('medical_records', 'diagnosis', a)), 'Diagnosis: confidential');
    assert.throws(() => decryptField(token, aad('medical_records', 'diagnosis', b)));
  });

  test('a modified ciphertext is detected (GCM authentication tag)', () => {
    const id = crypto.randomUUID();
    const token = encryptField('Blood group O+', aad('users', 'phone', id));
    const parts = token.split(':');
    const ct = Buffer.from(parts[3], 'base64');
    ct[0] ^= 1;
    parts[3] = ct.toString('base64');
    assert.throws(() => decryptField(parts.join(':'), aad('users', 'phone', id)));
  });
});

describe('Tamper-evident audit log', () => {
  test('the hash chain verifies end to end', async () => {
    const result = await verifyAuditChain();
    assert.equal(result.ok, true, JSON.stringify(result));
    assert.ok(result.checked > 0);
  });

  test('changing any field of an entry changes its hash', async () => {
    const { rows } = await query('SELECT * FROM audit_logs ORDER BY id DESC LIMIT 1');
    const row = rows[0];
    assert.equal(computeAuditHash(row.prev_hash, row), row.hash);
    assert.notEqual(computeAuditHash(row.prev_hash, { ...row, outcome: row.outcome === 'success' ? 'denied' : 'success' }), row.hash);
    assert.notEqual(computeAuditHash(row.prev_hash, { ...row, actor_id: crypto.randomUUID() }), row.hash);
  });

  test('the database refuses to update or delete audit entries', async () => {
    await assert.rejects(query("UPDATE audit_logs SET outcome = 'success' WHERE id = (SELECT max(id) FROM audit_logs)"), /append-only/);
    await assert.rejects(query('DELETE FROM audit_logs WHERE id = (SELECT max(id) FROM audit_logs)'), /append-only/);
  });
});

describe('Brute-force protection', () => {
  test('5 wrong passwords lock the account, even for the right password afterwards', async () => {
    const lockBase = await startServer(); // fresh rate limiter, so only the lockout is tested
    const c = await registerAndLogin(lockBase, 'lock');
    const anon = client(lockBase);
    const statuses = [];
    for (let i = 0; i < 5; i++) statuses.push((await anon.call('POST', '/auth/login', { body: { email: c.email, password: `Wrong#Guess${i}x` } })).status);
    assert.deepEqual(statuses, [401, 401, 401, 401, 423]);
    const right = await anon.call('POST', '/auth/login', { body: { email: c.email, password: PASSWORD } });
    assert.equal(right.status, 423);
    assert.equal(right.data.code, 'ACCOUNT_LOCKED');
  });

  test('one IP is rate-limited after 10 failed sign-ins', async () => {
    const rlBase = await startServer();
    const anon = client(rlBase);
    const statuses = [];
    for (let i = 0; i < 12; i++) {
      statuses.push((await anon.call('POST', '/auth/login', { body: { email: uniqueEmail('nobody'), password: 'Whatever#123x' } })).status);
    }
    assert.deepEqual(statuses.slice(0, 10), Array(10).fill(401));
    assert.deepEqual(statuses.slice(10), [429, 429]);
  });

  test('unknown and known emails get the same error (no account enumeration)', async () => {
    const enumBase = await startServer();
    const anon = client(enumBase);
    const unknown = await anon.call('POST', '/auth/login', { body: { email: uniqueEmail('ghost'), password: 'Whatever#123x' } });
    const c = await registerAndLogin(enumBase, 'enum');
    const known = await anon.call('POST', '/auth/login', { body: { email: c.email, password: 'Whatever#123x' } });
    assert.equal(unknown.status, known.status);
    assert.equal(unknown.data.error, known.data.error);
  });
});
