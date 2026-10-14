-- 版本：同一稿件每次交审生成 v+1 快照；在审版本不可覆盖；审核记录绑定版本。
CREATE TABLE post_versions (
  id TEXT PRIMARY KEY,
  post_id TEXT NOT NULL,
  version INTEGER NOT NULL,
  title TEXT NOT NULL,
  digest TEXT,
  preview_path TEXT,
  html TEXT,
  cover TEXT,
  account_id TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (post_id, version)
);

ALTER TABLE posts ADD COLUMN current_version INTEGER NOT NULL DEFAULT 0;
ALTER TABLE reviews ADD COLUMN version INTEGER;

-- 存量：交过审的稿记为 v1
INSERT INTO post_versions (id, post_id, version, title, digest, preview_path, html, cover, account_id, created_at)
SELECT 'v1-' || id, id, 1, title, digest, preview_path, html, cover, account_id, updated_at
FROM posts WHERE status != 'draft';
UPDATE posts SET current_version = 1 WHERE status != 'draft';
UPDATE reviews SET version = 1;
