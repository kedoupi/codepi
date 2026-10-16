CREATE TABLE auth_transactions (
  id TEXT PRIMARY KEY,
  client_id TEXT NOT NULL,
  redirect_uri TEXT NOT NULL,
  state TEXT NOT NULL,
  challenge TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  otp_hash TEXT,
  otp_expires_at INTEGER,
  attempts INTEGER NOT NULL DEFAULT 0,
  consumed_at INTEGER
);
CREATE INDEX auth_transactions_expiry ON auth_transactions(expires_at);
CREATE TABLE auth_sessions (
  id TEXT PRIMARY KEY,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  revoked_at INTEGER
);
CREATE INDEX auth_sessions_expiry ON auth_sessions(expires_at);
CREATE TABLE auth_codes (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  client_id TEXT NOT NULL,
  redirect_uri TEXT NOT NULL,
  challenge TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  consumed_at INTEGER
);
CREATE INDEX auth_codes_session ON auth_codes(session_id);
CREATE INDEX auth_codes_expiry ON auth_codes(expires_at);
CREATE TABLE auth_refs (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  client_id TEXT NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX auth_refs_session ON auth_refs(session_id);
CREATE INDEX auth_refs_expiry ON auth_refs(expires_at);
CREATE TABLE auth_otp_sends (
  id TEXT PRIMARY KEY,
  created_at INTEGER NOT NULL
);
CREATE INDEX auth_otp_sends_time ON auth_otp_sends(created_at);
