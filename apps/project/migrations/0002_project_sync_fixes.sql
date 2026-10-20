-- Pull request merge time is distinct from the updated_at value used for
-- incremental ingestion and the pull high-water cursor.
ALTER TABLE repo_events ADD COLUMN merged_at TEXT;
CREATE INDEX idx_events_project_merged
  ON repo_events(project_id, kind, merged_at DESC);

-- One durable lease per project serializes manual and scheduled syncs. The
-- cooldown survives release so failed or partial syncs still wait 60 seconds.
CREATE TABLE sync_leases (
  project_id TEXT PRIMARY KEY REFERENCES projects(id),
  lease_id TEXT NOT NULL,
  claimed_at_ms INTEGER NOT NULL,
  cooldown_until_ms INTEGER NOT NULL,
  lease_until_ms INTEGER NOT NULL
);
