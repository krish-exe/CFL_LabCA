// Administration. Admins manage accounts and monitor security, but have no route to clinical
// data: records, appointment reasons and notes are never returned here (separation of duties).
import crypto from 'node:crypto';
import { Router } from 'express';
import { z } from 'zod';
import { query } from '../db/pool.js';
import { authenticate, requireRole } from '../middleware/auth.js';
import { validate, personName, email, text, idParam } from '../middleware/validate.js';
import { HttpError, notFound } from '../middleware/errors.js';
import { hashPassword, generateTemporaryPassword } from '../security/password.js';
import { audit, verifyAuditChain } from '../security/audit.js';

function presentUser(r) {
  return {
    id: r.id,
    email: r.email,
    fullName: r.full_name,
    role: r.role,
    specialization: r.specialization,
    isActive: r.is_active,
    totpEnabled: r.totp_enabled,
    mustChangePassword: r.must_change_password,
    lockedUntil: r.locked_until && new Date(r.locked_until) > new Date() ? r.locked_until : null,
    lastLoginAt: r.last_login_at,
    createdAt: r.created_at,
  };
}

const USER_COLUMNS = 'id, email, full_name, role, specialization, is_active, totp_enabled, must_change_password, locked_until, last_login_at, created_at';

export function adminRoutes() {
  const router = Router();
  router.use(authenticate(), requireRole('admin'));

  router.get('/stats', async (req, res) => {
    const [users, security, appts, records] = await Promise.all([
      query("SELECT role, count(*)::int AS n FROM users GROUP BY role"),
      query(`SELECT
          count(*) FILTER (WHERE action = 'auth.login' AND outcome = 'failure')::int AS failed_logins,
          count(*) FILTER (WHERE action = 'auth.account_locked')::int AS lockouts,
          count(*) FILTER (WHERE outcome = 'denied')::int AS denied,
          count(*) FILTER (WHERE action = 'security.rate_limited')::int AS rate_limited,
          count(*) FILTER (WHERE action = 'auth.refresh_token_reuse')::int AS token_reuse
        FROM audit_logs WHERE ts > now() - interval '24 hours'`),
      query("SELECT count(*)::int AS n FROM appointments WHERE scheduled_at >= now() AND status <> 'cancelled'"),
      query('SELECT count(*)::int AS n, count(file_storage_name)::int AS files FROM medical_records'),
    ]);
    const locked = await query('SELECT count(*)::int AS n FROM users WHERE locked_until > now()');
    res.json({
      users: Object.fromEntries(users.rows.map((r) => [r.role, r.n])),
      last24h: security.rows[0],
      lockedAccounts: locked.rows[0].n,
      upcomingAppointments: appts.rows[0].n,
      records: records.rows[0].n,
      encryptedFiles: records.rows[0].files,
    });
  });

  router.get(
    '/users',
    validate({ query: z.object({ role: z.enum(['patient', 'doctor', 'admin']).optional(), q: text(100).optional() }) }),
    async (req, res) => {
      const { role, q } = req.valid.query;
      // LIKE wildcards in the search text are escaped so they match literally.
      const pattern = q ? `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%` : null;
      const { rows } = await query(
        `SELECT ${USER_COLUMNS} FROM users
          WHERE ($1::user_role IS NULL OR role = $1)
            AND ($2::text IS NULL OR full_name ILIKE $2 OR email ILIKE $2)
          ORDER BY created_at DESC LIMIT 500`,
        [role ?? null, pattern],
      );
      res.json({ users: rows.map(presentUser) });
    },
  );

  router.post(
    '/users',
    validate({
      body: z.object({
        fullName: personName,
        email,
        role: z.enum(['doctor', 'admin']),
        specialization: text(80).optional(),
      }),
    }),
    async (req, res) => {
      const { fullName, email: mail, role, specialization } = req.valid.body;
      const temporaryPassword = generateTemporaryPassword();
      const id = crypto.randomUUID();
      try {
        await query(
          `INSERT INTO users (id, email, password_hash, role, full_name, specialization, must_change_password)
           VALUES ($1, $2, $3, $4, $5, $6, true)`,
          [id, mail, await hashPassword(temporaryPassword), role, fullName, role === 'doctor' ? specialization || 'General Medicine' : null],
        );
      } catch (err) {
        if (err.code === '23505') throw new HttpError(409, 'An account with this email already exists.');
        throw err;
      }
      await audit(req, { action: 'admin.user_created', targetType: 'user', targetId: id, details: { role } });
      const { rows } = await query(`SELECT ${USER_COLUMNS} FROM users WHERE id = $1`, [id]);
      // The temporary password is shown once; the user must replace it at first sign-in.
      res.status(201).json({ user: presentUser(rows[0]), temporaryPassword });
    },
  );

  router.patch('/users/:id', validate({ params: idParam, body: z.object({ isActive: z.boolean() }) }), async (req, res) => {
    const { id } = req.valid.params;
    if (id === req.user.id) throw new HttpError(400, "You can't deactivate your own account.");
    const { rows } = await query(
      `UPDATE users SET is_active = $2, token_version = token_version + CASE WHEN $2 THEN 0 ELSE 1 END
        WHERE id = $1 RETURNING ${USER_COLUMNS}`,
      [id, req.valid.body.isActive],
    );
    if (!rows[0]) throw notFound('User not found.');
    if (!req.valid.body.isActive) await query('UPDATE refresh_tokens SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL', [id]);
    await audit(req, { action: req.valid.body.isActive ? 'admin.user_activated' : 'admin.user_deactivated', targetType: 'user', targetId: id });
    res.json({ user: presentUser(rows[0]) });
  });

  router.post('/users/:id/unlock', validate({ params: idParam }), async (req, res) => {
    const { rows } = await query(
      `UPDATE users SET locked_until = NULL, failed_login_count = 0 WHERE id = $1 RETURNING ${USER_COLUMNS}`,
      [req.valid.params.id],
    );
    if (!rows[0]) throw notFound('User not found.');
    await audit(req, { action: 'admin.user_unlocked', targetType: 'user', targetId: req.valid.params.id });
    res.json({ user: presentUser(rows[0]) });
  });

  // For a lost phone: switches 2FA off so the user re-enrols at next sign-in, and ends their sessions.
  router.post('/users/:id/reset-mfa', validate({ params: idParam }), async (req, res) => {
    const { id } = req.valid.params;
    if (id === req.user.id) throw new HttpError(400, 'Ask another admin to reset your own two-factor authentication.');
    const { rows } = await query(
      `UPDATE users SET totp_enabled = false, totp_secret_enc = NULL, totp_pending_enc = NULL, totp_last_step = NULL,
              token_version = token_version + 1
        WHERE id = $1 RETURNING ${USER_COLUMNS}`,
      [id],
    );
    if (!rows[0]) throw notFound('User not found.');
    await query('UPDATE refresh_tokens SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL', [id]);
    await audit(req, { action: 'admin.mfa_reset', targetType: 'user', targetId: id });
    res.json({ user: presentUser(rows[0]) });
  });

  router.get(
    '/audit',
    validate({
      query: z.object({
        action: z.string().regex(/^[a-z_.]{1,60}$/).optional(),
        outcome: z.enum(['success', 'failure', 'denied']).optional(),
        before: z.coerce.number().int().positive().optional(),
        limit: z.coerce.number().int().min(1).max(200).default(50),
      }),
    }),
    async (req, res) => {
      const { action, outcome, before, limit } = req.valid.query;
      const { rows } = await query(
        `SELECT l.*, u.full_name AS actor_name, u.email AS actor_email
           FROM audit_logs l LEFT JOIN users u ON u.id = l.actor_id
          WHERE ($1::text IS NULL OR l.action LIKE $1 || '%')
            AND ($2::text IS NULL OR l.outcome = $2)
            AND ($3::bigint IS NULL OR l.id < $3)
          ORDER BY l.id DESC LIMIT $4`,
        [action ?? null, outcome ?? null, before ?? null, limit],
      );
      res.json({
        entries: rows.map((r) => ({
          id: Number(r.id),
          at: r.ts,
          action: r.action,
          outcome: r.outcome,
          actor: r.actor_id ? { id: r.actor_id, fullName: r.actor_name, email: r.actor_email, role: r.actor_role } : null,
          targetType: r.target_type,
          targetId: r.target_id,
          subjectPatientId: r.subject_patient_id,
          ip: r.ip,
          userAgent: r.user_agent,
          details: r.details,
          hash: r.hash,
          prevHash: r.prev_hash,
        })),
      });
    },
  );

  router.get('/audit/verify', async (req, res) => {
    const result = await verifyAuditChain();
    await audit(req, { action: 'admin.audit_verified', outcome: result.ok ? 'success' : 'failure', details: { checked: result.checked, brokenAtId: result.brokenAtId ?? null } });
    res.json(result);
  });

  return router;
}
