CREATE TABLE events (
  event_id TEXT PRIMARY KEY,
  source TEXT NOT NULL,
  kind TEXT NOT NULL,
  subject TEXT NOT NULL,
  state TEXT NOT NULL,
  severity TEXT NOT NULL,
  occurred_at TEXT NOT NULL,
  title TEXT NOT NULL,
  summary TEXT,
  facts_json TEXT,
  link TEXT,
  incident_key TEXT NOT NULL,
  decision TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX events_incident_idx ON events (incident_key, occurred_at);
CREATE TABLE incidents (
  incident_key TEXT PRIMARY KEY,
  source TEXT NOT NULL,
  kind TEXT NOT NULL,
  subject TEXT NOT NULL,
  status TEXT NOT NULL,
  first_seen TEXT NOT NULL,
  last_seen TEXT NOT NULL,
  event_count INTEGER NOT NULL DEFAULT 1,
  last_notification_at TEXT,
  closed_at TEXT,
  pending_until TEXT
);
CREATE TABLE deliveries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  event_id TEXT NOT NULL,
  incident_key TEXT NOT NULL,
  notification_no INTEGER NOT NULL,
  notification_type TEXT NOT NULL DEFAULT 'first',
  channel TEXT NOT NULL DEFAULT 'email',
  status TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  next_attempt_at TEXT,
  error_code TEXT,
  message_id TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  sent_at TEXT,
  UNIQUE (incident_key, notification_no)
);
CREATE INDEX deliveries_event_idx ON deliveries (event_id);
CREATE TABLE quota (
  bucket TEXT PRIMARY KEY,
  day_count INTEGER NOT NULL DEFAULT 0,
  hour_count INTEGER NOT NULL DEFAULT 0,
  omitted_count INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE producer_tokens (
  token_id TEXT PRIMARY KEY,
  token_hash TEXT NOT NULL UNIQUE,
  source TEXT NOT NULL,
  kinds_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  revoked_at TEXT
);
