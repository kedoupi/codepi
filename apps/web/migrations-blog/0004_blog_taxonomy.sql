ALTER TABLE blog_drafts ADD COLUMN category TEXT;
ALTER TABLE blog_drafts ADD COLUMN tags TEXT NOT NULL DEFAULT '[]';
ALTER TABLE blog_drafts ADD COLUMN series TEXT;
ALTER TABLE blog_drafts ADD COLUMN sources TEXT NOT NULL DEFAULT '[]';
ALTER TABLE blog_posts ADD COLUMN category TEXT;
ALTER TABLE blog_posts ADD COLUMN tags TEXT NOT NULL DEFAULT '[]';
ALTER TABLE blog_posts ADD COLUMN series TEXT;
ALTER TABLE blog_posts ADD COLUMN sources TEXT NOT NULL DEFAULT '[]';
UPDATE blog_drafts SET tags=json_array(tag) WHERE tag IS NOT NULL;
UPDATE blog_posts SET tags=json_array(tag) WHERE tag IS NOT NULL;
CREATE TABLE blog_categories (
  slug TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  created_at TEXT NOT NULL
);
INSERT INTO blog_categories (slug,name,created_at) VALUES
  ('digital-space','数字空间','2026-10-27T00:00:00.000Z'),
  ('health','健康记录','2026-10-27T00:00:00.000Z'),
  ('investing','投资观察','2026-10-27T00:00:00.000Z'),
  ('content','内容工作','2026-10-27T00:00:00.000Z'),
  ('tech','技术实践','2026-10-27T00:00:00.000Z'),
  ('life','生活随笔','2026-10-27T00:00:00.000Z');
CREATE INDEX idx_blog_posts_category ON blog_posts(category);
