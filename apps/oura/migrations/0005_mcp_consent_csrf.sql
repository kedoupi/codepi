-- One-time consent transactions bind a connector consent screen to the
-- signed-in owner and a random CSRF token. An approval POST must present a
-- live transaction; displaying the screen alone never grants access.
CREATE TABLE IF NOT EXISTS oauth_consent_requests (
  consent_id TEXT PRIMARY KEY,
  client_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  redirect_uri TEXT NOT NULL,
  code_challenge TEXT NOT NULL,
  scope TEXT NOT NULL DEFAULT 'oura.read',
  csrf_hash TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  consumed_at INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_oauth_consent_user ON oauth_consent_requests(user_id);
