// Production start: prepares the database (safe to repeat), then runs the server, which also serves the website.
import { spawnSync, spawn } from 'node:child_process';
const server = new URL('../server/', import.meta.url);
process.env.NODE_ENV ||= 'production';
for (const cmd of ['npm run migrate', 'npm run seed']) {
  const r = spawnSync(cmd, { cwd: server, stdio: 'inherit', shell: true, env: process.env });
  if (r.status !== 0) process.exit(r.status || 1);
}
const child = spawn('node src/index.js', { cwd: server, stdio: 'inherit', shell: true, env: process.env });
child.on('exit', (code) => process.exit(code ?? 0));
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => child.kill(sig));
