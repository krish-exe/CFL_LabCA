// Applies server/db/migrations/*.sql in order, once each, inside a transaction per file.
import fs from 'node:fs';
import path from 'node:path';
import { pool, tx } from '../server/db/pool.js';

const dir = path.resolve(import.meta.dirname, '../server/db/migrations');

await pool.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
  name text PRIMARY KEY,
  applied_at timestamptz NOT NULL DEFAULT now()
)`);
const applied = new Set((await pool.query('SELECT name FROM schema_migrations')).rows.map((r) => r.name));

for (const file of fs.readdirSync(dir).filter((f) => f.endsWith('.sql')).sort()) {
  if (applied.has(file)) continue;
  const sql = fs.readFileSync(path.join(dir, file), 'utf8');
  await tx(async (client) => {
    await client.query(sql);
    await client.query('INSERT INTO schema_migrations (name) VALUES ($1)', [file]);
  });
  console.log(`Applied ${file}`);
}
console.log('Database schema is up to date');
await pool.end();
