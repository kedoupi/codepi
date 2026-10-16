-- Durable owner-only scheduler. Health history and coverage are retained separately.
CREATE TABLE IF NOT EXISTS auto_sync_state (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  run_day TEXT,
  status TEXT NOT NULL DEFAULT 'idle',
  started_at TEXT,
  finished_at TEXT,
  last_success_at TEXT,
  last_error TEXT,
  payload TEXT NOT NULL DEFAULT '[]',
  lease_id TEXT,
  lease_until INTEGER NOT NULL DEFAULT 0
);
