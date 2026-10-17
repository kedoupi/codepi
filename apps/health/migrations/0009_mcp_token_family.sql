-- Refresh-token families for the MCP connector's OAuth 2.1 authorization server.
-- Rotation now detects a replayed (already rotated) refresh token and retires
-- the whole family, per OAuth 2.1 reuse detection. Historical rows have no
-- recoverable pairing/rotation links, so conservatively group every credential
-- for one user + client together, including revoked ancestors. Existing tokens
-- remain usable, but replay/revocation retires all of that client's old grants.
-- Hex-encoded components make this unambiguous even when ids contain colons.
-- New authorizations use independent random families.
ALTER TABLE mcp_tokens ADD COLUMN family_id TEXT;

UPDATE mcp_tokens
SET family_id = 'legacy:' || hex(user_id) || ':' || hex(client_id)
WHERE family_id IS NULL;

CREATE INDEX IF NOT EXISTS idx_mcp_tokens_family ON mcp_tokens(family_id);
