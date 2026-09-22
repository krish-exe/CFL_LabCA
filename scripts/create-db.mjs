// Creates a dedicated, least-privilege PostgreSQL role and database for SecureClinic on an
// existing PostgreSQL server, then writes DATABASE_URL to .env. The superuser password is only
// used for this one step and is never written to disk.
//
//   PowerShell:  $env:PGPASSWORD="<postgres password>"; npm run db:create
//   Bash:        PGPASSWORD='<postgres password>' npm run db:create
//
// Optional: PGUSER (default postgres), PGHOST (default 127.0.0.1), PGPORT (default 5432).
import crypto from 'node:crypto';
import pg from 'pg';
import { setEnvValues } from './env-file.mjs';

const host = process.env.PGHOST || '127.0.0.1';
const port = Number(process.env.PGPORT || 5432);
const admin = new pg.Client({
  host,
  port,
  user: process.env.PGUSER || 'postgres',
  password: process.env.PGPASSWORD,
  database: 'postgres',
});

const ROLE = 'secureclinic';
const DB = 'secureclinic';
const password = crypto.randomBytes(18).toString('base64url');

try {
  await admin.connect();
} catch (err) {
  console.error(`Could not connect as superuser: ${err.message}`);
  console.error('Set PGPASSWORD to your postgres password and try again.');
  process.exit(1);
}

// Identifiers are constants above; the password is passed through format('%L') so it is quoted safely.
const roleExists = (await admin.query('SELECT 1 FROM pg_roles WHERE rolname = $1', [ROLE])).rowCount > 0;
const { rows } = await admin.query(`SELECT format('%s ROLE ${ROLE} LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE PASSWORD %L', $1::text, $2::text) AS sql`, [
  roleExists ? 'ALTER' : 'CREATE',
  password,
]);
await admin.query(rows[0].sql);
console.log(`${roleExists ? 'Updated' : 'Created'} role ${ROLE} (no superuser, no createdb, no createrole)`);

const dbExists = (await admin.query('SELECT 1 FROM pg_database WHERE datname = $1', [DB])).rowCount > 0;
if (!dbExists) {
  await admin.query(`CREATE DATABASE ${DB} OWNER ${ROLE} ENCODING 'UTF8'`);
  console.log(`Created database ${DB} owned by ${ROLE}`);
} else {
  console.log(`Database ${DB} already exists`);
}
await admin.query(`REVOKE ALL ON DATABASE ${DB} FROM PUBLIC`);
await admin.query(`GRANT CONNECT, TEMPORARY ON DATABASE ${DB} TO ${ROLE}`);
await admin.end();

setEnvValues({ DB_MODE: 'external', DATABASE_URL: `postgres://${ROLE}:${password}@${host}:${port}/${DB}` });
console.log('Wrote DATABASE_URL to .env. Next: npm run setup (or npm run db:migrate && npm run db:seed)');
