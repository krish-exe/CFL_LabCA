// Embedded PostgreSQL: a private PostgreSQL 18 server for this project, using the binaries
// bundled by the `embedded-postgres` npm package (so nothing has to be installed). Data lives in
// .data/postgres and the server listens on 127.0.0.1 only.
//
//   node scripts/local-db.mjs          create (first time) and start it
//   node scripts/local-db.mjs stop     stop it
//   node scripts/local-db.mjs status
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import pg from 'pg';
import { root, readEnv, setEnvValues } from './env-file.mjs';

export const dataDir = path.join(root, '.data', 'postgres');
const DEFAULT_PORT = 54329;
const PLATFORM_PACKAGES = {
  'win32-x64': 'windows-x64',
  'darwin-arm64': 'darwin-arm64',
  'darwin-x64': 'darwin-x64',
  'linux-x64': 'linux-x64',
  'linux-arm64': 'linux-arm64',
  'linux-arm': 'linux-arm',
  'linux-ia32': 'linux-ia32',
  'linux-ppc64': 'linux-ppc64',
};

/** Paths of initdb and pg_ctl: the bundled binaries, or an installed PostgreSQL as a fallback. */
async function findBinaries() {
  const name = PLATFORM_PACKAGES[`${os.platform()}-${os.arch()}`];
  if (name) {
    try {
      const fromRoot = createRequire(path.join(root, 'package.json'));
      const fromEmbedded = createRequire(fromRoot.resolve('embedded-postgres'));
      const bins = await import(pathToFileURL(fromEmbedded.resolve(`@embedded-postgres/${name}`)).href);
      hydrateSymlinks(path.dirname(path.dirname(bins.pg_ctl)));
      return { initdb: bins.initdb, pg_ctl: bins.pg_ctl };
    } catch {
      // not installed for this platform; try a system PostgreSQL below
    }
  }
  const exe = process.platform === 'win32' ? '.exe' : '';
  const candidates = [process.env.PG_BIN];
  const base = 'C:\\Program Files\\PostgreSQL';
  if (process.platform === 'win32' && fs.existsSync(base)) {
    for (const v of fs.readdirSync(base).sort((a, b) => b - a)) candidates.push(path.join(base, v, 'bin'));
  }
  for (const dir of candidates.filter(Boolean)) {
    if (fs.existsSync(path.join(dir, `initdb${exe}`))) return { initdb: path.join(dir, `initdb${exe}`), pg_ctl: path.join(dir, `pg_ctl${exe}`) };
  }
  throw new Error('No PostgreSQL binaries found. Run `npm install` (it bundles PostgreSQL), or set PG_BIN.');
}

/**
 * On macOS/Linux the bundled shared libraries need their symlinks recreated after install. The
 * package's own postinstall does this, but pnpm skips install scripts by default, so repeat it here.
 */
function hydrateSymlinks(nativeDir) {
  if (process.platform === 'win32') return;
  const file = path.join(nativeDir, 'pg-symlinks.json');
  if (!fs.existsSync(file)) return;
  const pkgRoot = path.dirname(nativeDir);
  for (const { source, target } of JSON.parse(fs.readFileSync(file, 'utf8'))) {
    const src = path.resolve(pkgRoot, source);
    const link = path.resolve(pkgRoot, target);
    if (!fs.existsSync(link)) {
      try {
        fs.symlinkSync(path.relative(path.dirname(link), src), link);
      } catch {}
    }
  }
}

function portFree(port) {
  return new Promise((resolve) => {
    const srv = net.createServer().once('error', () => resolve(false)).once('listening', () => srv.close(() => resolve(true)));
    srv.listen(port, '127.0.0.1');
  });
}

