ALTER TABLE blog_drafts ADD COLUMN is_test INTEGER NOT NULL DEFAULT 0;
ALTER TABLE blog_drafts ADD COLUMN archived_at TEXT;
CREATE INDEX idx_blog_drafts_review_queue ON blog_drafts(archived_at, is_test, status, updated_at DESC);
