// Demo: shows what an attacker with a copy of the database (or the upload folder) would see,
// next to what the application decrypts. Run: npm run demo:peek
import fs from 'node:fs';
import path from 'node:path';
import { pool, query } from '../server/db/pool.js';
import { config } from '../server/config.js';
import { aad, decryptField } from '../server/security/crypto.js';

const short = (s, n = 70) => (s && s.length > n ? `${s.slice(0, n)}…` : s);
const line = (label, raw, plain) => {
  console.log(`  ${label}`);
  console.log(`    stored in DB : ${short(raw) ?? 'NULL'}`);
  if (plain !== undefined) console.log(`    app decrypts : ${plain ?? 'NULL'}`);
};

const user = (await query("SELECT * FROM users WHERE role = 'patient' ORDER BY created_at LIMIT 1")).rows[0];
if (!user) {
  console.log('No patients yet. Run npm run setup first.');
  process.exit(0);
}

console.log(`\n=== users: ${user.full_name} ===`);
line('password_hash (Argon2id: salted, memory-hard, one-way)', user.password_hash);
line('phone_enc (AES-256-GCM)', user.phone_enc, decryptField(user.phone_enc, aad('users', 'phone', user.id)));
line('date_of_birth_enc (AES-256-GCM)', user.date_of_birth_enc, decryptField(user.date_of_birth_enc, aad('users', 'date_of_birth', user.id)));

const records = (await query('SELECT * FROM medical_records WHERE patient_id = $1 ORDER BY created_at LIMIT 3', [user.id])).rows;
for (const r of records) {
  console.log(`\n=== medical_records ${r.id} (${r.record_type}) ===`);
  line('title_enc', r.title_enc, decryptField(r.title_enc, aad('medical_records', 'title', r.id)));
  if (r.diagnosis_enc) line('diagnosis_enc', r.diagnosis_enc, decryptField(r.diagnosis_enc, aad('medical_records', 'diagnosis', r.id)));
  if (r.description_enc) line('description_enc', r.description_enc, decryptField(r.description_enc, aad('medical_records', 'description', r.id)));
  if (r.file_storage_name) {
    const file = path.join(config.uploadDir, r.file_storage_name);
    const head = fs.readFileSync(file).subarray(0, 24);
    console.log(`  uploaded file`);
    console.log(`    on disk      : ${path.relative(config.root, file)}`);
    console.log(`    first bytes  : ${head.toString('hex')}  (a real PDF starts with 255044462d = "%PDF-")`);
    console.log(`    file key     : ${short(r.file_key_enc)}  (per-file key, wrapped by the master key)`);
    console.log(`    sha256       : ${r.file_sha256}  (checked on every download)`);
  }
}

const logs = (await query('SELECT id, action, outcome, prev_hash, hash FROM audit_logs ORDER BY id DESC LIMIT 3')).rows.reverse();
console.log('\n=== audit_logs (latest 3): each entry carries the previous entry\'s hash ===');
for (const l of logs) {
  console.log(`  #${l.id} ${l.action} (${l.outcome})`);
  console.log(`    prev_hash ${l.prev_hash.slice(0, 32)}…`);
  console.log(`    hash      ${l.hash.slice(0, 32)}…`);
}
console.log('');
await pool.end();
