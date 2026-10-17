// Seeds demo accounts and sample data. `npm run db:reset` wipes the database first.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { pool, query } from '../server/db/pool.js';
import { config } from '../server/config.js';
import { aad, encryptField, newFileKey, encryptFile, sha256 } from '../server/security/crypto.js';
import { hashPassword, checkPasswordPolicy } from '../server/security/password.js';
import { audit } from '../server/security/audit.js';
import { slotsForDate, clinicDate } from '../server/routes/doctors.js';

// Demo accounts. Admins and doctors must enrol an authenticator app at first sign-in.
export const DEMO_USERS = [
  { key: 'admin', role: 'admin', fullName: 'Neha Kulkarni', email: 'admin@secureclinic.test', password: 'Harbor#Lantern42' },
  { key: 'mehta', role: 'doctor', fullName: 'Arjun Mehta', email: 'arjun.mehta@secureclinic.test', password: 'Cardio#Maple2026', specialization: 'Cardiology' },
  { key: 'iyer', role: 'doctor', fullName: 'Ananya Iyer', email: 'ananya.iyer@secureclinic.test', password: 'Derma#Willow2026', specialization: 'Dermatology' },
  { key: 'desai', role: 'doctor', fullName: 'Rohan Desai', email: 'rohan.desai@secureclinic.test', password: 'General#Cedar2026', specialization: 'General Medicine' },
  { key: 'aarav', role: 'patient', fullName: 'Aarav Shah', email: 'aarav.shah@secureclinic.test', password: 'Sunrise#Tulip77', phone: '+91 98200 11223', dob: '1998-04-17' },
  { key: 'diya', role: 'patient', fullName: 'Diya Patel', email: 'diya.patel@secureclinic.test', password: 'Monsoon#Lotus88', phone: '+91 98670 44556', dob: '2001-11-02' },
];

const root = path.resolve(import.meta.dirname, '..');

if (process.argv.includes('--reset')) {
  await pool.query('DROP SCHEMA public CASCADE');
  await pool.query('CREATE SCHEMA public');
  fs.rmSync(config.uploadDir, { recursive: true, force: true });
  console.log('Database and encrypted uploads wiped');
  execFileSync(process.execPath, ['--env-file=.env', 'scripts/migrate.mjs'], { cwd: root, stdio: 'inherit' });
}

const existing = await query('SELECT count(*)::int AS n FROM users');
if (existing.rows[0].n > 0) {
  console.log('Database already has users; nothing seeded. Use `npm run db:reset` to start over.');
  await pool.end();
  process.exit(0);
}

/** A small, valid one-page PDF with the given lines of text. */
function makePdf(lines) {
  const content = ['BT', '/F1 12 Tf', '50 780 Td', '16 TL', ...lines.map((l) => `(${l.replace(/[()\\]/g, '\\$&')}) '`), 'ET'].join('\n');
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    `<< /Length ${Buffer.byteLength(content)} >>\nstream\n${content}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];
  let pdf = '%PDF-1.4\n';
  const offsets = [];
  objects.forEach((obj, i) => {
    offsets.push(Buffer.byteLength(pdf));
    pdf += `${i + 1} 0 obj\n${obj}\nendobj\n`;
  });
  const xref = Buffer.byteLength(pdf);
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}`;
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(pdf, 'latin1');
}

const ids = {};
for (const u of DEMO_USERS) {
  const problems = checkPasswordPolicy(u.password, { email: u.email, fullName: u.fullName });
  if (problems.length) throw new Error(`Seed password for ${u.email} breaks the policy: ${problems.join(' ')}`);
  const id = crypto.randomUUID();
  ids[u.key] = id;
  await query(
    `INSERT INTO users (id, email, password_hash, role, full_name, specialization, phone_enc, date_of_birth_enc)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [id, u.email, await hashPassword(u.password), u.role, u.fullName, u.specialization ?? null,
      encryptField(u.phone, aad('users', 'phone', id)), encryptField(u.dob, aad('users', 'date_of_birth', id))],
  );
}

// Appointments: next two clinic slots that are a few days out, plus one completed visit last month.
const day = (offset) => clinicDate(new Date(Date.now() + offset * 86400000));
const futureSlots = [];
for (let d = 2; futureSlots.length < 2 && d < 14; d++) futureSlots.push(...slotsForDate(day(d)).slice(2, 3));
let pastSlot;
for (let d = -28; !pastSlot; d--) pastSlot = slotsForDate(day(d))[3];

async function addAppointment(patient, doctor, when, status, reason, notes) {
  const id = crypto.randomUUID();
  await query(
    `INSERT INTO appointments (id, patient_id, doctor_id, scheduled_at, status, reason_enc, notes_enc) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
    [id, ids[patient], ids[doctor], when, status, encryptField(reason, aad('appointments', 'reason', id)), encryptField(notes, aad('appointments', 'notes', id))],
  );
}
await addAppointment('aarav', 'mehta', pastSlot, 'completed', 'Chest tightness after climbing stairs', 'ECG normal. Lipid profile ordered. Advised 30 min brisk walk daily.');
await addAppointment('aarav', 'mehta', futureSlots[0], 'confirmed', 'Follow-up on lipid profile results', null);
await addAppointment('diya', 'iyer', futureSlots[1] ?? futureSlots[0], 'requested', 'Recurring rash on forearms', null);

