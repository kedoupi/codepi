CREATE TABLE IF NOT EXISTS kdp_sso_transactions (
  id TEXT PRIMARY KEY,
  state_hash TEXT NOT NULL,
  code_verifier TEXT NOT NULL,
  return_to TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  consumed_at INTEGER
);
CREATE INDEX IF NOT EXISTS kdp_sso_transactions_expiry ON kdp_sso_transactions(expires_at);

CREATE TABLE IF NOT EXISTS kdp_sso_sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  subject TEXT NOT NULL,
  central_ref TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS kdp_sso_sessions_expiry ON kdp_sso_sessions(expires_at);

CREATE TABLE IF NOT EXISTS import_sessions (
  id TEXT PRIMARY KEY,
  source_client TEXT NOT NULL CHECK (length(source_client) BETWEEN 1 AND 200),
  source_name TEXT CHECK (source_name IS NULL OR length(source_name) <= 200),
  request_id TEXT,
  status TEXT NOT NULL CHECK (status IN ('open', 'finishing', 'finished', 'failed')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  finished_at TEXT,
  error_code TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS import_sessions_open_client
  ON import_sessions(source_client) WHERE status IN ('open','finishing');
CREATE UNIQUE INDEX IF NOT EXISTS import_sessions_request
  ON import_sessions(source_client, request_id) WHERE request_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS import_sessions_recent ON import_sessions(created_at DESC, id);

CREATE TABLE IF NOT EXISTS import_chunks (
  import_id TEXT NOT NULL REFERENCES import_sessions(id),
  chunk_index INTEGER NOT NULL CHECK (chunk_index BETWEEN 0 AND 499),
  payload TEXT NOT NULL,
  digest TEXT NOT NULL CHECK (length(digest) = 64),
  r2_key TEXT NOT NULL,
  bytes INTEGER NOT NULL CHECK (bytes >= 0),
  item_count INTEGER NOT NULL CHECK (item_count >= 0),
  created_at TEXT NOT NULL,
  PRIMARY KEY (import_id, chunk_index)
);

CREATE TABLE IF NOT EXISTS memories (
  id TEXT PRIMARY KEY,
  status TEXT NOT NULL CHECK (status IN ('pending', 'active', 'archived', 'rejected')),
  kind TEXT NOT NULL CHECK (kind IN ('preference', 'fact', 'decision', 'lesson', 'note')),
  text TEXT NOT NULL CHECK (length(text) BETWEEN 1 AND 2000),
  tags TEXT NOT NULL DEFAULT '[]',
  source_client TEXT NOT NULL,
  source_name TEXT,
  import_id TEXT REFERENCES imports(id),
  import_item_index INTEGER,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  reviewed_at TEXT
);
CREATE INDEX IF NOT EXISTS memories_status_updated ON memories(status, updated_at DESC, id);
CREATE INDEX IF NOT EXISTS memories_source ON memories(source_client, updated_at DESC);
CREATE INDEX IF NOT EXISTS memories_import ON memories(import_id, import_item_index);
CREATE UNIQUE INDEX IF NOT EXISTS memories_import_item
  ON memories(import_id, import_item_index)
  WHERE import_id IS NOT NULL AND import_item_index IS NOT NULL;

CREATE TABLE IF NOT EXISTS profile (
  key TEXT PRIMARY KEY CHECK (length(key) BETWEEN 1 AND 80),
  value TEXT NOT NULL CHECK (length(value) BETWEEN 1 AND 2000),
  updated_at TEXT NOT NULL,
  updated_by TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS profile_proposals (
  id TEXT PRIMARY KEY,
  key TEXT NOT NULL CHECK (length(key) BETWEEN 1 AND 80),
  value TEXT NOT NULL CHECK (length(value) BETWEEN 1 AND 2000),
  status TEXT NOT NULL CHECK (status IN ('pending', 'approved', 'rejected')),
  source_client TEXT NOT NULL,
  source_name TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  reviewed_at TEXT
);
CREATE INDEX IF NOT EXISTS profile_proposals_status
  ON profile_proposals(status, updated_at DESC, id);

CREATE TABLE IF NOT EXISTS timeline (
  id TEXT PRIMARY KEY,
  status TEXT NOT NULL CHECK (status IN ('pending', 'active', 'archived', 'rejected')),
  kind TEXT NOT NULL CHECK (kind IN ('work', 'startup', 'education', 'project', 'life')),
  title TEXT NOT NULL CHECK (length(title) BETWEEN 1 AND 200),
  org TEXT CHECK (org IS NULL OR length(org) <= 200),
  started_on TEXT CHECK (started_on IS NULL OR length(started_on) BETWEEN 4 AND 10),
  ended_on TEXT CHECK (ended_on IS NULL OR length(ended_on) BETWEEN 4 AND 10),
  body TEXT CHECK (body IS NULL OR length(body) <= 8000),
  source_client TEXT NOT NULL,
  source_name TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  reviewed_at TEXT
);
CREATE INDEX IF NOT EXISTS timeline_status_updated ON timeline(status, updated_at DESC, id);
CREATE INDEX IF NOT EXISTS timeline_dates ON timeline(started_on, ended_on);

CREATE TABLE IF NOT EXISTS imports (
  id TEXT PRIMARY KEY,
  source_client TEXT NOT NULL,
  source_name TEXT,
  r2_key TEXT NOT NULL,
  bytes INTEGER NOT NULL CHECK (bytes >= 0),
  sha256 TEXT NOT NULL CHECK (length(sha256) = 64),
  item_count INTEGER NOT NULL CHECK (item_count BETWEEN 0 AND 500),
  chunk_count INTEGER NOT NULL CHECK (chunk_count >= 0),
  created_at TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS imports_once_ai
  ON imports(source_client) WHERE source_client <> 'board';
CREATE INDEX IF NOT EXISTS imports_recent ON imports(created_at DESC, id);
