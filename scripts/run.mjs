// Task runner behind the npm scripts. Loads .env, starts the embedded PostgreSQL first when the
// project uses it, then runs the task. Works the same with npm and pnpm on Windows, macOS and Linux.
//
//   node scripts/run.mjs <start|dev|test|migrate|seed|peek|tamper> [args...]
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { root, envPath, readEnv } from './env-file.mjs';

const TASKS = {
  start: ['server/index.js'],
  migrate: ['scripts/migrate.mjs'],
  seed: ['scripts/seed.mjs'],
  peek: ['scripts/demo-peek.mjs'],
  tamper: ['scripts/demo-tamper.mjs'],
  test: ['--test', '--test-concurrency=1', 'tests/*.test.mjs'],
};

const [task, ...extra] = process.argv.slice(2);
if (!TASKS[task] && task !== 'dev') {
  console.error(`Unknown task "${task}". Use one of: ${[...Object.keys(TASKS), 'dev'].join(', ')}`);
  process.exit(1);
}
if (!fs.existsSync(envPath)) {
  console.error('This project is not set up yet. Run `npm run setup` first.');
  process.exit(1);
}

if (readEnv().DB_MODE === 'embedded') {
  const { ensureEmbeddedDatabase } = await import('./local-db.mjs');
  await ensureEmbeddedDatabase({ quiet: true });
}

function run(args, label) {
  const child = spawn(process.execPath, ['--env-file=.env', ...args], { cwd: root, stdio: 'inherit' });
  child.label = label;
  return child;
}

if (task === 'dev') {
  // API with auto-restart on server changes, plus the Vite dev server with hot reload.
  const children = [
    run(['--watch-path=server', 'server/index.js'], 'api'),
    run([path.join(root, 'node_modules', 'vite', 'bin', 'vite.js')], 'vite'),
  ];
  const stopAll = () => children.forEach((c) => c.exitCode === null && c.kill());
  for (const c of children) c.on('exit', (code) => {
    stopAll();
    process.exitCode = code ?? 0;
  });
  process.on('SIGINT', stopAll);
  process.on('SIGTERM', stopAll);
} else {
  const child = run([...TASKS[task], ...extra], task);
  child.on('exit', (code, signal) => process.exit(code ?? (signal ? 1 : 0)));
  process.on('SIGINT', () => {}); // let the child handle Ctrl+C and exit with its own code
}
