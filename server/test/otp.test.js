// Email verification at registration: demo mode (no SMTP) and real SMTP delivery against a local fake mail server.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import { execFileSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const serverDir = fileURLToPath(new URL('..', import.meta.url));
const tmp = mkdtempSync(join(tmpdir(), 'ewaste-otp-'));
process.env.DB_PATH = join(tmp, 'test.db');
process.env.UPLOAD_DIR = join(tmp, 'uploads');
for (const script of ['migrate', 'seed']) {
  execFileSync(process.execPath, [...process.execArgv, '--no-warnings', join(serverDir, 'src', 'db', `${script}.js`)], { env: process.env, stdio: 'ignore' });
}

// A tiny fake SMTP server that records the messages it receives.
const mails = [];
const smtp = net.createServer((sock) => {
  let inData = false, data = '', stage = 0;
  sock.write('220 fake\r\n');
  sock.on('data', (chunk) => {
    const text = chunk.toString();
    if (inData) {
      data += text;
      if (data.endsWith('\r\n.\r\n')) { inData = false; mails.push(data); data = ''; sock.write('250 queued\r\n'); }
      return;
    }
    for (const line of text.split('\r\n').filter(Boolean)) {
      if (line.startsWith('EHLO')) sock.write('250-fake\r\n250 AUTH LOGIN\r\n');
      else if (line === 'AUTH LOGIN') { stage = 1; sock.write('334 VXNlcm5hbWU6\r\n'); }
      else if (stage === 1) { stage = 2; sock.write('334 UGFzc3dvcmQ6\r\n'); }
      else if (stage === 2) { stage = 3; sock.write(Buffer.from(line, 'base64').toString() === 'app-password' ? '235 ok\r\n' : '535 bad\r\n'); }
      else if (line.startsWith('MAIL FROM') || line.startsWith('RCPT TO')) sock.write('250 ok\r\n');
      else if (line === 'DATA') { inData = true; data = ''; sock.write('354 go\r\n'); }
      else if (line === 'QUIT') sock.write('221 bye\r\n');
    }
  });
});
await new Promise((r) => smtp.listen(0, '127.0.0.1', r));

let server, base;
before(async () => {
  process.env.OTP_REQUIRED = 'true';
  const { createApp } = await import('../src/index.js');
  server = createApp().listen(0);
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => { server.close(); smtp.close(); });

async function call(path, body) {
  const res = await fetch(base + '/api/auth' + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  return { status: res.status, data: await res.json() };
}
const reg = (email, extra = {}) => call('/register', { name: 'Test', email, password: 'password123', ...extra });

test('demo mode (no SMTP): register needs a code, wrong code fails, right code signs in', async () => {
  const r = await reg('demo@x.io');
  assert.equal(r.status, 201);
  assert.equal(r.data.verificationRequired, true);
  assert.equal(r.data.token, undefined, 'no token before verifying');
  assert.match(r.data.demoCode, /^\d{6}$/);

  const login = await call('/login', { email: 'demo@x.io', password: 'password123' });
  assert.equal(login.status, 403);
  assert.equal(login.data.needsVerification, true);

  const wrong = await call('/verify-email', { email: 'demo@x.io', code: r.data.demoCode === '000000' ? '111111' : '000000' });
  assert.equal(wrong.status, 400);

  const ok = await call('/verify-email', { email: 'demo@x.io', code: r.data.demoCode });
  assert.equal(ok.status, 200);
  assert.ok(ok.data.token);
  assert.equal(ok.data.user.email, 'demo@x.io');

  assert.equal((await call('/login', { email: 'demo@x.io', password: 'password123' })).status, 200);
  assert.equal((await call('/verify-email', { email: 'demo@x.io', code: r.data.demoCode })).status, 400, 'code cannot be reused');
  assert.equal((await reg('demo@x.io')).status, 409, 'verified email cannot be registered again');
});

test('too many wrong tries locks the code; resend is rate limited and generic', async () => {
  const r = await reg('tries@x.io');
  const bad = r.data.demoCode === '123456' ? '654321' : '123456';
  for (let i = 0; i < 5; i++) assert.equal((await call('/verify-email', { email: 'tries@x.io', code: bad })).status, 400);
  assert.equal((await call('/verify-email', { email: 'tries@x.io', code: r.data.demoCode })).status, 429, 'locked even with the right code');
  assert.equal((await call('/resend-code', { email: 'tries@x.io' })).status, 429, 'resend too soon');
  const unknown = await call('/resend-code', { email: 'nobody@x.io' });
  assert.equal(unknown.status, 200);
  assert.equal(unknown.data.demoCode, undefined, 'does not reveal whether an account exists');
});

test('registering again before verifying does not 409, but respects the resend delay', async () => {
  await reg('again@x.io');
  const again = await reg('again@x.io', { name: 'Second try' });
  assert.equal(again.status, 429, 'a new code cannot be requested within 30 seconds');
});

test('real SMTP: the code is emailed and works', async () => {
  const { config } = await import('../src/config.js');
  Object.assign(config.smtp, { host: '127.0.0.1', port: smtp.address().port, secure: false, user: 'me@gmail.test', pass: 'app-password', from: 'me@gmail.test' });
  const r = await reg('real@x.io');
  assert.equal(r.status, 201);
  assert.equal(r.data.demoCode, undefined, 'code is NOT returned to the browser when email is configured');
  assert.equal(mails.length, 1);
  assert.match(mails[0], /To: real@x\.io/);
  const code = mails[0].match(/code is (\d{6})/)[1];
  const ok = await call('/verify-email', { email: 'real@x.io', code });
  assert.equal(ok.status, 200);
  assert.ok(ok.data.token);
});

test('real SMTP: a mail server failure gives a clear error', async () => {
  const { config } = await import('../src/config.js');
  config.smtp.pass = 'wrong-password';
  const r = await reg('fail@x.io');
  assert.equal(r.status, 502);
});
