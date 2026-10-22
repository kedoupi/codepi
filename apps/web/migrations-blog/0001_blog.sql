CREATE TABLE blog_drafts (
  slug TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  summary TEXT NOT NULL,
  tag TEXT,
  body_markdown TEXT NOT NULL,
  body_html TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending','published','rejected','withdrawn')),
  client_id TEXT NOT NULL,
  client_name TEXT,
  revision INTEGER NOT NULL DEFAULT 1,
  last_request_id TEXT,
  review_note TEXT,
  published_at TEXT,
  submitted_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX blog_drafts_status_updated ON blog_drafts(status, updated_at DESC);
CREATE TABLE blog_posts (
  slug TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  summary TEXT NOT NULL,
  tag TEXT,
  body_html TEXT NOT NULL,
  revision INTEGER NOT NULL,
  published_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX blog_posts_published ON blog_posts(published_at DESC);
