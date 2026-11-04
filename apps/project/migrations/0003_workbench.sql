-- Workbench rebuild (2026-11-04). Projects push snapshots of their own task
-- lists, branches and changelog; the GitHub pull sync and editable card fields
-- are retired. SSO tables from 0001 are untouched. Existing project rows and
-- handoffs are copied forward before the old tables are dropped.

CREATE TABLE projects_v3 (
  id TEXT PRIMARY KEY CHECK (length(id) BETWEEN 1 AND 64 AND id NOT GLOB '*[^a-z0-9-]*'),
  name TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 120),
  repo TEXT UNIQUE CHECK (repo IS NULL OR length(repo) BETWEEN 3 AND 200),
  status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'paused', 'archived')),
  rules_path TEXT CHECK (rules_path IS NULL OR length(rules_path) <= 300),
  adapter_json TEXT,
  source_sha TEXT,
  source_branch TEXT,
  last_push_at TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);
INSERT INTO projects_v3 (id, name, repo, status, created_at, updated_at)
  SELECT id, name, repo, status, created_at, updated_at FROM projects;

CREATE TABLE handoffs_v3 (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects_v3(id),
  task_key TEXT NOT NULL CHECK (length(task_key) BETWEEN 1 AND 200),
  status TEXT NOT NULL
    CHECK (status IN ('in_progress', 'blocked', 'ready_for_review', 'done')),
  client_id TEXT NOT NULL CHECK (length(client_id) BETWEEN 1 AND 200),
  client_name TEXT CHECK (client_name IS NULL OR length(client_name) <= 80),
  via TEXT NOT NULL DEFAULT 'mcp' CHECK (via IN ('mcp', 'web')),
  summary TEXT NOT NULL CHECK (length(summary) BETWEEN 1 AND 2000),
  next TEXT NOT NULL CHECK (length(next) BETWEEN 1 AND 2000),
  blockers TEXT CHECK (blockers IS NULL OR length(blockers) <= 2000),
  files TEXT,
  branch TEXT CHECK (branch IS NULL OR length(branch) BETWEEN 1 AND 200),
  base_sha TEXT CHECK (
    base_sha IS NULL OR (length(base_sha) = 40 AND base_sha NOT GLOB '*[^0-9a-f]*')
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
INSERT INTO handoffs_v3 (id, project_id, task_key, status, client_id, client_name, via,
  summary, next, blockers, files, branch, base_sha, commit_sha, pr, request_id, created_at)
  SELECT id, project_id, task_id, status, client_id, client_name, via,
    summary, next, blockers, files, branch, base_sha, commit_sha, pr, request_id, created_at
  FROM handoffs;

DROP TABLE sync_leases;
DROP TABLE sync_state;
DROP TABLE task_notes;
DROP TABLE repo_events;
DROP TABLE card_fields;
DROP TABLE handoffs;
DROP TABLE projects;
ALTER TABLE projects_v3 RENAME TO projects;
ALTER TABLE handoffs_v3 RENAME TO handoffs;

CREATE INDEX idx_handoffs_project_time ON handoffs(project_id, created_at DESC);
CREATE INDEX idx_handoffs_task_time ON handoffs(project_id, task_key, created_at DESC);
CREATE UNIQUE INDEX idx_handoffs_request ON handoffs(project_id, client_id, request_id)
  WHERE request_id IS NOT NULL;

-- Push tokens: only the SHA-256 of a token is stored; one active token per project.
CREATE TABLE ingest_tokens (
  project_id TEXT PRIMARY KEY REFERENCES projects(id),
  token_hash TEXT NOT NULL UNIQUE CHECK (length(token_hash) = 64),
  created_at TEXT NOT NULL,
  last_used_at TEXT
);

CREATE TABLE snapshots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id TEXT NOT NULL REFERENCES projects(id),
  content_hash TEXT NOT NULL CHECK (length(content_hash) = 64),
  source_sha TEXT,
  pushed_at TEXT NOT NULL,
  task_count INTEGER NOT NULL,
  done_count INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX idx_snapshots_project ON snapshots(project_id, id DESC);

CREATE TABLE tasks (
  project_id TEXT NOT NULL REFERENCES projects(id),
  key TEXT NOT NULL CHECK (length(key) BETWEEN 1 AND 64),
  title TEXT NOT NULL CHECK (length(title) BETWEEN 1 AND 200),
  status TEXT NOT NULL CHECK (status IN ('decide', 'doing', 'bug', 'verify', 'idea')),
  category TEXT NOT NULL CHECK (length(category) BETWEEN 1 AND 60),
  due TEXT CHECK (due IS NULL OR due GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  recorded TEXT CHECK (recorded IS NULL OR recorded GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  what TEXT,
  impact TEXT,
  advice TEXT,
  need TEXT,
  need_kind TEXT NOT NULL DEFAULT 'none'
    CHECK (need_kind IN ('none', 'decide', 'attend', 'authorize', 'confirm')),
  source TEXT,
  related_json TEXT,
  position INTEGER NOT NULL DEFAULT 0,
  first_seen TEXT NOT NULL,
  last_seen TEXT NOT NULL,
  done_at TEXT,
  PRIMARY KEY (project_id, key)
);
CREATE INDEX idx_tasks_open ON tasks(project_id, done_at, status);
CREATE INDEX idx_tasks_done ON tasks(done_at);

CREATE TABLE branches (
  project_id TEXT NOT NULL REFERENCES projects(id),
  name TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 200),
  ahead INTEGER NOT NULL DEFAULT 0,
  last_commit_at TEXT,
  has_fragment INTEGER NOT NULL DEFAULT 0 CHECK (has_fragment IN (0, 1)),
  PRIMARY KEY (project_id, name)
);

CREATE TABLE changelog_entries (
  project_id TEXT NOT NULL REFERENCES projects(id),
  position INTEGER NOT NULL,
  date TEXT NOT NULL CHECK (date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  title TEXT NOT NULL CHECK (length(title) BETWEEN 1 AND 200),
  summary TEXT CHECK (summary IS NULL OR length(summary) <= 500),
  PRIMARY KEY (project_id, position)
);
CREATE INDEX idx_changelog_date ON changelog_entries(date DESC);
