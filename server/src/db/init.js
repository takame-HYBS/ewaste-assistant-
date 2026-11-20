// Creates the tables and upgrades older databases in place (adds columns that newer versions need).
import { readFileSync } from 'node:fs';
import { db, exec } from './pool.js';

// Columns added after the first release. `CREATE TABLE IF NOT EXISTS` cannot add columns to a table that already
// exists, so each one is added here when missing. Existing data is kept.
const ADDED_COLUMNS = {
  users: { email_verified: 'INTEGER NOT NULL DEFAULT 1' }, // existing accounts count as verified
  assessments: {
    ai_action: "TEXT CHECK (ai_action IN ('repair', 'reuse', 'donate', 'parts_recovery', 'recycle'))",
    ai_confidence: 'REAL',
    ai_probabilities: 'TEXT',
    ai_factors: 'TEXT',
    ai_model_version: 'TEXT',
    repair_score: 'INTEGER',
    rule_action: "TEXT CHECK (rule_action IN ('repair', 'reuse', 'donate', 'parts_recovery', 'recycle'))",
    decision_source: "TEXT CHECK (decision_source IN ('ai', 'safety_override', 'rules'))",
  },
};

export function initDatabase() {
  exec(readFileSync(new URL('./schema.sql', import.meta.url), 'utf8'));
  for (const [table, columns] of Object.entries(ADDED_COLUMNS)) {
    const have = new Set(db.prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name));
    for (const [name, type] of Object.entries(columns)) {
      if (!have.has(name)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${name} ${type}`);
    }
  }
}
