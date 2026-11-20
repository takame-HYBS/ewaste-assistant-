-- E-Waste Repairability & Recycling Decision Assistant: SQLite schema.
-- Safe to re-run: every statement is idempotent.
-- Booleans are stored as 0/1, timestamps as ISO-8601 UTC text, and lists/objects as JSON text.

CREATE TABLE IF NOT EXISTS users (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  name          TEXT    NOT NULL,
  email         TEXT    NOT NULL UNIQUE,
  password_hash TEXT    NOT NULL,
  role          TEXT    NOT NULL DEFAULT 'user' CHECK (role IN ('user', 'partner', 'admin')),
  active        INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  email_verified INTEGER NOT NULL DEFAULT 1 CHECK (email_verified IN (0, 1)),
  created_at    TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

-- One-time codes sent by email when someone registers. Only a hash of the code is stored.
CREATE TABLE IF NOT EXISTS email_codes (
  email      TEXT PRIMARY KEY,
  code_hash  TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  attempts   INTEGER NOT NULL DEFAULT 0,
  sent_at    TEXT NOT NULL
);

-- Admin-managed device categories. `key` is what the recommendation engine uses.
CREATE TABLE IF NOT EXISTS device_categories (
  id                     INTEGER PRIMARY KEY AUTOINCREMENT,
  key                    TEXT    NOT NULL UNIQUE,
  label                  TEXT    NOT NULL,
  has_battery            INTEGER NOT NULL DEFAULT 1 CHECK (has_battery IN (0, 1)),
  stores_data            INTEGER NOT NULL DEFAULT 1 CHECK (stores_data IN (0, 1)),
  typical_lifespan_years INTEGER NOT NULL DEFAULT 5 CHECK (typical_lifespan_years > 0),
  active                 INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1))
);

CREATE TABLE IF NOT EXISTS devices (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  category_id INTEGER NOT NULL REFERENCES device_categories(id) ON DELETE RESTRICT,
  brand       TEXT    NOT NULL,
  model       TEXT    NOT NULL DEFAULT '',
  age_years   REAL    NOT NULL DEFAULT 0 CHECK (age_years >= 0 AND age_years <= 60),
  condition   TEXT    NOT NULL CHECK (condition IN ('working', 'minor_issues', 'major_issues', 'not_working')),
  description TEXT    NOT NULL DEFAULT '',
  status      TEXT    NOT NULL DEFAULT 'registered' CHECK (status IN ('registered', 'assessed', 'in_progress', 'completed')),
  created_at  TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at  TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS devices_user_idx ON devices(user_id);

-- An assessment is an immutable snapshot: inputs + the engine's output at that time.
CREATE TABLE IF NOT EXISTS assessments (
  id                 INTEGER PRIMARY KEY AUTOINCREMENT,
  device_id          INTEGER NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
  method             TEXT    NOT NULL DEFAULT 'questionnaire' CHECK (method IN ('questionnaire', 'photo')),
  answers            TEXT    NOT NULL DEFAULT '{}',
  photo_path         TEXT,
  photo_hint         TEXT,                       -- optional image-model suggestion (never authoritative)
  result_action      TEXT    NOT NULL CHECK (result_action IN ('repair', 'reuse', 'donate', 'parts_recovery', 'recycle')),
  confidence         TEXT    NOT NULL CHECK (confidence IN ('low', 'medium', 'high')),
  ranking            TEXT    NOT NULL DEFAULT '[]',
  explanation        TEXT    NOT NULL DEFAULT '[]',
  safety_notes       TEXT    NOT NULL DEFAULT '[]',
  repair_cost        REAL,
  repair_cost_source TEXT    CHECK (repair_cost_source IN ('user_quote', 'rough_estimate')),
  current_value      REAL,
  engine_version     TEXT    NOT NULL,
  -- AI decision model output (see src/ai). Older rows leave these empty.
  ai_action          TEXT    CHECK (ai_action IN ('repair', 'reuse', 'donate', 'parts_recovery', 'recycle')),
  ai_confidence      REAL,
  ai_probabilities   TEXT,                       -- JSON: probability of each action
  ai_factors         TEXT,                       -- JSON: features that drove the prediction
  ai_model_version   TEXT,
  repair_score       INTEGER,                    -- 0-100: AI chance that repair is the best option
  rule_action        TEXT    CHECK (rule_action IN ('repair', 'reuse', 'donate', 'parts_recovery', 'recycle')),
  decision_source    TEXT    CHECK (decision_source IN ('ai', 'safety_override', 'rules')),
  created_at         TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS assessments_device_idx ON assessments(device_id);

CREATE TABLE IF NOT EXISTS service_locations (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  owner_id            INTEGER REFERENCES users(id) ON DELETE SET NULL,
  name                TEXT    NOT NULL,
  type                TEXT    NOT NULL CHECK (type IN ('repair', 'donation', 'recycling')),
  services            TEXT    NOT NULL DEFAULT '',
  accepted_categories TEXT    NOT NULL DEFAULT '[]',   -- JSON list of category keys; empty = all
  address             TEXT    NOT NULL DEFAULT '',
  city                TEXT    NOT NULL DEFAULT '',
  lat                 REAL    NOT NULL CHECK (lat BETWEEN -90 AND 90),
  lng                 REAL    NOT NULL CHECK (lng BETWEEN -180 AND 180),
  phone               TEXT    NOT NULL DEFAULT '',
  website             TEXT    NOT NULL DEFAULT '',
  hours               TEXT    NOT NULL DEFAULT '',
  verified            INTEGER NOT NULL DEFAULT 0 CHECK (verified IN (0, 1)),
  verified_at         TEXT,
  reported            INTEGER NOT NULL DEFAULT 0 CHECK (reported IN (0, 1)),
  report_note         TEXT    NOT NULL DEFAULT '',
  created_at          TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at          TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS locations_type_idx ON service_locations(type);

CREATE TABLE IF NOT EXISTS device_actions (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  device_id     INTEGER NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
  assessment_id INTEGER REFERENCES assessments(id) ON DELETE SET NULL,
  user_id       INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  location_id   INTEGER REFERENCES service_locations(id) ON DELETE SET NULL,
  action        TEXT    NOT NULL CHECK (action IN ('repair', 'reuse', 'donate', 'parts_recovery', 'recycle')),
  status        TEXT    NOT NULL DEFAULT 'planned' CHECK (status IN ('planned', 'in_progress', 'completed', 'cancelled')),
  action_date   TEXT,                                  -- YYYY-MM-DD
  notes         TEXT    NOT NULL DEFAULT '',
  created_at    TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at    TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS actions_device_idx ON device_actions(device_id);
CREATE INDEX IF NOT EXISTS actions_user_idx ON device_actions(user_id);

-- Users rate each recommendation. This is how the app measures whether the AI is actually useful.
CREATE TABLE IF NOT EXISTS ai_feedback (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  assessment_id INTEGER NOT NULL UNIQUE REFERENCES assessments(id) ON DELETE CASCADE,
  user_id       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  rating        INTEGER NOT NULL CHECK (rating BETWEEN 1 AND 5),
  will_follow   TEXT    NOT NULL CHECK (will_follow IN ('yes', 'partly', 'no')),
  chosen_action TEXT    CHECK (chosen_action IN ('repair', 'reuse', 'donate', 'parts_recovery', 'recycle')),
  comment       TEXT    NOT NULL DEFAULT '',
  created_at    TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at    TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
