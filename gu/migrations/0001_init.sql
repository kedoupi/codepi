CREATE TABLE otp_codes (
  id TEXT PRIMARY KEY,
  code_hash TEXT NOT NULL,
  ip_hash TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  used_at INTEGER
);
CREATE INDEX otp_created ON otp_codes(created_at);

CREATE TABLE sessions (
  id TEXT PRIMARY KEY,
  expires_at INTEGER NOT NULL
);

CREATE TABLE dashboard_batches (
  id TEXT PRIMARY KEY,
  generated_at TEXT NOT NULL,
  received_at TEXT NOT NULL,
  payload TEXT NOT NULL
);
CREATE TABLE dashboard_current (
  singleton INTEGER PRIMARY KEY CHECK(singleton = 1),
  batch_id TEXT NOT NULL REFERENCES dashboard_batches(id)
);
