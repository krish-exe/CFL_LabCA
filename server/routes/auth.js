// Registration, login with lockout, TOTP two-factor authentication, refresh-token rotation,
// session management and password changes.
import crypto from 'node:crypto';
import { Router } from 'express';
import { z } from 'zod';
import QRCode from 'qrcode';
import { query, tx } from '../db/pool.js';
import { config } from '../config.js';
import { audit } from '../security/audit.js';
import { aad, encryptField, decryptField } from '../security/crypto.js';
import { hashPassword, verifyPassword, burnVerifyTime, needsRehash, checkPasswordPolicy } from '../security/password.js';
import { generateSecret, otpauthUrl, verifyTotp } from '../security/totp.js';
import { signAccessToken, signChallengeToken, signRefreshToken, verifyToken } from '../security/tokens.js';
import { authenticate, requireCsrfHeader } from '../middleware/auth.js';
import { validate, email, password, personName, otpCode, phone, isoDate, uuid } from '../middleware/validate.js';
import { HttpError } from '../middleware/errors.js';
import { getCookie, publicUser, decryptProfile } from '../util.js';

const REFRESH_COOKIE = 'sc_rt';
const cookieOptions = { httpOnly: true, secure: true, sameSite: 'strict', path: '/api/auth' };
const GENERIC_LOGIN_ERROR = 'Invalid email or password.';

async function issueSession(req, res, user, { mfa, familyId = crypto.randomUUID() }) {
  const jti = crypto.randomUUID();
  await query(
    `INSERT INTO refresh_tokens (jti, user_id, family_id, expires_at, ip, user_agent)
     VALUES ($1, $2, $3, now() + make_interval(secs => $4), $5, $6)`,
    [jti, user.id, familyId, config.jwt.refreshTtlSeconds, req.ip, req.get('user-agent')?.slice(0, 300) ?? null],
  );
  res.cookie(REFRESH_COOKIE, signRefreshToken(user, { jti, familyId, mfa }), { ...cookieOptions, maxAge: config.jwt.refreshTtlSeconds * 1000 });
  return { accessToken: signAccessToken(user, { mfa, familyId }), expiresIn: config.jwt.accessTtlSeconds, user: publicUser(user) };
}

async function loadUser(id) {
  return (await query('SELECT * FROM users WHERE id = $1', [id])).rows[0] ?? null;
}

const isLocked = (user) => user.locked_until && new Date(user.locked_until) > new Date();

function lockedError(user) {
  const minutes = Math.max(1, Math.ceil((new Date(user.locked_until) - Date.now()) / 60000));
  return new HttpError(423, `Too many failed attempts. This account is locked for ${minutes} more minute${minutes === 1 ? '' : 's'}.`, {
    code: 'ACCOUNT_LOCKED',
    lockedUntil: user.locked_until,
  });
}

/** Counts a failed password or TOTP attempt and locks the account at the threshold. */
async function registerFailure(req, user, reason) {
  const { rows } = await query(
    `UPDATE users SET
       failed_login_count = CASE WHEN failed_login_count + 1 >= $2 THEN 0 ELSE failed_login_count + 1 END,
       locked_until = CASE WHEN failed_login_count + 1 >= $2 THEN now() + make_interval(mins => $3) ELSE locked_until END
     WHERE id = $1
     RETURNING locked_until`,
    [user.id, config.lockout.maxAttempts, config.lockout.minutes],
  );
  await audit(req, { action: 'auth.login', outcome: 'failure', actor: user, targetType: 'user', targetId: user.id, details: { reason } });
  const updated = { ...user, locked_until: rows[0].locked_until };
  if (isLocked(updated) && !isLocked(user)) {
    await audit(req, { action: 'auth.account_locked', outcome: 'denied', actor: user, targetType: 'user', targetId: user.id, details: { minutes: config.lockout.minutes } });
    throw lockedError(updated);
  }
}

async function loginSucceeded(req, user, method) {
  await query('UPDATE users SET failed_login_count = 0, locked_until = NULL, last_login_at = now() WHERE id = $1', [user.id]);
  await audit(req, { action: 'auth.login', actor: user, targetType: 'user', targetId: user.id, details: { method } });
}

