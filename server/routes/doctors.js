import { Router } from 'express';
import { z } from 'zod';
import { query } from '../db/pool.js';
import { config } from '../config.js';
import { authenticate } from '../middleware/auth.js';
import { validate, uuid, isoDate } from '../middleware/validate.js';
import { notFound } from '../middleware/errors.js';

// Clinic hours: 09:00-13:00 and 14:00-17:00, 30-minute slots, closed on Sundays.
const SLOT_TIMES = ['09:00', '09:30', '10:00', '10:30', '11:00', '11:30', '12:00', '12:30', '14:00', '14:30', '15:00', '15:30', '16:00', '16:30'];
const MAX_DAYS_AHEAD = 60;

function offsetMinutes() {
  const m = config.clinicTzOffset.match(/^([+-])(\d{2}):(\d{2})$/);
  return m ? (m[1] === '-' ? -1 : 1) * (Number(m[2]) * 60 + Number(m[3])) : 0;
}

/** Calendar date (YYYY-MM-DD) of an instant, in clinic local time. */
export const clinicDate = (d) => new Date(d.getTime() + offsetMinutes() * 60000).toISOString().slice(0, 10);

export function slotsForDate(date) {
  if (new Date(`${date}T12:00:00Z`).getUTCDay() === 0) return [];
  return SLOT_TIMES.map((t) => new Date(`${date}T${t}:00${config.clinicTzOffset}`));
}

/** True if `when` is exactly one of the clinic's bookable slots, in the future and within range. */
export function isBookableSlot(when) {
  const now = Date.now();
  if (when.getTime() <= now || when.getTime() > now + MAX_DAYS_AHEAD * 86400000) return false;
  return slotsForDate(clinicDate(when)).some((s) => s.getTime() === when.getTime());
}

export function doctorRoutes() {
  const router = Router();
  router.use(authenticate());

  router.get('/', async (req, res) => {
    const { rows } = await query(
      "SELECT id, full_name, specialization FROM users WHERE role = 'doctor' AND is_active ORDER BY full_name",
    );
    res.json({ doctors: rows.map((r) => ({ id: r.id, fullName: r.full_name, specialization: r.specialization })) });
  });

  router.get(
    '/:id/slots',
    validate({ params: z.object({ id: uuid }), query: z.object({ date: isoDate }) }),
    async (req, res) => {
      const { id } = req.valid.params;
      const { date } = req.valid.query;
      const doctor = (await query("SELECT id FROM users WHERE id = $1 AND role = 'doctor' AND is_active", [id])).rows[0];
      if (!doctor) throw notFound('Doctor not found.');

      const candidates = slotsForDate(date).filter(isBookableSlot);
      if (candidates.length === 0) return res.json({ date, slots: [] });
      const { rows } = await query(
        `SELECT scheduled_at FROM appointments
          WHERE doctor_id = $1 AND status <> 'cancelled' AND scheduled_at = ANY($2::timestamptz[])`,
        [id, candidates],
      );
      const taken = new Set(rows.map((r) => r.scheduled_at.getTime()));
      res.json({ date, slots: candidates.map((s) => ({ at: s.toISOString(), available: !taken.has(s.getTime()) })) });
    },
  );

  return router;
}
