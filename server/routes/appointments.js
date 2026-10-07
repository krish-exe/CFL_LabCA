import crypto from 'node:crypto';
import { Router } from 'express';
import { z } from 'zod';
import { query } from '../db/pool.js';
import { authenticate, requireRole } from '../middleware/auth.js';
import { validate, uuid, text, idParam } from '../middleware/validate.js';
import { HttpError, notFound } from '../middleware/errors.js';
import { aad, encryptField, decryptField } from '../security/crypto.js';
import { audit } from '../security/audit.js';
import { isBookableSlot } from './doctors.js';

const SELECT = `
  SELECT a.*, p.full_name AS patient_name, d.full_name AS doctor_name, d.specialization AS doctor_specialization
    FROM appointments a
    JOIN users p ON p.id = a.patient_id
    JOIN users d ON d.id = a.doctor_id`;

function present(row) {
  return {
    id: row.id,
    scheduledAt: row.scheduled_at,
    status: row.status,
    reason: decryptField(row.reason_enc, aad('appointments', 'reason', row.id)),
    notes: decryptField(row.notes_enc, aad('appointments', 'notes', row.id)),
    patient: { id: row.patient_id, fullName: row.patient_name },
    doctor: { id: row.doctor_id, fullName: row.doctor_name, specialization: row.doctor_specialization },
    createdAt: row.created_at,
  };
}

// Which status changes each role may make.
const TRANSITIONS = {
  patient: { requested: ['cancelled'], confirmed: ['cancelled'] },
  doctor: { requested: ['confirmed', 'cancelled'], confirmed: ['completed', 'cancelled'] },
};

export function appointmentRoutes() {
  const router = Router();
  router.use(authenticate(), requireRole('patient', 'doctor'));

  router.get('/', validate({ query: z.object({ when: z.enum(['upcoming', 'past', 'all']).default('all') }) }), async (req, res) => {
    const filter = { upcoming: 'AND a.scheduled_at >= now() - interval \'30 minutes\'', past: 'AND a.scheduled_at < now() - interval \'30 minutes\'', all: '' }[req.valid.query.when];
    const order = req.valid.query.when === 'past' ? 'DESC' : 'ASC';
    // The WHERE clause scopes every query to the signed-in user: the list can't include anyone else's appointments.
    const column = req.user.role === 'doctor' ? 'a.doctor_id' : 'a.patient_id';
    const { rows } = await query(`${SELECT} WHERE ${column} = $1 ${filter} ORDER BY a.scheduled_at ${order} LIMIT 200`, [req.user.id]);
    res.json({ appointments: rows.map(present) });
  });

  router.post(
    '/',
    requireRole('patient'),
    validate({ body: z.object({ doctorId: uuid, scheduledAt: z.iso.datetime({ offset: true }), reason: text(500, 3) }) }),
    async (req, res) => {
      const { doctorId, scheduledAt, reason } = req.valid.body;
      const when = new Date(scheduledAt);
      if (!isBookableSlot(when)) throw new HttpError(400, 'Pick one of the available time slots.');
      const doctor = (await query("SELECT id FROM users WHERE id = $1 AND role = 'doctor' AND is_active", [doctorId])).rows[0];
      if (!doctor) throw notFound('Doctor not found.');

      const id = crypto.randomUUID();
      try {
        await query(
          `INSERT INTO appointments (id, patient_id, doctor_id, scheduled_at, reason_enc) VALUES ($1, $2, $3, $4, $5)`,
          [id, req.user.id, doctorId, when, encryptField(reason, aad('appointments', 'reason', id))],
        );
      } catch (err) {
        if (err.code === '23505') throw new HttpError(409, 'That slot was just taken, or you already have an appointment then. Pick another time.');
        throw err;
      }
      await audit(req, { action: 'appointment.create', targetType: 'appointment', targetId: id, subjectPatientId: req.user.id, details: { doctorId } });
      const { rows } = await query(`${SELECT} WHERE a.id = $1`, [id]);
      res.status(201).json({ appointment: present(rows[0]) });
    },
  );

  router.patch(
    '/:id',
    validate({
      params: idParam,
      body: z
        .object({ status: z.enum(['confirmed', 'completed', 'cancelled']).optional(), notes: text(4000).optional() })
        .refine((b) => b.status !== undefined || b.notes !== undefined, 'Nothing to update.'),
    }),
    async (req, res) => {
      const { id } = req.valid.params;
      const { status, notes } = req.valid.body;
      const column = req.user.role === 'doctor' ? 'doctor_id' : 'patient_id';
      const appt = (await query(`SELECT * FROM appointments WHERE id = $1 AND ${column} = $2`, [id, req.user.id])).rows[0];
      if (!appt) {
        await audit(req, { action: 'appointment.update', outcome: 'denied', targetType: 'appointment', targetId: id, details: { reason: 'not_owner_or_missing' } });
        throw notFound('Appointment not found.');
      }
      if (status && status !== appt.status && !TRANSITIONS[req.user.role][appt.status]?.includes(status)) {
        throw new HttpError(400, `You can't change an appointment from ${appt.status} to ${status}.`);
      }
      if (notes !== undefined && req.user.role !== 'doctor') throw new HttpError(403, 'Only the doctor can write visit notes.');

      await query(
        `UPDATE appointments SET status = COALESCE($2, status), notes_enc = COALESCE($3, notes_enc), updated_at = now() WHERE id = $1`,
        [id, status ?? null, notes === undefined ? null : encryptField(notes, aad('appointments', 'notes', id))],
      );
      await audit(req, {
        action: 'appointment.update',
        targetType: 'appointment',
        targetId: id,
        subjectPatientId: appt.patient_id,
        details: { status: status ?? null, notesChanged: notes !== undefined },
      });
      const { rows } = await query(`${SELECT} WHERE a.id = $1`, [id]);
      res.json({ appointment: present(rows[0]) });
    },
  );

  return router;
}
