// Time-limited consent: a patient lets one doctor see (or also add to) their records until a
// chosen expiry, and can revoke it at any time.
import crypto from 'node:crypto';
import { Router } from 'express';
import { z } from 'zod';
import { query, tx } from '../db/pool.js';
import { authenticate, requireRole } from '../middleware/auth.js';
import { validate, uuid, idParam } from '../middleware/validate.js';
import { notFound } from '../middleware/errors.js';
import { aad, decryptField } from '../security/crypto.js';
import { audit } from '../security/audit.js';

const DURATIONS_HOURS = [1, 24, 72, 168, 720];

function status(row) {
  if (row.revoked_at) return 'revoked';
  return new Date(row.expires_at) > new Date() ? 'active' : 'expired';
}

export function grantRoutes() {
  const router = Router();
  router.use(authenticate(), requireRole('patient', 'doctor'));

  router.get('/', async (req, res) => {
    if (req.user.role === 'patient') {
      const { rows } = await query(
        `SELECT g.*, d.full_name AS doctor_name, d.specialization
           FROM access_grants g JOIN users d ON d.id = g.doctor_id
          WHERE g.patient_id = $1
          ORDER BY (g.revoked_at IS NULL AND g.expires_at > now()) DESC, g.created_at DESC
          LIMIT 100`,
        [req.user.id],
      );
      return res.json({
        grants: rows.map((r) => ({
          id: r.id,
          doctor: { id: r.doctor_id, fullName: r.doctor_name, specialization: r.specialization },
          scope: r.scope,
          expiresAt: r.expires_at,
          revokedAt: r.revoked_at,
          createdAt: r.created_at,
          status: status(r),
        })),
      });
    }
    // Doctors only see patients whose grant is currently active.
    const { rows } = await query(
      `SELECT DISTINCT ON (g.patient_id) g.*, p.full_name AS patient_name, p.email AS patient_email, p.date_of_birth_enc
         FROM access_grants g JOIN users p ON p.id = g.patient_id
        WHERE g.doctor_id = $1 AND g.revoked_at IS NULL AND g.expires_at > now() AND p.is_active
        ORDER BY g.patient_id, g.expires_at DESC`,
      [req.user.id],
    );
    res.json({
      grants: rows.map((r) => ({
        id: r.id,
        patient: {
          id: r.patient_id,
          fullName: r.patient_name,
          email: r.patient_email,
          dateOfBirth: decryptField(r.date_of_birth_enc, aad('users', 'date_of_birth', r.patient_id)),
        },
        scope: r.scope,
        expiresAt: r.expires_at,
        createdAt: r.created_at,
        status: 'active',
      })),
    });
  });

  router.post(
    '/',
    requireRole('patient'),
    validate({
      body: z.object({
        doctorId: uuid,
        durationHours: z.number().int().refine((h) => DURATIONS_HOURS.includes(h), 'Pick one of the listed durations.'),
        scope: z.enum(['read', 'read_write']),
      }),
    }),
    async (req, res) => {
      const { doctorId, durationHours, scope } = req.valid.body;
      const doctor = (await query("SELECT id FROM users WHERE id = $1 AND role = 'doctor' AND is_active", [doctorId])).rows[0];
      if (!doctor) throw notFound('Doctor not found.');
      const id = crypto.randomUUID();
      // One active grant per doctor: replacing it revokes the old one.
      await tx(async (client) => {
        await client.query(
          'UPDATE access_grants SET revoked_at = now() WHERE patient_id = $1 AND doctor_id = $2 AND revoked_at IS NULL AND expires_at > now()',
          [req.user.id, doctorId],
        );
        await client.query(
          `INSERT INTO access_grants (id, patient_id, doctor_id, scope, expires_at)
           VALUES ($1, $2, $3, $4, now() + make_interval(hours => $5))`,
          [id, req.user.id, doctorId, scope, durationHours],
        );
      });
      await audit(req, { action: 'grant.create', targetType: 'grant', targetId: id, subjectPatientId: req.user.id, details: { doctorId, scope, durationHours } });
      res.status(201).json({ id });
    },
  );

  router.delete('/:id', requireRole('patient'), validate({ params: idParam }), async (req, res) => {
    const { rows } = await query(
      'UPDATE access_grants SET revoked_at = now() WHERE id = $1 AND patient_id = $2 AND revoked_at IS NULL RETURNING doctor_id',
      [req.valid.params.id, req.user.id],
    );
    if (rows.length === 0) {
      await audit(req, { action: 'grant.revoke', outcome: 'denied', targetType: 'grant', targetId: req.valid.params.id });
      throw notFound('Grant not found.');
    }
    await audit(req, { action: 'grant.revoke', targetType: 'grant', targetId: req.valid.params.id, subjectPatientId: req.user.id, details: { doctorId: rows[0].doctor_id } });
    res.json({ ok: true });
  });

  return router;
}
