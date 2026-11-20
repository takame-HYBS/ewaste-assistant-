// SQLite database layer using Node's built-in `node:sqlite` (Node 22.13+). No separate database to install.
//
// This exposes the same small interface the routes were written against: `query(sql, params)` resolves to
// `{ rows, rowCount }`. A few translations keep the SQL and the JSON the API returns tidy:
//   - `$1`, `$2` placeholders become SQLite's numbered `?1`, `?2`
//   - `now()` becomes an ISO-8601 UTC timestamp
//   - booleans, Dates, arrays and objects are converted on the way in (1/0, ISO text, JSON text)
//   - known boolean and JSON columns are converted back on the way out
//   - SQLite constraint errors are given the Postgres-style codes the error handler already understands
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { config } from '../config.js';

mkdirSync(dirname(config.dbPath), { recursive: true });
export const db = new DatabaseSync(config.dbPath);
db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');

const BOOLEAN_COLUMNS = new Set(['active', 'has_battery', 'stores_data', 'verified', 'reported', 'has_photo', 'email_verified']);
const JSON_COLUMNS = new Set(['answers', 'photo_hint', 'ranking', 'explanation', 'safety_notes', 'accepted_categories', 'ai_probabilities', 'ai_factors']);
const NOW = "strftime('%Y-%m-%dT%H:%M:%fZ','now')";

const ERROR_CODES = { 2067: '23505', 1555: '23505', 787: '23503', 275: '23514', 1299: '23502' };

function toParam(v) {
  if (v === undefined || v === null) return null;
  if (typeof v === 'boolean') return v ? 1 : 0;
  if (v instanceof Date) return v.toISOString();
  if (typeof v === 'object') return JSON.stringify(v);
  return v;
}

function fromRow(row) {
  const out = {};
  for (const [k, v] of Object.entries(row)) {
    if (BOOLEAN_COLUMNS.has(k) && (v === 0 || v === 1)) out[k] = v === 1;
    else if (JSON_COLUMNS.has(k) && typeof v === 'string') {
      try { out[k] = JSON.parse(v); } catch { out[k] = v; }
    } else out[k] = v;
  }
  return out;
}

const translate = (sql) => sql.replace(/\$(\d+)/g, '?$1').replace(/\bnow\(\)/gi, NOW);

export function query(sql, params = []) {
  try {
    const stmt = db.prepare(translate(sql));
    const values = params.map(toParam);
    if (stmt.columns().length > 0) {
      const rows = stmt.all(...values).map(fromRow);
      return Promise.resolve({ rows, rowCount: rows.length });
    }
    const info = stmt.run(...values);
    return Promise.resolve({ rows: [], rowCount: Number(info.changes) });
  } catch (err) {
    if (err.errcode && ERROR_CODES[err.errcode]) err.code = ERROR_CODES[err.errcode];
    return Promise.reject(err);
  }
}

// Runs several statements (used for the schema).
export function exec(sql) {
  db.exec(translate(sql));
}

// Compatibility with the code that used a pg Pool.
export const pool = { query, end: async () => db.close() };
