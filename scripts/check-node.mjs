// Fails early, in plain English, when Node.js is too old for the built-in SQLite database.
export const MIN = [22, 13, 0];

export function isSupported(version = process.versions.node) {
  const v = version.split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    if ((v[i] || 0) > MIN[i]) return true;
    if ((v[i] || 0) < MIN[i]) return false;
  }
  return true;
}

export function requireNode() {
  if (isSupported()) return;
  console.error(`\nYour Node.js is version ${process.versions.node}, but this project needs ${MIN.join('.')} or newer.`);
  console.error('Fix: download the "LTS" version from https://nodejs.org, install it, then close and reopen VS Code.\n');
  process.exit(1);
}
