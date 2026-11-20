import 'dotenv/config';
import { fileURLToPath } from 'node:url';

const here = (rel) => fileURLToPath(new URL(rel, import.meta.url));

const isProd = process.env.NODE_ENV === 'production';

if (isProd && (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 32)) {
  throw new Error('JWT_SECRET must be set to a random string of at least 32 characters in production.');
}

export const config = {
  isProd,
  port: Number(process.env.PORT || 4000),
  // SQLite file. Created automatically on first run.
  dbPath: process.env.DB_PATH || here('../data/ewaste.db'),
  jwtSecret: process.env.JWT_SECRET || 'dev-only-secret-change-me',
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || '7d',
  clientOrigin: process.env.CLIENT_ORIGIN || 'http://localhost:5173',
  uploadDir: process.env.UPLOAD_DIR || here('../uploads'),
  maxUploadBytes: 5 * 1024 * 1024,
  // Optional external image classifier. If unset, photos are stored but not classified.
  classifierUrl: process.env.CLASSIFIER_URL || '',
  // Email verification code at registration. Turn off with OTP_REQUIRED=false.
  otpRequired: process.env.OTP_REQUIRED !== 'false',
  otpMinutes: 10,
  // SMTP (for example Gmail: smtp.gmail.com, port 465, an "app password"). Without it the app runs in demo mode.
  smtp: {
    host: process.env.SMTP_HOST || '',
    port: Number(process.env.SMTP_PORT || 465),
    secure: process.env.SMTP_SECURE ? process.env.SMTP_SECURE !== 'false' : Number(process.env.SMTP_PORT || 465) === 465,
    user: process.env.SMTP_USER || '',
    pass: process.env.SMTP_PASS || '',
    from: process.env.SMTP_FROM || process.env.SMTP_USER || '',
  },
  classifierKey: process.env.CLASSIFIER_API_KEY || '',
};
