-- 新增「弃用」状态（重建 posts 以更新 CHECK）+ 测试稿标记 is_test（测试稿不占正式档位、默认不进看板）。
PRAGMA defer_foreign_keys = true;

CREATE TABLE posts_new (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL REFERENCES accounts (id),
  title TEXT NOT NULL,
  slot TEXT CHECK (slot IN ('早', '中', '晚') OR slot IS NULL),
  publish_date TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('draft', '待审', '需改', '可推箱', '已进箱', '弃用')),
  preview_path TEXT,
  note TEXT,
  digest TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  is_demo INTEGER NOT NULL DEFAULT 0,
  html TEXT,
  cover TEXT,
  current_version INTEGER NOT NULL DEFAULT 0,
  is_test INTEGER NOT NULL DEFAULT 0,
  discarded_slot TEXT
);

INSERT INTO posts_new (id, account_id, title, slot, publish_date, status, preview_path, note, digest,
                       created_at, updated_at, is_demo, html, cover, current_version)
SELECT id, account_id, title, slot, publish_date, status, preview_path, note, digest,
       created_at, updated_at, is_demo, html, cover, current_version
FROM posts;

DROP TABLE posts;
ALTER TABLE posts_new RENAME TO posts;

CREATE UNIQUE INDEX idx_posts_date_slot ON posts (publish_date, slot, is_test) WHERE slot IS NOT NULL;
CREATE INDEX idx_posts_date ON posts (publish_date);
