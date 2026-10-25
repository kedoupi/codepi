-- Clients that register for client_secret_basic/post receive a secret; only its hash is stored.
ALTER TABLE oauth_clients ADD COLUMN token_endpoint_auth_method TEXT NOT NULL DEFAULT 'none';
ALTER TABLE oauth_clients ADD COLUMN client_secret_hash TEXT;
-- Set only by rotation, never by explicit revocation, so a short retry window can tell them apart.
ALTER TABLE mcp_tokens ADD COLUMN rotated_at INTEGER;
