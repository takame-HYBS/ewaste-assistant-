// One-time setup: installs packages for the server and the website, then creates the database.
import { spawnSync } from 'node:child_process';
import { requireNode } from './check-node.mjs';

requireNode();

const steps = [
  ['Installing server packages', 'npm install', 'server'],
  ['Installing website packages', 'npm install', 'client'],
  ['Creating the database', 'npm run migrate', 'server'],
  ['Adding starter data (categories, admin account, demo places)', 'npm run seed', 'server'],
];

for (const [label, cmd, dir] of steps) {
  console.log(`\n> ${label}...`);
  const r = spawnSync(cmd, { cwd: new URL(`../${dir}/`, import.meta.url), stdio: 'inherit', shell: true });
  if (r.status !== 0) {
    console.error(`\nSetup stopped at: ${label}.`);
    console.error('If it mentions "network", "ENOTFOUND" or "ETIMEDOUT", check your internet connection and run "npm run setup" again.');
    process.exit(r.status || 1);
  }
}

console.log('\nSetup finished. Start the app with:  npm run dev');
console.log('Then open http://localhost:5173 and sign in with admin@example.com / ChangeMe!123');
