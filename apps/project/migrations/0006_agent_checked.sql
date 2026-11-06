CREATE TABLE agent_checked (
  project_id TEXT NOT NULL REFERENCES projects(id),
  task_key TEXT NOT NULL CHECK (length(task_key) BETWEEN 1 AND 64),
  checked_day TEXT NOT NULL CHECK (checked_day GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  note TEXT NOT NULL CHECK (length(note) BETWEEN 1 AND 200),
  checked_at TEXT NOT NULL,
  PRIMARY KEY (project_id, task_key, checked_day)
);
