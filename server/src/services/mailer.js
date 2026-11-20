// Sends email over SMTP with no extra packages (Node's own net/tls). Works with Gmail and most providers.
// Port 465 uses TLS from the start; other ports (such as 587) upgrade with STARTTLS.
import net from 'node:net';
import tls from 'node:tls';
import { config } from '../config.js';

export const smtpConfigured = () => Boolean(config.smtp.host && config.smtp.user && config.smtp.pass);

// Reads SMTP replies (which may span several lines such as "250-...", ending with "250 ...").
function lineReader(getSocket) {
  let buf = '';
  let waiting = null;
  const feed = (chunk) => { buf += chunk.toString('utf8'); flush(); };
  const flush = () => {
    if (!waiting) return;
    const lines = buf.split('\r\n');
    for (let i = 0; i < lines.length - 1; i++) {
      if (/^\d{3} /.test(lines[i])) {
        const reply = lines.slice(0, i + 1).join('\n');
        buf = lines.slice(i + 1).join('\r\n');
        const w = waiting; waiting = null; w.resolve({ code: Number(reply.slice(0, 3)), text: reply });
        return;
      }
    }
  };
  const read = () => new Promise((resolve, reject) => { waiting = { resolve, reject }; flush(); });
  const fail = (err) => { if (waiting) { const w = waiting; waiting = null; w.reject(err); } };
  return { feed, read, fail, getSocket };
}

function connect({ host, port, secure }) {
  return new Promise((resolve, reject) => {
    const sock = (secure ? tls.connect : net.connect)({ host, port, ...(secure ? { servername: host } : {}) });
    sock.setTimeout(15000, () => sock.destroy(new Error('SMTP timeout')));
    sock.once(secure ? 'secureConnect' : 'connect', () => resolve(sock));
    sock.once('error', reject);
  });
}

const clean = (s) => String(s).replace(/[\r\n]+/g, ' ');

export async function sendMail({ to, subject, text }) {
  const { host, port, secure, user, pass, from } = config.smtp;
  let sock = await connect({ host, port, secure });
  let r = lineReader(() => sock);
  const attach = () => { sock.on('data', r.feed); sock.on('error', r.fail); sock.on('close', () => r.fail(new Error('SMTP connection closed'))); };
  attach();
  const expect = async (codes) => {
    const reply = await r.read();
    if (!codes.includes(reply.code)) throw new Error(`SMTP error: ${reply.text}`);
    return reply;
  };
  const cmd = async (line, codes) => { sock.write(line + '\r\n'); return expect(codes); };
  try {
    await expect([220]);
    await cmd('EHLO ewaste-assistant', [250]);
    if (!secure && config.smtp.port === 587) {
      await cmd('STARTTLS', [220]);
      sock.removeAllListeners('data');
      sock = await new Promise((resolve, reject) => {
        const t = tls.connect({ socket: sock, servername: host }, () => resolve(t));
        t.once('error', reject);
      });
      r = lineReader(() => sock);
      attach();
      await cmd('EHLO ewaste-assistant', [250]);
    }
    await cmd('AUTH LOGIN', [334]);
    await cmd(Buffer.from(user).toString('base64'), [334]);
    await cmd(Buffer.from(pass).toString('base64'), [235]);
    await cmd(`MAIL FROM:<${clean(from)}>`, [250]);
    await cmd(`RCPT TO:<${clean(to)}>`, [250, 251]);
    await cmd('DATA', [354]);
    const body = text.replace(/\r?\n/g, '\r\n').replace(/^\./gm, '..');
    const message = [
      `From: Second Life <${clean(from)}>`, `To: ${clean(to)}`, `Subject: ${clean(subject)}`,
      `Date: ${new Date().toUTCString()}`, 'MIME-Version: 1.0', 'Content-Type: text/plain; charset=utf-8', '', body, '.',
    ].join('\r\n');
    await cmd(message, [250]);
    sock.write('QUIT\r\n');
  } finally {
    sock.end();
  }
}