// Aarav shares his records with Dr. Mehta for 3 days (view & add). Diya shares nothing.
await query(
  `INSERT INTO access_grants (id, patient_id, doctor_id, scope, expires_at) VALUES ($1, $2, $3, 'read_write', now() + interval '72 hours')`,
  [crypto.randomUUID(), ids.aarav, ids.mehta],
);

const uploadDir = config.uploadDir;
fs.mkdirSync(uploadDir, { recursive: true });

async function addRecord({ patient, creator, type, title, description = null, diagnosis = null, file = null }) {
  const id = crypto.randomUUID();
  const enc = (col, v) => encryptField(v, aad('medical_records', col, id));
  let fileCols = [null, null, null, null, null, null];
  if (file) {
    const { key, wrapped } = newFileKey(id);
    const storageName = `${crypto.randomUUID()}.bin`;
    fs.writeFileSync(path.join(uploadDir, storageName), encryptFile(file.data, key, aad('medical_records', 'file', id)), { mode: 0o600 });
    fileCols = [storageName, enc('file_name', file.name), 'application/pdf', file.data.length, wrapped, sha256(file.data)];
  }
  await query(
    `INSERT INTO medical_records (id, patient_id, created_by, record_type, title_enc, description_enc, diagnosis_enc,
       file_storage_name, file_name_enc, file_mime, file_size, file_key_enc, file_sha256)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
    [id, ids[patient], ids[creator], type, enc('title', title), enc('description', description), enc('diagnosis', diagnosis), ...fileCols],
  );
}

await addRecord({
  patient: 'aarav', creator: 'aarav', type: 'lab_report', title: 'Lipid profile',
  description: 'Fasting lipid panel from Metro Diagnostics.',
  file: { name: 'lipid-profile.pdf', data: makePdf(['Metro Diagnostics - Lipid Profile', 'Patient: Aarav Shah', '', 'Total cholesterol: 232 mg/dL (high)', 'LDL: 158 mg/dL (high)', 'HDL: 41 mg/dL', 'Triglycerides: 165 mg/dL', '', 'Sample data generated for the SecureClinic demo.']) },
});
await addRecord({
  patient: 'aarav', creator: 'mehta', type: 'diagnosis', title: 'Hypercholesterolaemia',
  description: 'Raised LDL on fasting lipid panel; no symptoms of angina at rest.', diagnosis: 'Primary hypercholesterolaemia (ICD-10 E78.0)',
});
await addRecord({
  patient: 'aarav', creator: 'mehta', type: 'prescription', title: 'Atorvastatin 10 mg',
  description: 'Atorvastatin 10 mg, one tablet at night for 90 days. Repeat lipid profile after 3 months.',
});
await addRecord({
  patient: 'diya', creator: 'diya', type: 'lab_report', title: 'Complete blood count',
  description: 'Routine CBC before dermatology consult.',
  file: { name: 'cbc-report.pdf', data: makePdf(['City Lab - Complete Blood Count', 'Patient: Diya Patel', '', 'Haemoglobin: 12.9 g/dL', 'WBC: 7,400 /uL', 'Platelets: 2.6 lakh /uL', '', 'Sample data generated for the SecureClinic demo.']) },
});

await audit(null, { action: 'system.seeded', details: { users: DEMO_USERS.length } });

console.log('\nSeeded demo data. Demo accounts:');
for (const u of DEMO_USERS) console.log(`  ${u.role.padEnd(8)} ${u.email.padEnd(32)} ${u.password}`);
console.log('\nAdmins and doctors will be asked to set up an authenticator app at first sign-in.');
await pool.end();
