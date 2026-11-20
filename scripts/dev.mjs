// Starts the API (port 4000) and the website (port 5173) together. Press Ctrl+C to stop both.
import { spawn, spawnSync } from 'node:child_process';
import { requireNode } from './check-node.mjs';

requireNode();

const procs = [
  ['api', 'server'],
  ['web', 'client'],
].map(([name, dir]) => {
  const p = spawn('npm run dev', { cwd: new URL(`../${dir}/`, import.meta.url), stdio: 'inherit', shell: true, detached: process.platform !== 'win32' });
  p.on('exit', (code) => {
    if (!stopping) {
      console.error(`\nThe ${name} process stopped (exit code ${code}). Did you run "npm run setup" first?`);
      stop(code || 1);
    }
  });
  return p;
});

let stopping = false;
function stop(code = 0) {
  stopping = true;
  for (const p of procs) {
    if (p.exitCode !== null) continue;
    if (process.platform === 'win32') spawnSync(`taskkill /pid ${p.pid} /T /F`, { shell: true, stdio: 'ignore' });
    else {
      // The child runs inside a shell, so signal its whole process group or the server would keep running.
      try { process.kill(-p.pid, 'SIGTERM'); } catch { p.kill('SIGTERM'); }
    }
  }
  process.exit(code);
}
process.on('SIGINT', () => stop(0));
process.on('SIGTERM', () => stop(0));
