-- Tasks removed from the owner board remain visible to the assistant until their repository snapshot changes.
CREATE TABLE owner_deleted (
  project_id TEXT NOT NULL REFERENCES projects(id),
  task_key TEXT NOT NULL CHECK (length(task_key) BETWEEN 1 AND 64),
  deleted_at TEXT NOT NULL,
  PRIMARY KEY (project_id, task_key)
);
