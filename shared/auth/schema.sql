CREATE TABLE IF NOT EXISTS kdp_sso_transactions (
  id TEXT PRIMARY KEY,
  state_hash TEXT NOT NULL,
  code_verifier TEXT NOT NULL,
  return_to TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  consumed_at INTEGER
);
CREATE INDEX IF NOT EXISTS kdp_sso_transactions_expiry ON kdp_sso_transactions(expires_at);

CREATE TABLE IF NOT EXISTS kdp_sso_sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  subject TEXT NOT NULL,
  central_ref TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS kdp_sso_sessions_expiry ON kdp_sso_sessions(expires_at);
