// Medical records: every field and every uploaded file is encrypted at rest, every read is
// audited, and every request is checked against the patient's sharing grants (IDOR protection).
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { Router } from 'express';
import multer from 'multer';
import { z } from 'zod';
import { query } from '../db/pool.js';
import { config } from '../config.js';
import { authenticate, requireRole } from '../middleware/auth.js';
import { validate, uuid, text, optionalText, idParam } from '../middleware/validate.js';
import { HttpError, notFound } from '../middleware/errors.js';
import { aad, encryptField, decryptField, newFileKey, unwrapFileKey, encryptFile, decryptFile, sha256 } from '../security/crypto.js';
import { canAccessPatient } from '../security/access.js';
import { audit } from '../security/audit.js';

const RECORD_TYPES = ['prescription', 'lab_report', 'diagnosis', 'imaging', 'note', 'other'];
const PATIENT_TYPES = ['lab_report', 'imaging', 'prescription', 'other'];

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: config.maxUploadBytes, files: 1, fields: 10, fieldSize: 8 * 1024 },
});

/** Identify the file type from its first bytes. The client's declared MIME type and extension are ignored. */
function sniffFileType(buf) {
  if (buf.length >= 5 && buf.subarray(0, 5).toString('latin1') === '%PDF-') return 'application/pdf';
  if (buf.length >= 8 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  if (buf.length >= 12 && buf.subarray(0, 4).toString('latin1') === 'RIFF' && buf.subarray(8, 12).toString('latin1') === 'WEBP') return 'image/webp';
  return null;
}

function safeFileName(name) {
  const base = path.basename(String(name || 'file')).replace(/[\u0000-\u001F\u007F<>:"/\\|?*]/g, '_').trim();
  return (base || 'file').slice(0, 120);
}

const SELECT = `
  SELECT r.*, u.full_name AS creator_name, u.role AS creator_role
    FROM medical_records r JOIN users u ON u.id = r.created_by`;

function present(row) {
  const dec = (col) => decryptField(row[`${col}_enc`], aad('medical_records', col, row.id));
  return {
    id: row.id,
    patientId: row.patient_id,
    type: row.record_type,
    title: dec('title'),
    description: dec('description'),
    diagnosis: dec('diagnosis'),
    createdAt: row.created_at,
    createdBy: { id: row.created_by, fullName: row.creator_name, role: row.creator_role },
    file: row.file_storage_name ? { name: dec('file_name'), mime: row.file_mime, size: row.file_size } : null,
  };
}

/**
 * Loads a record only if the caller may access its patient. Records the caller can't see
 * get the same 404 as records that don't exist, and the attempt is audited.
 */
async function loadAccessibleRecord(req, id, mode = 'read') {
  const row = (await query(`${SELECT} WHERE r.id = $1`, [id])).rows[0];
  if (!row || !(await canAccessPatient(req.user, row.patient_id, mode))) {
    await audit(req, {
      action: 'record.access',
      outcome: 'denied',
      targetType: 'record',
      targetId: id,
      subjectPatientId: row?.patient_id ?? null,
      details: { reason: row ? 'no_permission' : 'not_found', mode },
    });
    throw notFound('Record not found.');
  }
  return row;
}

export function recordRoutes(limiters) {
  const router = Router();
  router.use(authenticate(), requireRole('patient', 'doctor'));

  // List one patient's records. Patients always get their own; doctors must name a patient who shared with them.
  router.get('/', validate({ query: z.object({ patientId: uuid.optional() }) }), async (req, res) => {
    const patientId = req.user.role === 'patient' ? req.user.id : req.valid.query.patientId;
    if (!patientId) throw new HttpError(400, 'Choose a patient.');
    if (!(await canAccessPatient(req.user, patientId, 'read'))) {
      await audit(req, { action: 'record.list', outcome: 'denied', targetType: 'patient', targetId: patientId, subjectPatientId: patientId, details: { reason: 'no_active_grant' } });
      throw notFound('No records available for this patient. Ask them to share access with you.');
    }
    const { rows } = await query(`${SELECT} WHERE r.patient_id = $1 ORDER BY r.created_at DESC LIMIT 500`, [patientId]);
    await audit(req, { action: 'record.list', targetType: 'patient', targetId: patientId, subjectPatientId: patientId, details: { count: rows.length } });
    res.json({ records: rows.map(present) });
  });

  router.get('/:id', validate({ params: idParam }), async (req, res) => {
    const row = await loadAccessibleRecord(req, req.valid.params.id);
    await audit(req, { action: 'record.view', targetType: 'record', targetId: row.id, subjectPatientId: row.patient_id });
    res.json({ record: present(row) });
  });

  router.get('/:id/file', validate({ params: idParam }), async (req, res) => {
    const row = await loadAccessibleRecord(req, req.valid.params.id);
    if (!row.file_storage_name) throw notFound('This record has no file.');

    const blob = await fs.readFile(path.join(config.uploadDir, row.file_storage_name));
    const key = unwrapFileKey(row.file_key_enc, row.id);
    const plaintext = decryptFile(blob, key, aad('medical_records', 'file', row.id));
    if (sha256(plaintext) !== row.file_sha256) throw new Error(`Integrity check failed for record ${row.id}`);

    await audit(req, { action: 'record.download', targetType: 'record', targetId: row.id, subjectPatientId: row.patient_id });
    res.attachment(decryptField(row.file_name_enc, aad('medical_records', 'file_name', row.id)) || 'record');
    res.type(row.file_mime);
    res.set('Content-Security-Policy', "default-src 'none'; sandbox");
    res.send(plaintext);
  });

  router.post('/', limiters.upload, upload.single('file'), validate({
    body: z.object({
      patientId: uuid.optional(),
      type: z.enum(RECORD_TYPES),
      title: text(150, 2),
      description: optionalText(4000),
      diagnosis: optionalText(2000),
    }),
  }), async (req, res) => {
    const body = req.valid.body;
    const patientId = req.user.role === 'patient' ? req.user.id : body.patientId;
    if (!patientId) throw new HttpError(400, 'Choose a patient.');

    if (req.user.role === 'patient') {
      if (!PATIENT_TYPES.includes(body.type)) throw new HttpError(403, 'Only a doctor can add this type of record.');
      if (body.diagnosis) throw new HttpError(403, 'Only a doctor can record a diagnosis.');
    } else if (!(await canAccessPatient(req.user, patientId, 'write'))) {
      await audit(req, { action: 'record.create', outcome: 'denied', targetType: 'patient', targetId: patientId, subjectPatientId: patientId, details: { reason: 'no_write_grant' } });
      throw new HttpError(403, "You need this patient's permission to add to their records (view & add access).");
    }

    const id = crypto.randomUUID();
    const enc = (col, value) => encryptField(value, aad('medical_records', col, id));
    let fileColumns = [null, null, null, null, null, null];
    let storagePath = null;

    if (req.file) {
      const mime = sniffFileType(req.file.buffer);
      if (!mime) throw new HttpError(415, 'Only PDF, PNG, JPEG or WebP files are accepted.');
      const { key, wrapped } = newFileKey(id);
      const storageName = `${crypto.randomUUID()}.bin`;
      storagePath = path.join(config.uploadDir, storageName);
      await fs.mkdir(config.uploadDir, { recursive: true });
      await fs.writeFile(storagePath, encryptFile(req.file.buffer, key, aad('medical_records', 'file', id)), { flag: 'wx', mode: 0o600 });
      fileColumns = [storageName, enc('file_name', safeFileName(req.file.originalname)), mime, req.file.size, wrapped, sha256(req.file.buffer)];
    } else if (body.type === 'lab_report' || body.type === 'imaging') {
      throw new HttpError(400, 'Attach the report file.');
    }

    try {
      await query(
        `INSERT INTO medical_records (id, patient_id, created_by, record_type, title_enc, description_enc, diagnosis_enc,
           file_storage_name, file_name_enc, file_mime, file_size, file_key_enc, file_sha256)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
        [id, patientId, req.user.id, body.type, enc('title', body.title), enc('description', body.description), enc('diagnosis', body.diagnosis), ...fileColumns],
      );
    } catch (err) {
      if (storagePath) await fs.rm(storagePath, { force: true });
      throw err;
    }
    await audit(req, { action: 'record.create', targetType: 'record', targetId: id, subjectPatientId: patientId, details: { type: body.type, hasFile: Boolean(req.file) } });
    const { rows } = await query(`${SELECT} WHERE r.id = $1`, [id]);
    res.status(201).json({ record: present(rows[0]) });
  });

  router.delete('/:id', validate({ params: idParam }), async (req, res) => {
    const row = await loadAccessibleRecord(req, req.valid.params.id, req.user.role === 'doctor' ? 'write' : 'read');
    if (row.created_by !== req.user.id) throw new HttpError(403, 'You can only delete records you added yourself.');
    await query('DELETE FROM medical_records WHERE id = $1', [row.id]);
    if (row.file_storage_name) await fs.rm(path.join(config.uploadDir, row.file_storage_name), { force: true });
    await audit(req, { action: 'record.delete', targetType: 'record', targetId: row.id, subjectPatientId: row.patient_id });
    res.json({ ok: true });
  });

  return router;
}
