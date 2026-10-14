CREATE TABLE IF NOT EXISTS health_records (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  collection TEXT NOT NULL,
  record_id TEXT NOT NULL,
  day TEXT NOT NULL,
  payload TEXT NOT NULL,
  fetched_at TEXT NOT NULL,
  PRIMARY KEY (user_id, collection, record_id)
);
CREATE INDEX IF NOT EXISTS health_records_window ON health_records(user_id, collection, day);

CREATE TABLE IF NOT EXISTS health_sync_windows (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  collection TEXT NOT NULL,
  window_from TEXT NOT NULL,
  window_to TEXT NOT NULL,
  synced_at TEXT,
  attempted_at TEXT NOT NULL,
  last_error TEXT,
  PRIMARY KEY (user_id, collection, window_from, window_to)
);
