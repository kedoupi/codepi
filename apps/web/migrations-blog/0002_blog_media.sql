-- Ready images only. Rows are append-only and back the Ops original backup.
CREATE TABLE blog_media (
  id TEXT PRIMARY KEY,
  object_key TEXT NOT NULL UNIQUE,
  content_type TEXT NOT NULL,
  bytes INTEGER NOT NULL,
  sha256 TEXT NOT NULL,
  width INTEGER NOT NULL,
  height INTEGER NOT NULL,
  alt TEXT NOT NULL,
  source TEXT NOT NULL CHECK (source IN ('inline','url','upload')),
  client_id TEXT NOT NULL,
  client_name TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX blog_media_created ON blog_media(created_at DESC);
CREATE INDEX blog_media_sha ON blog_media(sha256);
-- Short-lived single-use upload slots. Only the token hash is stored.
CREATE TABLE blog_uploads (
  id TEXT PRIMARY KEY,
  token_hash TEXT NOT NULL,
  alt TEXT NOT NULL,
  content_type TEXT NOT NULL,
  bytes INTEGER NOT NULL,
  sha256 TEXT,
  client_id TEXT NOT NULL,
  client_name TEXT,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  claimed_at TEXT
);
CREATE INDEX blog_uploads_expires ON blog_uploads(expires_at);
ALTER TABLE blog_drafts ADD COLUMN cover_media_id TEXT;
ALTER TABLE blog_drafts ADD COLUMN media_ids TEXT NOT NULL DEFAULT '[]';
ALTER TABLE blog_posts ADD COLUMN cover_media_id TEXT;
ALTER TABLE blog_posts ADD COLUMN media_ids TEXT NOT NULL DEFAULT '[]';
ALTER TABLE blog_posts ADD COLUMN body_markdown TEXT;
UPDATE blog_posts SET body_markdown = (SELECT d.body_markdown FROM blog_drafts d WHERE d.slug = blog_posts.slug AND d.revision = blog_posts.revision);
