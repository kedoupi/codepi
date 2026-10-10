-- 记住某天已经自动补过演示稿。撤掉演示后不再把当天重新种满。
CREATE TABLE desk_meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
