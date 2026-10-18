// One-command setup for a fresh clone:  npm run setup
//
// 1. installs dependencies (they include a bundled PostgreSQL 18, so nothing else is needed)
// 2. creates .env with random secrets and a self-signed HTTPS certificate
// 3. creates and starts the embedded database (or uses DATABASE_URL if you configured your own)
// 4. creates the tables and demo data
// 5. builds the web app
//
// Uses only Node built-ins until the dependencies are installed. Safe to run again.
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { root, readEnv } from './env-file.mjs';

const major = Number(process.versions.node.split('.')[0]);
if (major < 22) {
  console.error(`SecureClinic needs Node.js 22 or newer (you have ${process.versions.node}). Get it from https://nodejs.org`);
  process.exit(1);
}

function step(title) {
  console.log(`\n▸ ${title}`);
}

function sh(command, args) {
  // `npm run` exports the user's allow-scripts setting as an env var, which npm 12+ treats
  // like the --allow-scripts flag and rejects in project installs. package.json#allowScripts applies instead.
  const env = { ...process.env };
  for (const key of Object.keys(env)) if (/^npm_config_allow[-_]scripts$/i.test(key)) delete env[key];
  // npm/pnpm are .cmd scripts on Windows and must run through a shell.
  const result = spawnSync([command, ...args].join(' '), { cwd: root, stdio: 'inherit', shell: true, env });
  if (result.status !== 0) {
    console.error(`\n✖ "${command} ${args.join(' ')}" failed. Fix the error above and run setup again.`);
    process.exit(result.status ?? 1);
  }
}

function node(script, args = [], { env = false } = {}) {
  const flags = env ? ['--env-file=.env'] : [];
  const result = spawnSync(process.execPath, [...flags, script, ...args], { cwd: root, stdio: 'inherit' });
  if (result.status !== 0) {
    console.error(`\n✖ ${script} failed. Fix the error above and run setup again.`);
    process.exit(result.status ?? 1);
  }
}

const usingPnpm = (process.env.npm_config_user_agent ?? '').startsWith('pnpm');

step(`Installing dependencies with ${usingPnpm ? 'pnpm' : 'npm'}`);
if (usingPnpm) sh('pnpm', ['install']);
else sh('npm', ['install', '--no-audit', '--no-fund']);

step('Creating secrets and the HTTPS certificate');
node('scripts/bootstrap.mjs');

const dbUrl = readEnv().DATABASE_URL ?? '';
const external = readEnv().DB_MODE !== 'embedded' && dbUrl && !dbUrl.includes('CHANGE_ME');
if (external) {
  step(`Using your PostgreSQL server from .env (${new URL(dbUrl).host})`);
} else {
  step('Starting the embedded PostgreSQL database');
  node('scripts/local-db.mjs');
}

step('Creating tables');
node('scripts/migrate.mjs', [], { env: true });

step('Adding demo data');
node('scripts/seed.mjs', [], { env: true });

step('Building the web app');
node(path.join('node_modules', 'vite', 'bin', 'vite.js'), ['build', '--logLevel', 'warn']);

const port = readEnv().HTTPS_PORT || 8443;
console.log(`
✔ SecureClinic is ready.

  Start it:   npm start
  Then open:  https://localhost:${port}
              (the certificate is self-signed: choose "Advanced" → "Proceed" once)

  Demo accounts are listed in README.md. Stop the database later with: npm run db:stop
`);
