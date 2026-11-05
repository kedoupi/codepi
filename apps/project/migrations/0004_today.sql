-- Today selections and owner-side completion markers.
-- Task content remains owned by each repository; these tables only store
-- workbench decisions keyed by the pushed task key.
CREATE TABLE today_picks (
  project_id TEXT NOT NULL REFERENCES projects(id),
  task_key TEXT NOT NULL CHECK (length(task_key) BETWEEN 1 AND 64),
  picked_day TEXT NOT NULL CHECK (picked_day GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  picked_by TEXT NOT NULL CHECK (picked_by IN ('owner', 'agent')),
  removed_day TEXT CHECK (removed_day IS NULL OR removed_day GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  created_at TEXT NOT NULL,
  PRIMARY KEY (project_id, task_key)
);
CREATE INDEX idx_today_picks_day ON today_picks(project_id, picked_day, removed_day);

CREATE TABLE owner_done (
  project_id TEXT NOT NULL REFERENCES projects(id),
  task_key TEXT NOT NULL CHECK (length(task_key) BETWEEN 1 AND 64),
  done_at TEXT NOT NULL,
  PRIMARY KEY (project_id, task_key)
);
CREATE INDEX idx_owner_done_time ON owner_done(project_id, done_at);
