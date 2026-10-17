// Demo: plays an insider with direct database access who edits the audit log to hide a record
// access, so you can show that "Verify integrity" catches it.
//
//   npm run demo:tamper                erase the actor of the latest record-access entry
//   npm run demo:tamper -- --delete    delete that entry instead
//   npm run demo:tamper -- --restore   put the original entry back
//
// The app itself can never do this: a trigger makes audit_logs append-only. This script, acting
// as the table owner, switches the trigger off for its one transaction.
import fs from 'node:fs';
import path from 'node:path';
import { pool, tx } from '../server/db/pool.js';
import { config } from '../server/config.js';
import { verifyAuditChain } from '../server/security/audit.js';

const backupFile = path.join(config.root, 'storage', 'tamper-backup.json');
const mode = process.argv.includes('--restore') ? 'restore' : process.argv.includes('--delete') ? 'delete' : 'modify';

async function withTriggerOff(fn) {
  await tx(async (client) => {
    await client.query('ALTER TABLE audit_logs DISABLE TRIGGER audit_logs_no_update');
    await fn(client);
    await client.query('ALTER TABLE audit_logs ENABLE TRIGGER audit_logs_no_update');
  });
}

if (mode === 'restore') {
  if (!fs.existsSync(backupFile)) {
    console.log('Nothing to restore.');
  } else {
    const row = JSON.parse(fs.readFileSync(backupFile, 'utf8'));
    await withTriggerOff(async (client) => {
      await client.query('DELETE FROM audit_logs WHERE id = $1', [row.id]);
      await client.query(
        `INSERT INTO audit_logs (id, ts, actor_id, actor_role, action, outcome, target_type, target_id, subject_patient_id, ip, user_agent, details, prev_hash, hash)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
        [row.id, row.ts, row.actor_id, row.actor_role, row.action, row.outcome, row.target_type, row.target_id, row.subject_patient_id, row.ip, row.user_agent, row.details, row.prev_hash, row.hash],
      );
    });
    fs.rmSync(backupFile);
    console.log(`Restored audit entry #${row.id}.`);
  }
} else {
  if (fs.existsSync(backupFile)) {
    console.log('An entry is already tampered with. Run `npm run demo:tamper -- --restore` first.');
    await pool.end();
    process.exit(1);
  }
  const { rows } = await pool.query(
    "SELECT * FROM audit_logs WHERE action LIKE 'record.%' AND actor_id IS NOT NULL ORDER BY id DESC LIMIT 1",
  );
  const row = rows[0] ?? (await pool.query('SELECT * FROM audit_logs ORDER BY id DESC OFFSET 2 LIMIT 1')).rows[0];
  if (!row) {
    console.log('The audit log is empty.');
    await pool.end();
    process.exit(1);
  }
  fs.mkdirSync(path.dirname(backupFile), { recursive: true });
  fs.writeFileSync(backupFile, JSON.stringify(row, null, 2));

  await withTriggerOff(async (client) => {
    if (mode === 'delete') await client.query('DELETE FROM audit_logs WHERE id = $1', [row.id]);
    else await client.query('UPDATE audit_logs SET actor_id = NULL, actor_role = NULL, ip = NULL WHERE id = $1', [row.id]);
  });
  console.log(
    mode === 'delete'
      ? `Deleted audit entry #${row.id} (${row.action}).`
      : `Erased who performed audit entry #${row.id} (${row.action}): actor ${row.actor_id} -> NULL.`,
  );
}

const result = await verifyAuditChain();
console.log(result.ok ? `Chain verifies: ${result.checked} entries intact.` : `Chain check: TAMPERING DETECTED at #${result.brokenAtId}. ${result.reason}`);
if (mode !== 'restore') console.log('Now open Admin > Overview > Verify integrity in the app. Undo with `npm run demo:tamper -- --restore`.');
await pool.end();
