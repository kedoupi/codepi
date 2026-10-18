CREATE TABLE oauth_clients (
  client_id TEXT PRIMARY KEY,
  client_name TEXT,
  redirect_uris TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE oauth_consent_requests (
  consent_id TEXT PRIMARY KEY,
  client_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  redirect_uri TEXT NOT NULL,
  code_challenge TEXT NOT NULL,
  scope TEXT NOT NULL,
  resource TEXT NOT NULL,
  csrf_hash TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  consumed_at INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE oauth_auth_codes (
  code_hash TEXT PRIMARY KEY,
  client_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  redirect_uri TEXT NOT NULL,
  code_challenge TEXT NOT NULL,
  scope TEXT NOT NULL,
  resource TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  consumed_at INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE mcp_tokens (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  client_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK(kind IN ('access','refresh')),
  scope TEXT NOT NULL,
  resource TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  revoked_at INTEGER,
  family_id TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_mcp_tokens_user ON mcp_tokens(user_id);
CREATE INDEX idx_mcp_tokens_client ON mcp_tokens(client_id);
CREATE INDEX idx_mcp_tokens_family ON mcp_tokens(family_id);
CREATE INDEX idx_consent_expiry ON oauth_consent_requests(expires_at);
CREATE INDEX idx_codes_expiry ON oauth_auth_codes(expires_at);
CREATE TABLE kdp_sso_transactions (
  id TEXT PRIMARY KEY,
  state_hash TEXT NOT NULL,
  code_verifier TEXT NOT NULL,
  return_to TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  consumed_at INTEGER
);
CREATE INDEX idx_sso_transactions_expiry ON kdp_sso_transactions(expires_at);
CREATE TABLE kdp_sso_sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  subject TEXT NOT NULL,
  central_ref TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX idx_sso_sessions_expiry ON kdp_sso_sessions(expires_at);
