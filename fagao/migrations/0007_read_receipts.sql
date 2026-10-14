-- 服务端读完回执：审核人读到当前版本底部才能 过/要改/拒。
CREATE TABLE read_receipts (
  post_id TEXT NOT NULL,
  version INTEGER NOT NULL,
  account_id TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (post_id, version, account_id)
);
