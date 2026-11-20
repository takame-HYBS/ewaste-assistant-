// An older database (created before the AI columns existed) must be upgraded in place without losing data.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

test('initDatabase adds the AI columns to an old database and keeps existing rows', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'ewaste-upgrade-'));
  process.env.DB_PATH = join(dir, 'old.db');

  const old = new DatabaseSync(process.env.DB_PATH);
  old.exec(`CREATE TABLE assessments (
    id INTEGER PRIMARY KEY AUTOINCREMENT, device_id INTEGER NOT NULL, method TEXT NOT NULL DEFAULT 'questionnaire',
    answers TEXT NOT NULL DEFAULT '{}', photo_path TEXT, photo_hint TEXT, result_action TEXT NOT NULL, confidence TEXT NOT NULL,
    ranking TEXT NOT NULL DEFAULT '[]', explanation TEXT NOT NULL DEFAULT '[]', safety_notes TEXT NOT NULL DEFAULT '[]',
    repair_cost REAL, repair_cost_source TEXT, current_value REAL, engine_version TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT 'x');
    INSERT INTO assessments (device_id, result_action, confidence, engine_version) VALUES (1, 'repair', 'high', '1.0.0');`);
  old.close();

  const { initDatabase } = await import('../src/db/init.js');
  const { db } = await import('../src/db/pool.js');
  initDatabase();
  initDatabase(); // running twice must be harmless

  const cols = db.prepare('PRAGMA table_info(assessments)').all().map((c) => c.name);
  for (const c of ['ai_action', 'ai_probabilities', 'ai_factors', 'repair_score', 'rule_action', 'decision_source']) assert.ok(cols.includes(c), `missing ${c}`);
  const row = db.prepare('SELECT result_action, ai_action FROM assessments').get();
  assert.equal(row.result_action, 'repair');
  assert.equal(row.ai_action, null);
  assert.ok(db.prepare("SELECT name FROM sqlite_master WHERE name = 'ai_feedback'").get(), 'feedback table created');
});
