-- Project-owned D1. The shared SSO client requires these tables in every
-- application database; keep this copy aligned with packages/shared/auth/schema.sql.
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

CREATE TABLE projects (
  id TEXT PRIMARY KEY,
  repo TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'paused', 'archived')),
  default_branch TEXT NOT NULL DEFAULT 'main',
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);

CREATE TABLE card_fields (
  project_id TEXT NOT NULL REFERENCES projects(id),
  field TEXT NOT NULL
    CHECK (field IN ('goal', 'scope', 'conventions', 'pitfalls')),
  auto_value TEXT,
  auto_sha TEXT,
  edited_value TEXT
    CHECK (edited_value IS NULL OR length(edited_value) <= 4000),
  edited_base_sha TEXT,
  edited_at TEXT,
  PRIMARY KEY (project_id, field)
);

CREATE TABLE handoffs (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id),
  task_id TEXT NOT NULL CHECK (length(task_id) BETWEEN 1 AND 200),
  status TEXT NOT NULL
    CHECK (status IN ('in_progress', 'blocked', 'ready_for_review', 'done')),
  client_id TEXT NOT NULL CHECK (length(client_id) BETWEEN 1 AND 200),
  client_name TEXT CHECK (client_name IS NULL OR length(client_name) <= 80),
  via TEXT NOT NULL DEFAULT 'mcp' CHECK (via IN ('mcp', 'web')),
  summary TEXT NOT NULL CHECK (length(summary) BETWEEN 1 AND 2000),
  next TEXT NOT NULL CHECK (length(next) BETWEEN 1 AND 2000),
  blockers TEXT CHECK (blockers IS NULL OR length(blockers) <= 2000),
  files TEXT,
  branch TEXT NOT NULL CHECK (length(branch) BETWEEN 1 AND 200),
  base_sha TEXT NOT NULL CHECK (
    length(base_sha) = 40 AND base_sha NOT GLOB '*[^0-9a-f]*'
  ),
  commit_sha TEXT CHECK (
    commit_sha IS NULL OR (
      length(commit_sha) BETWEEN 7 AND 40
      AND commit_sha NOT GLOB '*[^0-9a-f]*'
    )
  ),
  pr TEXT CHECK (pr IS NULL OR length(pr) BETWEEN 1 AND 500),
  request_id TEXT CHECK (
    request_id IS NULL OR length(request_id) BETWEEN 1 AND 100
  ),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);
CREATE INDEX idx_handoffs_project_time
  ON handoffs(project_id, created_at DESC);
CREATE INDEX idx_handoffs_task_time
  ON handoffs(project_id, task_id, created_at DESC);
CREATE UNIQUE INDEX idx_handoffs_request
  ON handoffs(project_id, client_id, request_id)
  WHERE request_id IS NOT NULL;

CREATE TABLE repo_events (
  project_id TEXT NOT NULL REFERENCES projects(id),
  kind TEXT NOT NULL CHECK (kind IN ('commit', 'pr', 'issue')),
  ref TEXT NOT NULL,
  title TEXT NOT NULL,
  state TEXT,
  author TEXT,
  url TEXT NOT NULL,
  happened_at TEXT NOT NULL,
  PRIMARY KEY (project_id, kind, ref)
);
CREATE INDEX idx_events_project_time
  ON repo_events(project_id, kind, happened_at DESC);

CREATE TABLE task_notes (
  project_id TEXT NOT NULL REFERENCES projects(id),
  path TEXT NOT NULL,
  title TEXT NOT NULL,
  status_line TEXT,
  status TEXT NOT NULL DEFAULT 'unknown'
    CHECK (status IN ('in_progress', 'blocked', 'ready_for_review', 'done', 'unknown')),
  sha TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (project_id, path)
);

CREATE TABLE sync_state (
  project_id TEXT NOT NULL REFERENCES projects(id),
  source TEXT NOT NULL
    CHECK (source IN ('commits', 'pulls', 'issues', 'agents_md', 'tasks')),
  cursor TEXT,
  checkpoint TEXT,
  last_ok_at TEXT,
  last_error TEXT,
  last_attempt_at TEXT,
  PRIMARY KEY (project_id, source)
);