async function revokeAllSessions(userId) {
  await query('UPDATE refresh_tokens SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL', [userId]);
}

/** Family id of the refresh cookie on this request (to mark "this device" in the session list). */
function currentFamily(req) {
  const token = getCookie(req, REFRESH_COOKIE);
  return token ? verifyToken(token, ['refresh'], { ignoreExpiration: true })?.fam ?? null : null;
}

export function authRoutes(limiters) {
  const router = Router();

  // ---- Registration (patients only; doctors and admins are created by an admin) ----
  router.post(
    '/register',
    limiters.register,
    validate({
      body: z.object({
        fullName: personName,
        email,
        password,
        phone: phone.optional(),
        dateOfBirth: isoDate.optional(),
      }),
    }),
    async (req, res) => {
      const { fullName, email: mail, password: pw, phone: ph, dateOfBirth } = req.valid.body;
      const problems = checkPasswordPolicy(pw, { email: mail, fullName });
      if (problems.length) throw new HttpError(400, problems[0], { fields: [{ field: 'password', message: problems.join(' ') }] });
      if (dateOfBirth && (new Date(dateOfBirth) > new Date() || new Date(dateOfBirth) < new Date('1900-01-01'))) {
        throw new HttpError(400, 'Enter a real date of birth.', { fields: [{ field: 'dateOfBirth', message: 'Enter a real date of birth.' }] });
      }

      const id = crypto.randomUUID();
      const hash = await hashPassword(pw);
      try {
        await query(
          `INSERT INTO users (id, email, password_hash, role, full_name, phone_enc, date_of_birth_enc)
           VALUES ($1, $2, $3, 'patient', $4, $5, $6)`,
          [id, mail, hash, fullName, encryptField(ph, aad('users', 'phone', id)), encryptField(dateOfBirth, aad('users', 'date_of_birth', id))],
        );
      } catch (err) {
        if (err.code === '23505') throw new HttpError(409, 'An account with this email already exists. Try signing in.');
        throw err;
      }
      await audit(req, { action: 'auth.register', actor: { id, role: 'patient' }, targetType: 'user', targetId: id });
      res.status(201).json({ message: 'Account created. You can sign in now.' });
    },
  );

  // ---- Login step 1: password ----
  router.post('/login', limiters.login, validate({ body: z.object({ email, password }) }), async (req, res) => {
    const { email: mail, password: pw } = req.valid.body;
    const user = (await query('SELECT * FROM users WHERE email = $1', [mail])).rows[0];

    if (!user) {
      await burnVerifyTime(pw);
      await audit(req, { action: 'auth.login', outcome: 'failure', details: { reason: 'unknown_email' } });
      throw new HttpError(401, GENERIC_LOGIN_ERROR);
    }
    if (isLocked(user)) {
      await audit(req, { action: 'auth.login', outcome: 'denied', actor: user, targetType: 'user', targetId: user.id, details: { reason: 'account_locked' } });
      throw lockedError(user);
    }
    if (!(await verifyPassword(user.password_hash, pw))) {
      await registerFailure(req, user, 'bad_password');
      throw new HttpError(401, GENERIC_LOGIN_ERROR);
    }
    if (!user.is_active) {
      await audit(req, { action: 'auth.login', outcome: 'denied', actor: user, targetType: 'user', targetId: user.id, details: { reason: 'account_disabled' } });
      throw new HttpError(401, GENERIC_LOGIN_ERROR);
    }
    if (needsRehash(user.password_hash)) {
      await query('UPDATE users SET password_hash = $2 WHERE id = $1', [user.id, await hashPassword(pw)]);
    }

    if (user.totp_enabled) {
      return res.json({ mfaRequired: true, mfaToken: signChallengeToken(user, 'mfa-login') });
    }
    if (config.mfaRequiredRoles.includes(user.role)) {
      return res.json({ mfaSetupRequired: true, setupToken: signChallengeToken(user, 'mfa-setup') });
    }
    await loginSucceeded(req, user, 'password');
    res.json(await issueSession(req, res, user, { mfa: false }));
  });

  // ---- Login step 2: TOTP code ----
  router.post('/mfa/verify', limiters.mfa, validate({ body: z.object({ mfaToken: z.string().max(4096), code: otpCode }) }), async (req, res) => {
    const payload = verifyToken(req.valid.body.mfaToken, ['mfa-login']);
    if (!payload) throw new HttpError(401, 'Your sign-in attempt expired. Please start again.', { code: 'MFA_EXPIRED' });
    const user = await loadUser(payload.sub);
    if (!user || !user.is_active || user.token_version !== payload.tv || !user.totp_enabled) {
      throw new HttpError(401, 'Your sign-in attempt expired. Please start again.', { code: 'MFA_EXPIRED' });
    }
    if (isLocked(user)) throw lockedError(user);

    const secret = decryptField(user.totp_secret_enc, aad('users', 'totp_secret', user.id));
    const step = verifyTotp(secret, req.valid.body.code, { lastStep: user.totp_last_step === null ? null : Number(user.totp_last_step) });
    if (step === null) {
      await registerFailure(req, user, 'bad_totp');
      throw new HttpError(401, 'That code is incorrect or has already been used.');
    }
    await query('UPDATE users SET totp_last_step = $2 WHERE id = $1', [user.id, step]);
    await loginSucceeded(req, user, 'password+totp');
    res.json(await issueSession(req, res, user, { mfa: true }));
  });

  // ---- TOTP enrolment (from settings, or forced at first login for doctors/admins) ----
  const mfaEnrolAuth = authenticate({ allow: ['access', 'mfa-setup'], allowPasswordChange: true });

  router.post('/mfa/setup', mfaEnrolAuth, async (req, res) => {
    if (req.user.totp_enabled) throw new HttpError(409, 'Two-factor authentication is already on.');
    const secret = generateSecret();
    await query('UPDATE users SET totp_pending_enc = $2 WHERE id = $1', [req.user.id, encryptField(secret, aad('users', 'totp_pending', req.user.id))]);
    const url = otpauthUrl(secret, req.user.email);
    await audit(req, { action: 'mfa.setup_started', targetType: 'user', targetId: req.user.id });
    res.json({ secret, otpauthUrl: url, qrDataUrl: await QRCode.toDataURL(url, { margin: 1, width: 220 }) });
  });

  router.post('/mfa/enable', mfaEnrolAuth, validate({ body: z.object({ code: otpCode }) }), async (req, res) => {
    const user = await loadUser(req.user.id);
    if (user.totp_enabled) throw new HttpError(409, 'Two-factor authentication is already on.');
    if (!user.totp_pending_enc) throw new HttpError(400, 'Start the setup again.');
    const secret = decryptField(user.totp_pending_enc, aad('users', 'totp_pending', user.id));
    const step = verifyTotp(secret, req.valid.body.code);
    if (step === null) {
      await audit(req, { action: 'mfa.enable', outcome: 'failure', targetType: 'user', targetId: user.id });
      throw new HttpError(400, 'That code is incorrect. Check the time on your phone and try again.');
    }
    // Turning 2FA on signs out every other session (they were created without it).
    const { rows } = await query(
      `UPDATE users SET totp_enabled = true, totp_secret_enc = $2, totp_pending_enc = NULL, totp_last_step = $3,
              token_version = token_version + 1
        WHERE id = $1 RETURNING *`,
      [user.id, encryptField(secret, aad('users', 'totp_secret', user.id)), step],
    );
    await revokeAllSessions(user.id);
    await audit(req, { action: 'mfa.enabled', targetType: 'user', targetId: user.id });
    if (req.user.tokenType === 'mfa-setup') await loginSucceeded(req, rows[0], 'password+totp-enrolment');
    res.json(await issueSession(req, res, rows[0], { mfa: true }));
  });

  router.post(
    '/mfa/disable',
    authenticate(),
    validate({ body: z.object({ password, code: otpCode }) }),
    async (req, res) => {
      if (config.mfaRequiredRoles.includes(req.user.role)) throw new HttpError(403, 'Two-factor authentication is mandatory for your role.');
      const user = await loadUser(req.user.id);
      if (!user.totp_enabled) throw new HttpError(400, 'Two-factor authentication is already off.');
      const secret = decryptField(user.totp_secret_enc, aad('users', 'totp_secret', user.id));
      const ok = (await verifyPassword(user.password_hash, req.valid.body.password)) && verifyTotp(secret, req.valid.body.code, { lastStep: Number(user.totp_last_step) }) !== null;
      if (!ok) {
        await audit(req, { action: 'mfa.disable', outcome: 'failure', targetType: 'user', targetId: user.id });
        throw new HttpError(400, 'Password or code is incorrect.');
      }
      const { rows } = await query(
        `UPDATE users SET totp_enabled = false, totp_secret_enc = NULL, totp_last_step = NULL, token_version = token_version + 1
          WHERE id = $1 RETURNING *`,
        [user.id],
      );
      await revokeAllSessions(user.id);
      await audit(req, { action: 'mfa.disabled', targetType: 'user', targetId: user.id });
      res.json(await issueSession(req, res, rows[0], { mfa: false }));
    },
  );

  // ---- Refresh-token rotation with reuse detection ----
  router.post('/refresh', requireCsrfHeader, async (req, res) => {
    const token = getCookie(req, REFRESH_COOKIE);
    const payload = token ? verifyToken(token, ['refresh']) : null;
    const fail = () => {
      res.clearCookie(REFRESH_COOKIE, cookieOptions);
      throw new HttpError(401, 'Your session has ended. Please sign in again.', { code: 'UNAUTHENTICATED' });
    };
    if (!payload) return fail();

    const stored = (await query('SELECT * FROM refresh_tokens WHERE jti = $1', [payload.jti])).rows[0];
    if (!stored || stored.user_id !== payload.sub) return fail();
    if (stored.replaced_by) {
      // A refresh token that was already rotated is being presented again: it has probably been
      // stolen. Kill the whole session family so neither the thief nor the victim keeps access.
      await query('UPDATE refresh_tokens SET revoked_at = now() WHERE family_id = $1 AND revoked_at IS NULL', [stored.family_id]);
      await audit(req, {
        action: 'auth.refresh_token_reuse',
        outcome: 'denied',
        actor: { id: stored.user_id },
        targetType: 'session',
        targetId: stored.family_id,
      });
      return fail();
    }
    if (stored.revoked_at) return fail(); // signed out, or ended by a reuse alarm

    const user = await loadUser(payload.sub);
    if (!user || !user.is_active || user.token_version !== payload.tv) return fail();

    const newJti = crypto.randomUUID();
    const rotated = await tx(async (client) => {
      const { rowCount } = await client.query(
        'UPDATE refresh_tokens SET revoked_at = now(), replaced_by = $2 WHERE jti = $1 AND revoked_at IS NULL',
        [stored.jti, newJti],
      );
      if (rowCount === 0) return false;
      await client.query(
        `INSERT INTO refresh_tokens (jti, user_id, family_id, expires_at, ip, user_agent)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        // The family keeps its original expiry: rotation doesn't extend a session forever.
        [newJti, user.id, stored.family_id, stored.expires_at, req.ip, req.get('user-agent')?.slice(0, 300) ?? null],
      );
      return true;
    });
    if (!rotated) return fail();

    const remainingMs = new Date(stored.expires_at) - Date.now();
    res.cookie(REFRESH_COOKIE, signRefreshToken(user, { jti: newJti, familyId: stored.family_id, mfa: payload.mfa }), {
      ...cookieOptions,
      maxAge: Math.max(0, remainingMs),
    });
    res.json({ accessToken: signAccessToken(user, { mfa: payload.mfa, familyId: stored.family_id }), expiresIn: config.jwt.accessTtlSeconds, user: publicUser(user) });
  });

  router.post('/logout', requireCsrfHeader, async (req, res) => {
    const token = getCookie(req, REFRESH_COOKIE);
    const payload = token ? verifyToken(token, ['refresh'], { ignoreExpiration: true }) : null;
    if (payload) {
      await query('UPDATE refresh_tokens SET revoked_at = now() WHERE family_id = $1 AND user_id = $2 AND revoked_at IS NULL', [payload.fam, payload.sub]);
      await audit(req, { action: 'auth.logout', actor: { id: payload.sub }, targetType: 'session', targetId: payload.fam });
    }
    res.clearCookie(REFRESH_COOKIE, cookieOptions);
    res.json({ ok: true });
  });

  router.post('/logout-all', authenticate({ allowPasswordChange: true }), async (req, res) => {
    await query('UPDATE users SET token_version = token_version + 1 WHERE id = $1', [req.user.id]);
    await revokeAllSessions(req.user.id);
    await audit(req, { action: 'auth.logout_all', targetType: 'user', targetId: req.user.id });
    res.clearCookie(REFRESH_COOKIE, cookieOptions);
    res.json({ ok: true });
  });

  // ---- Current user and active sessions ----
  router.get('/me', authenticate({ allowPasswordChange: true }), async (req, res) => {
    const user = await loadUser(req.user.id);
    res.json({ user: { ...publicUser(user), ...decryptProfile(user), lastLoginAt: user.last_login_at, passwordChangedAt: user.password_changed_at } });
  });

  router.get('/sessions', authenticate(), async (req, res) => {
    const { rows } = await query(
      `SELECT family_id, min(created_at) AS started_at, max(created_at) AS last_active,
              (array_agg(ip ORDER BY created_at DESC))[1] AS ip,
              (array_agg(user_agent ORDER BY created_at DESC))[1] AS user_agent
         FROM refresh_tokens
        WHERE user_id = $1
        GROUP BY family_id
       HAVING bool_or(revoked_at IS NULL AND expires_at > now())
        ORDER BY last_active DESC`,
      [req.user.id],
    );
    const current = currentFamily(req);
    res.json({
      sessions: rows.map((r) => ({
        id: r.family_id,
        startedAt: r.started_at,
        lastActive: r.last_active,
        ip: r.ip,
        userAgent: r.user_agent,
        current: r.family_id === current,
      })),
    });
  });

  router.delete('/sessions/:id', authenticate(), validate({ params: z.object({ id: uuid }) }), async (req, res) => {
    const { rowCount } = await query(
      'UPDATE refresh_tokens SET revoked_at = now() WHERE family_id = $1 AND user_id = $2 AND revoked_at IS NULL',
      [req.valid.params.id, req.user.id],
    );
    if (rowCount === 0) throw new HttpError(404, 'Session not found.');
    await audit(req, { action: 'auth.session_revoked', targetType: 'session', targetId: req.valid.params.id });
    res.json({ ok: true });
  });

  // ---- Password change (also used to replace an admin-issued temporary password) ----
  router.post(
    '/change-password',
    authenticate({ allowPasswordChange: true }),
    validate({ body: z.object({ currentPassword: password, newPassword: password }) }),
    async (req, res) => {
      const user = await loadUser(req.user.id);
      const { currentPassword, newPassword } = req.valid.body;
      if (isLocked(user)) throw lockedError(user);
      if (!(await verifyPassword(user.password_hash, currentPassword))) {
        await registerFailure(req, user, 'bad_password_on_change');
        throw new HttpError(400, 'Your current password is incorrect.', { fields: [{ field: 'currentPassword', message: 'Incorrect password.' }] });
      }
      if (currentPassword === newPassword) throw new HttpError(400, 'Choose a password you have not used here before.');
      const problems = checkPasswordPolicy(newPassword, { email: user.email, fullName: user.full_name });
      if (problems.length) throw new HttpError(400, problems[0], { fields: [{ field: 'newPassword', message: problems.join(' ') }] });

      const { rows } = await query(
        `UPDATE users SET password_hash = $2, must_change_password = false, password_changed_at = now(),
                token_version = token_version + 1
          WHERE id = $1 RETURNING *`,
        [user.id, await hashPassword(newPassword)],
      );
      await revokeAllSessions(user.id);
      await audit(req, { action: 'auth.password_changed', targetType: 'user', targetId: user.id });
      res.json(await issueSession(req, res, rows[0], { mfa: req.user.mfa }));
    },
  );

  return router;
}
