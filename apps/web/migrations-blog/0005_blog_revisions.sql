CREATE TABLE blog_revisions (
  slug TEXT NOT NULL,
  revision INTEGER NOT NULL,
  title TEXT NOT NULL,
  summary TEXT NOT NULL,
  body_markdown TEXT,
  submitted_at TEXT NOT NULL,
  PRIMARY KEY (slug, revision)
);
INSERT INTO blog_revisions (slug,revision,title,summary,body_markdown,submitted_at)
  SELECT slug,revision,title,summary,body_markdown,submitted_at FROM blog_drafts;
