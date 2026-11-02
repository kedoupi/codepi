CREATE TABLE oauth_registration_events (
  id TEXT PRIMARY KEY,
  source_hash TEXT NOT NULL,
  bucket_started INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX idx_oauth_registration_source_bucket
  ON oauth_registration_events(source_hash, bucket_started);
CREATE INDEX idx_oauth_registration_bucket
  ON oauth_registration_events(bucket_started);
CREATE INDEX idx_oauth_registration_created
  ON oauth_registration_events(created_at);
