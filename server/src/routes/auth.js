import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { query } from '../db/pool.js';
import { requireAuth, signToken, wrap } from '../middleware/auth.js';
import { config } from '../config.js';
import { issueCode, checkCode } from '../services/otp.js';
import { HttpError, email, oneOf, password, str } from '../validate.js';

const router = Router();

// Very small in-memory login throttle (per IP+email). Use a shared store if you run several instances.
const attempts = new Map();
const WINDOW_MS = 15 * 60 * 1000;
const MAX_ATTEMPTS = 10;
function throttled(key) {
  const now = Date.now();
  const entry = (attempts.get(key) || []).filter((t) => now - t < WINDOW_MS);
  attempts.set(key, entry);
  return entry.length >= MAX_ATTEMPTS;
}
const noteFailure = (key) => attempts.set(key, [...(attempts.get(key) || []), Date.now()]);

const DUMMY_HASH = bcrypt.hashSync('not-a-real-password', 10);
const publicUser = (u) => ({ id: u.id, name: u.name, email: u.email, role: u.role });

router.post('/register', wrap(async (req, res) => {
  const name = str(req.body.name, 'Name', { max: 100 });
  const mail = email(req.body.email);
  const pass = password(req.body.password);
  // Self-registration may only create user or partner accounts. Admins are created via seed or by another admin.
  const role = oneOf(req.body.role || 'user', 'Role', ['user', 'partner']);

  const hash = await bcrypt.hash(pass, 10);

  if (!config.otpRequired) {
    const { rows } = await query(
      `INSERT INTO users (name, email, password_hash, role) VALUES ($1,$2,$3,$4)
       RETURNING id, name, email, role`,
      [name, mail, hash, role]
    ); // unique violation (23505) is mapped to a 409 by the error handler
    return res.status(201).json({ token: signToken(rows[0]), user: publicUser(rows[0]) });
  }

  // Email verification: the account stays unverified (and cannot sign in) until the emailed code is entered.
  const existing = (await query('SELECT id, email_verified FROM users WHERE email = $1', [mail])).rows[0];
  if (existing && existing.email_verified) throw new HttpError(409, 'That value is already in use.');
  if (existing) {
    // Someone who never finished verifying can register again; their details are replaced.
    await query('UPDATE users SET name = $1, password_hash = $2, role = $3 WHERE id = $4', [name, hash, role, existing.id]);
  } else {
    await query(`INSERT INTO users (name, email, password_hash, role, email_verified) VALUES ($1,$2,$3,$4,0)`, [name, mail, hash, role]);
  }
  const sent = await issueCode(mail);
  res.status(201).json({ verificationRequired: true, email: mail, ...sent });
}));

router.post('/verify-email', wrap(async (req, res) => {
  const mail = email(req.body.email);
  const key = `verify|${req.ip}|${mail}`;
  if (throttled(key)) throw new HttpError(429, 'Too many attempts. Try again in a few minutes.');
  const { rows } = await query('SELECT * FROM users WHERE email = $1', [mail]);
  const user = rows[0];
  if (!user) { noteFailure(key); throw new HttpError(400, 'That code is not correct.'); }
  if (user.email_verified) throw new HttpError(400, 'This email is already verified. Please sign in.');
  try { await checkCode(mail, req.body.code); } catch (e) { noteFailure(key); throw e; }
  await query('UPDATE users SET email_verified = 1 WHERE id = $1', [user.id]);
  res.json({ token: signToken(user), user: publicUser(user) });
}));

router.post('/resend-code', wrap(async (req, res) => {
  const mail = email(req.body.email);
  const { rows } = await query('SELECT email_verified FROM users WHERE email = $1', [mail]);
  // Same answer whether or not the email exists, so this cannot be used to look up accounts.
  if (rows[0] && !rows[0].email_verified) {
    const sent = await issueCode(mail);
    return res.json({ ok: true, ...sent });
  }
  res.json({ ok: true });
}));

router.post('/login', wrap(async (req, res) => {
  const mail = email(req.body.email);
  const key = `${req.ip}|${mail}`;
  if (throttled(key)) throw new HttpError(429, 'Too many attempts. Try again in a few minutes.');

  const { rows } = await query('SELECT * FROM users WHERE email = $1', [mail]);
  const user = rows[0];
  // Always run a bcrypt compare so response time doesn't reveal whether the email exists.
  const ok = await bcrypt.compare(String(req.body.password || ''), user ? user.password_hash : DUMMY_HASH);
  if (!user || !ok || !user.active) {
    noteFailure(key);
    throw new HttpError(401, 'Invalid email or password.');
  }
  if (!user.email_verified) {
    return res.status(403).json({ error: 'Please verify your email first. We can send you a new code.', needsVerification: true, email: user.email });
  }
  attempts.delete(key);
  res.json({ token: signToken(user), user: publicUser(user) });
}));

router.get('/me', requireAuth, (req, res) => res.json({ user: publicUser(req.user) }));

export default router;
