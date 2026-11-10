CREATE TABLE channel_attempts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  delivery_id INTEGER NOT NULL,
  channel TEXT NOT NULL,
  status TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  next_attempt_at TEXT,
  error_code TEXT,
  message_id TEXT,
  sent_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (delivery_id, channel)
);
CREATE INDEX channel_attempts_delivery_idx ON channel_attempts (delivery_id);
CREATE INDEX channel_attempts_retry_idx ON channel_attempts (status, next_attempt_at);
