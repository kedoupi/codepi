CREATE TABLE gu_workspace_head (
  singleton INTEGER PRIMARY KEY CHECK(singleton = 1),
  revision INTEGER NOT NULL DEFAULT 0
);
INSERT INTO gu_workspace_head(singleton, revision) VALUES (1, 0);

CREATE TABLE gu_workspace_versions (
  revision INTEGER PRIMARY KEY,
  request_id TEXT NOT NULL UNIQUE,
  digest TEXT NOT NULL,
  created_at TEXT NOT NULL,
  payload TEXT NOT NULL
);

CREATE TABLE gu_materials (
  id TEXT PRIMARY KEY,
  object_key TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  content_type TEXT NOT NULL,
  size INTEGER NOT NULL,
  sha256 TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL
);