function isRunning(pg_ctl) {
  try {
    execFileSync(pg_ctl, ['-D', dataDir, 'status'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

/** Creates the cluster on first use, starts it if needed, and makes sure the database exists. */
export async function ensureEmbeddedDatabase({ quiet = false } = {}) {
  const log = quiet ? () => {} : console.log;
  const { initdb, pg_ctl } = await findBinaries();

  if (!fs.existsSync(path.join(dataDir, 'PG_VERSION'))) {
    await createCluster({ initdb, pg_ctl, log });
  } else if (!isRunning(pg_ctl)) {
    start(pg_ctl);
    log('Started embedded PostgreSQL');
  }
}

function start(pg_ctl) {
  // stdio 'ignore': the detached server would otherwise hold this process's output pipes open.
  execFileSync(pg_ctl, ['-D', dataDir, '-l', path.join(dataDir, 'server.log'), '-w', '-t', '60', 'start'], { stdio: 'ignore' });
}

/**
 * First run: initdb with a throwaway superuser password, then a least-privilege app role that owns
 * only the secureclinic database (no superuser, no createdb, no createrole). Only the app role's
 * password is kept, in .env.
 */
async function createCluster({ initdb, pg_ctl, log }) {
  let port = DEFAULT_PORT;
  while (!(await portFree(port))) port++;
  const superPassword = crypto.randomBytes(24).toString('base64url');
  const appPassword = crypto.randomBytes(18).toString('base64url');
  fs.mkdirSync(dataDir, { recursive: true });
  const pwFile = path.join(root, '.data', 'pw.tmp');
  fs.writeFileSync(pwFile, superPassword, { mode: 0o600 });
  try {
    execFileSync(initdb, ['-D', dataDir, '-U', 'postgres', '--auth=scram-sha-256', `--pwfile=${pwFile}`, '-E', 'UTF8', '--no-locale'], { stdio: 'ignore' });
  } finally {
    fs.rmSync(pwFile, { force: true });
  }
  // Loopback only, and small memory settings so it is light on low-end machines.
  fs.appendFileSync(
    path.join(dataDir, 'postgresql.conf'),
    `
listen_addresses = '127.0.0.1'
port = ${port}
shared_buffers = 32MB
max_connections = 40
`,
  );

  try {
    start(pg_ctl);
    const admin = new pg.Client({ host: '127.0.0.1', port, user: 'postgres', password: superPassword, database: 'postgres' });
    await admin.connect();
    const { rows } = await admin.query(
      "SELECT format('CREATE ROLE secureclinic LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE PASSWORD %L', $1::text) AS sql",
      [appPassword],
    );
    await admin.query(rows[0].sql);
    await admin.query("CREATE DATABASE secureclinic OWNER secureclinic ENCODING 'UTF8'");
    await admin.query('REVOKE ALL ON DATABASE secureclinic FROM PUBLIC');
    await admin.query('GRANT CONNECT, TEMPORARY ON DATABASE secureclinic TO secureclinic');
    await admin.end();
  } catch (err) {
    // Leave nothing half-built behind, so the next run starts clean.
    try {
      execFileSync(pg_ctl, ['-D', dataDir, 'stop', '-m', 'immediate'], { stdio: 'ignore' });
    } catch {}
    fs.rmSync(dataDir, { recursive: true, force: true });
    throw err;
  }

  setEnvValues({ DB_MODE: 'embedded', DATABASE_URL: `postgres://secureclinic:${appPassword}@127.0.0.1:${port}/secureclinic` });
  log(`Created and started the embedded PostgreSQL database in .data/postgres (port ${port})`);
}

export async function stopEmbeddedDatabase() {
  if (!fs.existsSync(path.join(dataDir, 'PG_VERSION'))) return console.log('No embedded database in this project.');
  const { pg_ctl } = await findBinaries();
  if (!isRunning(pg_ctl)) return console.log('Embedded PostgreSQL is not running.');
  execFileSync(pg_ctl, ['-D', dataDir, 'stop', '-m', 'fast'], { stdio: 'ignore' });
  console.log('Stopped embedded PostgreSQL');
}

// CLI
if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const cmd = process.argv[2] ?? 'start';
  if (cmd === 'stop') await stopEmbeddedDatabase();
  else if (cmd === 'status') {
    const { pg_ctl } = await findBinaries();
    console.log(fs.existsSync(path.join(dataDir, 'PG_VERSION')) && isRunning(pg_ctl) ? 'Embedded PostgreSQL is running' : 'Embedded PostgreSQL is not running');
  } else {
    const env = readEnv();
    if (env.DB_MODE !== 'embedded' && env.DATABASE_URL && !env.DATABASE_URL.includes('CHANGE_ME')) {
      console.log('This copy uses your own PostgreSQL server (DATABASE_URL in .env), so there is no embedded database to start.');
      process.exit(0);
    }
    await ensureEmbeddedDatabase();
    console.log(`Embedded PostgreSQL ready at ${new URL(readEnv().DATABASE_URL).host}`);
  }
}
