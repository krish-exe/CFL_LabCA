import { Router } from 'express';
import { z } from 'zod';
import { query } from '../db/pool.js';
import { authenticate, requireRole } from '../middleware/auth.js';
import { validate, personName, phone, isoDate } from '../middleware/validate.js';
import { HttpError } from '../middleware/errors.js';
import { aad, encryptField } from '../security/crypto.js';
import { audit } from '../security/audit.js';

export function meRoutes() {
  const router = Router();
  router.use(authenticate());

  // Patients can see every access to their own data: who, what and when.
  router.get('/access-log', requireRole('patient'), async (req, res) => {
    const { rows } = await query(
      `SELECT l.id, l.ts, l.action, l.outcome, l.target_type, l.target_id, l.actor_id, l.actor_role, u.full_name AS actor_name
         FROM audit_logs l LEFT JOIN users u ON u.id = l.actor_id
        WHERE l.subject_patient_id = $1
        ORDER BY l.id DESC LIMIT 200`,
      [req.user.id],
    );
    res.json({
      entries: rows.map((r) => ({
        id: r.id,
        at: r.ts,
        action: r.action,
        outcome: r.outcome,
        targetType: r.target_type,
        targetId: r.target_id,
        actor: r.actor_id === req.user.id ? { self: true, fullName: 'You', role: r.actor_role } : { self: false, fullName: r.actor_name ?? 'Unknown', role: r.actor_role },
      })),
    });
  });

  router.patch(
    '/profile',
    validate({ body: z.object({ fullName: personName.optional(), phone: phone.or(z.literal('')).optional(), dateOfBirth: isoDate.or(z.literal('')).optional() }) }),
    async (req, res) => {
      const { fullName, phone: ph, dateOfBirth } = req.valid.body;
      if (dateOfBirth && (new Date(dateOfBirth) > new Date() || new Date(dateOfBirth) < new Date('1900-01-01'))) {
        throw new HttpError(400, 'Enter a real date of birth.');
      }
      const id = req.user.id;
      await query(
        `UPDATE users SET
           full_name = COALESCE($2, full_name),
           phone_enc = CASE WHEN $3::boolean THEN $4 ELSE phone_enc END,
           date_of_birth_enc = CASE WHEN $5::boolean THEN $6 ELSE date_of_birth_enc END
         WHERE id = $1`,
        [id, fullName ?? null, ph !== undefined, encryptField(ph, aad('users', 'phone', id)), dateOfBirth !== undefined, encryptField(dateOfBirth, aad('users', 'date_of_birth', id))],
      );
      await audit(req, { action: 'profile.update', targetType: 'user', targetId: id, details: { fields: Object.keys(req.valid.body) } });
      res.json({ ok: true });
    },
  );

  return router;
}
