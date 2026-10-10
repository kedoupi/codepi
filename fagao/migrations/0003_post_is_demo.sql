-- 演示标不再只靠 kdp-MMDD-* slug。真稿换上去或标为正式稿后 is_demo=0。
ALTER TABLE posts ADD COLUMN is_demo INTEGER NOT NULL DEFAULT 0;

UPDATE posts
SET is_demo = 1
WHERE id LIKE 'kdp-____-zao'
   OR id LIKE 'kdp-____-zhong'
   OR id LIKE 'kdp-____-wan';
