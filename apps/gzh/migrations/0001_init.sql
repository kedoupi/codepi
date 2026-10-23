-- 发稿台一期 schema + 种子
-- 品牌账号展示名「珂抖屁」；登录允许名单另由 ALLOWLIST 控制

CREATE TABLE accounts (
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

CREATE INDEX idx_sessions_account ON sessions (account_id);
CREATE INDEX idx_sessions_expires ON sessions (expires_at);

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

CREATE INDEX idx_otp_email_created ON otp_codes (email, created_at);
CREATE INDEX idx_otp_ip_created ON otp_codes (ip_hash, created_at);

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
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE UNIQUE INDEX idx_posts_date_slot ON posts (publish_date, slot) WHERE slot IS NOT NULL;
CREATE INDEX idx_posts_date ON posts (publish_date);

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

CREATE INDEX idx_reviews_post ON reviews (post_id, created_at);

-- 公开仓库：owner 账号使用合成邮箱；生产实际邮箱由环境配置为准。
INSERT INTO accounts (id, email, display_name, role, active)
VALUES ('acc_owner_kdp', 'owner@example.com', '珂抖屁', 'owner', 1);

INSERT INTO posts (
  id, account_id, title, slot, publish_date, status, preview_path, note, digest
) VALUES
  (
    'kdp-0917-zao',
    'acc_owner_kdp',
    '早档：开箱一件小事',
    '早',
    '2026-09-17',
    '待审',
    '/previews/kdp-0917-zao/',
    NULL,
    '演示待审稿，老板可点过 / 要改 / 拒。'
  ),
  (
    'kdp-0917-zhong',
    'acc_owner_kdp',
    '中档：午饭话题',
    '中',
    '2026-09-17',
    '需改',
    '/previews/kdp-0917-zhong/',
    '标题再收一点',
    '演示需改稿，编辑改完可再交待审。'
  ),
  (
    'kdp-0917-wan',
    'acc_owner_kdp',
    '晚档：可推箱示例',
    '晚',
    '2026-09-17',
    '可推箱',
    '/previews/kdp-0917-wan/',
    NULL,
    '已过审。示例编辑人工推进微信草稿箱后点「已进箱」。'
  );
