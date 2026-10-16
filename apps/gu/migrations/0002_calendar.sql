CREATE TABLE calendar_sync_state (
  singleton INTEGER PRIMARY KEY CHECK(singleton = 1),
  calendar_id TEXT NOT NULL,
  attempted_at TEXT NOT NULL,
  received_at TEXT NOT NULL,
  attempt_hash TEXT NOT NULL,
  attempt_payload TEXT NOT NULL,
  success_at TEXT,
  success_received_at TEXT,
  success_payload TEXT
);
