#!/usr/bin/env node
/**
 * Migrate production data fagao -> gzh (schema rename, single execution).
 *
 * Uses CLOUDFLARE_ACCOUNT_ID / CLOUDFLARE_API_TOKEN from the environment.
 * Aborts on any mismatch and never deletes the source database.
 */
const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;
const token = process.env.CLOUDFLARE_API_TOKEN;
const SOURCE_NAME = "fagao";
const TARGET_NAME = "gzh";
const MIGRATIONS = [
  `CREATE TABLE accounts (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('owner', 'editor', 'reviewer')),
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE sessions (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL REFERENCES accounts (id),
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  user_agent TEXT,
  ip_hash TEXT
);
CREATE TABLE otp_codes (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL,
  code_hash TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  used_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  ip_hash TEXT
);
CREATE TABLE posts (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL REFERENCES accounts (id),
  title TEXT NOT NULL,
  slot TEXT CHECK (slot IN ('早', '中', '晚') OR slot IS NULL),
  publish_date TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('draft', '待审', '需改', '可推箱', '已进箱')),
  preview_path TEXT,
  note TEXT,
  digest TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  is_demo INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE reviews (
  id TEXT PRIMARY KEY,
  post_id TEXT NOT NULL REFERENCES posts (id),
  actor_account_id TEXT NOT NULL REFERENCES accounts (id),
  action TEXT NOT NULL CHECK (action IN ('过', '要改', '拒')),
  from_status TEXT NOT NULL,
  to_status TEXT NOT NULL,
  note TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE desk_meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE kdp_sso_sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  subject TEXT NOT NULL,
  central_ref TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE TABLE kdp_sso_transactions (
  id TEXT PRIMARY KEY,
  state_hash TEXT NOT NULL,
  code_verifier TEXT NOT NULL,
  return_to TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  consumed_at INTEGER
);
CREATE TABLE d1_migrations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT UNIQUE,
  applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL
);
INSERT INTO d1_migrations (name) VALUES
  ('0001_init.sql'), ('0002_desk_meta.sql'), ('0003_post_is_demo.sql'), ('0004_sso.sql');`,
];

const TABLES = [
  "accounts", "sessions", "otp_codes", "posts", "reviews", "desk_meta",
  "kdp_sso_sessions", "kdp_sso_transactions",
];

if (!accountId || !token) throw new Error("CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN are required");

async function api(method, path, body) {
  const res = await fetch(`https://api.cloudflare.com/client/v4${path}`, {
    method,
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!data.success) throw new Error(`${method} ${path} failed: ${JSON.stringify(data.errors ?? data)}`);
  return data.result;
}

const query = (dbId, sql, params = []) => api("POST", `/accounts/${accountId}/d1/database/${dbId}/query`, { sql, params });

async function findDatabase(name) {
  const list = await api("GET", `/accounts/${accountId}/d1/database?name=${encodeURIComponent(name)}`);
  return list.find((db) => db.name === name) ?? null;
}

function insertStatements(table, rows) {
  if (!rows.length) return [];
  const cols = Object.keys(rows[0]);
  const quoted = cols.map((c) => `"${c}"`).join(",");
  return rows.map(
    (row) => `INSERT INTO "${table}" (${quoted}) VALUES (${cols.map((c) => JSON.stringify(row[c] ?? null)).join(",")});`,
  );
}

const source = await findDatabase(SOURCE_NAME);
if (!source) throw new Error(`source database ${SOURCE_NAME} not found`);
if (await findDatabase(TARGET_NAME)) throw new Error(`target database ${TARGET_NAME} already exists — refusing to overwrite`);

console.log(`[1/4] dump ${SOURCE_NAME} (${source.uuid})`);
const dump = {};
for (const table of TABLES) {
  const [result] = await query(source.uuid, `SELECT * FROM "${table}"`);
  dump[table] = result.results ?? [];
  console.log(`  ${table}: ${dump[table].length} rows`);
}

console.log(`[2/4] create ${TARGET_NAME}`);
const target = await api("POST", `/accounts/${accountId}/d1/database`, { name: TARGET_NAME });
console.log(`  uuid ${target.uuid}`);

console.log("[3/4] apply schema and import data");
for (const sql of MIGRATIONS) await query(target.uuid, sql);
for (const table of TABLES) {
  for (const sql of insertStatements(table, dump[table])) await query(target.uuid, sql);
}

console.log("[4/4] verify");
const [integrity] = await query(target.uuid, "PRAGMA integrity_check");
const check = integrity.results?.[0]?.integrity_check;
if (check !== "ok") throw new Error(`integrity_check: ${check}`);
for (const table of TABLES) {
  const [result] = await query(target.uuid, `SELECT COUNT(*) AS n FROM "${table}"`);
  const targetCount = result.results?.[0]?.n;
  if (targetCount !== dump[table].length) {
    throw new Error(`row count mismatch for ${table}: source ${dump[table].length}, target ${targetCount}`);
  }
}
console.log("ok — all tables match, integrity check ok");
console.log(`gzh database uuid: ${target.uuid}`);
