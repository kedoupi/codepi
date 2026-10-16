-- Remote MCP connector: OAuth 2.1 authorization server + hashed access tokens.
-- Lets Claude / ChatGPT connect to this dashboard as a read-only personal tool.

-- Where to send the browser after the Oura login that precedes an authorization
-- request (so the connector's consent screen survives a fresh login round-trip).
ALTER TABLE oauth_states ADD COLUMN return_to TEXT;

-- Dynamically registered connector clients (RFC 7591). Public clients use
-- token_endpoint_auth_method "none" and rely on PKCE.
CREATE TABLE IF NOT EXISTS oauth_clients (
  client_id TEXT PRIMARY KEY,
  client_name TEXT,
  redirect_uris TEXT NOT NULL, -- JSON array of absolute URLs
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Short-lived authorization codes. Stored hashed; single use; PKCE bound.
CREATE TABLE IF NOT EXISTS oauth_auth_codes (
  code_hash TEXT PRIMARY KEY,
  client_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  redirect_uri TEXT NOT NULL,
  code_challenge TEXT NOT NULL,
  scope TEXT NOT NULL DEFAULT 'oura.read',
  expires_at INTEGER NOT NULL,
  consumed_at INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Access + refresh tokens, stored as SHA-256 hashes. Never keep plaintext.
CREATE TABLE IF NOT EXISTS mcp_tokens (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  client_id TEXT NOT NULL,
  kind TEXT NOT NULL, -- access | refresh
  scope TEXT NOT NULL DEFAULT 'oura.read',
  expires_at INTEGER NOT NULL,
  revoked_at INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_mcp_tokens_user ON mcp_tokens(user_id);
CREATE INDEX IF NOT EXISTS idx_mcp_tokens_client ON mcp_tokens(client_id);
