// Email verification codes: 6 digits, valid for a few minutes, limited tries, stored only as a hash.
import { createHash, randomInt } from 'node:crypto';
import { config } from '../config.js';
import { query } from '../db/pool.js';
import { HttpError } from '../validate.js';
import { sendMail, smtpConfigured } from './mailer.js';

const MAX_TRIES = 5;
const RESEND_SECONDS = 30;
const hashCode = (email, code) => createHash('sha256').update(`${email}|${code}|${config.jwtSecret}`).digest('hex');

// Sends a fresh code. Returns { demoCode } only when no SMTP is configured (demo mode).
export async function issueCode(email) {
  const { rows } = await query('SELECT sent_at FROM email_codes WHERE email = $1', [email]);
  if (rows[0] && Date.now() - Date.parse(rows[0].sent_at) < RESEND_SECONDS * 1000) {
    throw new HttpError(429, `Please wait ${RESEND_SECONDS} seconds before asking for another code.`);
  }
  const code = String(randomInt(0, 1000000)).padStart(6, '0');
  const expires = new Date(Date.now() + config.otpMinutes * 60 * 1000).toISOString();
  await query(
    `INSERT INTO email_codes (email, code_hash, expires_at, attempts, sent_at) VALUES ($1,$2,$3,0,$4)
     ON CONFLICT (email) DO UPDATE SET code_hash = excluded.code_hash, expires_at = excluded.expires_at, attempts = 0, sent_at = excluded.sent_at`,
    [email, hashCode(email, code), expires, new Date().toISOString()]
  );
  if (!smtpConfigured()) {
    console.log(`[demo mode] Verification code for ${email}: ${code} (set SMTP_* to send real emails)`);
    return { demoCode: code };
  }
  try {
    await sendMail({
      to: email,
      subject: 'Your Second Life verification code',
      text: `Your verification code is ${code}\n\nIt expires in ${config.otpMinutes} minutes. If you did not create an account, ignore this email.`,
    });
  } catch (err) {
    console.error('Could not send email:', err.message);
    throw new HttpError(502, 'We could not send the verification email. Check the address or try again later.');
  }
  return {};
}

export async function checkCode(email, code) {
  const { rows } = await query('SELECT * FROM email_codes WHERE email = $1', [email]);
  const row = rows[0];
  if (!row) throw new HttpError(400, 'No code was requested for this email. Ask for a new one.');
  if (Date.parse(row.expires_at) < Date.now()) throw new HttpError(400, 'That code has expired. Ask for a new one.');
  if (row.attempts >= MAX_TRIES) throw new HttpError(429, 'Too many wrong tries. Ask for a new code.');
  if (hashCode(email, String(code || '').trim()) !== row.code_hash) {
    await query('UPDATE email_codes SET attempts = attempts + 1 WHERE email = $1', [email]);
    throw new HttpError(400, 'That code is not correct.');
  }
  await query('DELETE FROM email_codes WHERE email = $1', [email]);
}
