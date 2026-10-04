// Object-level authorisation (IDOR protection). Every route that touches a patient's data asks
// these functions, using the identity from the verified token, never an id the client claims.
import { query } from '../db/pool.js';

export async function getActiveGrant(doctorId, patientId) {
  const { rows } = await query(
    `SELECT id, scope, expires_at FROM access_grants
      WHERE doctor_id = $1 AND patient_id = $2 AND revoked_at IS NULL AND expires_at > now()
      ORDER BY expires_at DESC LIMIT 1`,
    [doctorId, patientId],
  );
  return rows[0] ?? null;
}

/**
 * mode 'read'  - view the patient's records
 * mode 'write' - add records to the patient's file
 * Patients reach only their own data, doctors only data a patient has shared with them
 * (and only until the grant expires), admins never reach clinical data.
 */
export async function canAccessPatient(user, patientId, mode = 'read') {
  if (user.role === 'patient') return user.id === patientId;
  if (user.role === 'doctor') {
    const grant = await getActiveGrant(user.id, patientId);
    return Boolean(grant) && (mode === 'read' || grant.scope === 'read_write');
  }
  return false;
}
