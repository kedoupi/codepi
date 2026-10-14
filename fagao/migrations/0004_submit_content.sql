-- 交稿脚本直传正文与封面（存 D1，不依赖 R2）；交稿 token 对应的系统编辑账号。
ALTER TABLE posts ADD COLUMN html TEXT;
ALTER TABLE posts ADD COLUMN cover TEXT;

INSERT OR IGNORE INTO accounts (id, email, display_name, role, active)
VALUES ('acc_submit_bot', 'submit-bot@fagao.invalid', '交稿脚本', 'editor', 1);
