// Tamper-evident audit log.
//
// Each entry stores hash = HMAC-SHA256(AUDIT_HMAC_KEY, prev_hash | canonical(entry)), chaining
// every entry to the one before it. Editing, deleting or reordering any row breaks the chain
// from that row on, and because the HMAC key lives outside the database, someone with database
// access can't recompute valid hashes after tampering. A trigger also makes the table
// append-only for the application.
import crypto from 'node:crypto';
import { pool } from '../db/pool.js';
import { config } from '../config.js';

export const GENESIS_HASH = '0'.repeat(64);
const CHAIN_LOCK_ID = 727274; // advisory lock that serialises appends so the chain never forks

function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((k) => `${JSON.stringify(k)}:${canonical(value[k])}`).join(',')}}`;
  }
  return JSON.stringify(value ?? null);
}

export function computeAuditHash(prevHash, row) {
  const payload = canonical({
    id: String(row.id),
    ts: new Date(row.ts).toISOString(),
    actor_id: row.actor_id ?? null,
    actor_role: row.actor_role ?? null,
    action: row.action,
    outcome: row.outcome,
    target_type: row.target_type ?? null,
    target_id: row.target_id ?? null,
    subject_patient_id: row.subject_patient_id ?? null,
    ip: row.ip ?? null,
    user_agent: row.user_agent ?? null,
    details: row.details ?? {},
  });
  return crypto.createHmac('sha256', config.auditKey).update(`${prevHash}|${payload}`).digest('hex');
}

/**
 * Appends an audit entry. `req` supplies the actor, IP and user agent when available.
 * Never put clinical content in `details`; ids and reasons only.
 */
export async function audit(req, { action, outcome = 'success', targetType = null, targetId = null, subjectPatientId = null, details = {}, actor = null }) {
  const who = actor ?? req?.user ?? null;
  const row = {
    ts: new Date(),
    actor_id: who?.id ?? null,
    actor_role: who?.role ?? null,
    action,
    outcome,
    target_type: targetType,
    target_id: targetId === null ? null : String(targetId),
    subject_patient_id: subjectPatientId,
    ip: req?.ip ?? null,
    user_agent: req?.get?.('user-agent')?.slice(0, 300) ?? null,
    // Round-trip through JSON so the hashed value matches what jsonb stores.
    details: JSON.parse(JSON.stringify(details ?? {})),
  };

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock($1)', [CHAIN_LOCK_ID]);
    const prev = await client.query('SELECT hash FROM audit_logs ORDER BY id DESC LIMIT 1');
    const prevHash = prev.rows[0]?.hash ?? GENESIS_HASH;
    const { rows } = await client.query("SELECT nextval('audit_logs_id_seq') AS id");
    row.id = rows[0].id;
    const hash = computeAuditHash(prevHash, row);
    await client.query(
      `INSERT INTO audit_logs (id, ts, actor_id, actor_role, action, outcome, target_type, target_id,
         subject_patient_id, ip, user_agent, details, prev_hash, hash)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
      [row.id, row.ts, row.actor_id, row.actor_role, row.action, row.outcome, row.target_type, row.target_id,
        row.subject_patient_id, row.ip, row.user_agent, row.details, prevHash, hash],
    );
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

/** Walks the whole chain and reports the first entry that doesn't verify. */
export async function verifyAuditChain() {
  let prevHash = GENESIS_HASH;
  let lastId = 0;
  let checked = 0;
  for (;;) {
    const { rows } = await pool.query('SELECT * FROM audit_logs WHERE id > $1 ORDER BY id LIMIT 1000', [lastId]);
    if (rows.length === 0) break;
    for (const row of rows) {
      if (row.prev_hash !== prevHash) {
        return { ok: false, checked, brokenAtId: row.id, reason: 'Chain link broken: an earlier entry was deleted, inserted or reordered.' };
      }
      if (computeAuditHash(prevHash, row) !== row.hash) {
        return { ok: false, checked, brokenAtId: row.id, reason: 'Entry contents were modified after they were written.' };
      }
      prevHash = row.hash;
      lastId = row.id;
      checked++;
    }
  }
  return { ok: true, checked, headHash: prevHash };
}
