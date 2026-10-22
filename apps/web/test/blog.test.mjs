import assert from 'node:assert/strict';
import test from 'node:test';
import { deskFixture } from './runtime.mjs';

const draft = (overrides = {}) => ({ slug: 'hello-world', title: 'Hello', summary: 'Summary', body_markdown: '# Body', request_id: crypto.randomUUID(), ...overrides });
const submit = (f, args, subject = 'kdp-owner') => f.rpc({ subject, client: 'test-client', clientName: 'Test Client', operation: 'submit', args });
const seedPost = (f, slug = 'public-post', now = new Date().toISOString()) =>
  f.blog.prepare("INSERT INTO blog_posts (slug,title,summary,body_html,revision,published_at,updated_at) VALUES (?,?,?,?,?,?,?)")
    .bind(slug, 'Public', 'Summary', '<p>Public body</p>', 1, now, now).run();
const seedDraft = (f, slug = 'public-post', status = 'pending', now = new Date().toISOString()) =>
  f.blog.prepare("INSERT INTO blog_drafts (slug,title,summary,body_markdown,body_html,status,client_id,revision,last_request_id,submitted_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)")
    .bind(slug, 'Draft Title', 'Draft summary', '# Draft body', '<h1>Draft body</h1>', status, 'test-client', 1, 'req-seed', now, now).run();

test('blog endpoints require owner session and origin', async t => {
  const f = await deskFixture(t);
  assert.equal((await f.call('/api/blog/drafts')).status, 401);
  const login = await f.otpLogin('desk');
  assert.equal((await f.call('/api/blog/drafts', login.localCookie, undefined, { Origin: 'http://evil.test' })).status, 403);
  assert.equal((await f.call('/api/blog/drafts', login.localCookie, {}, { Origin: 'http://evil.test' })).status, 403);
});

test('BlogMcp rejects non-owner and validates submit input', async t => {
  const f = await deskFixture(t);
  const denied = await submit(f, draft(), 'someone-else');
  assert.deepEqual(denied, { ok: false, error: 'not_owner', status: 403 });
  for (const bad of ['Hello', 'has_underscore', 'api', 'preview', 'sitemap-blog.xml', 'a'.repeat(81)]) {
    const reply = await submit(f, draft({ slug: bad }));
    assert.equal(reply.ok, false, bad);
    assert.equal(reply.status, 400, bad);
  }
  assert.equal((await submit(f, draft({ slug: 'ok--dashes' }))).ok, true);
  assert.equal((await submit(f, draft({ title: 'x'.repeat(201) }))).ok, false);
  assert.equal((await submit(f, draft({ body_markdown: 'x'.repeat(96 * 1024 + 1) }))).error, 'payload_too_large');
  const withoutId = await submit(f, draft({ slug: 'no-request-id', request_id: undefined }));
  assert.equal(withoutId.ok, true);
  assert.equal((await submit(f, draft({ slug: 'no-request-id', request_id: undefined }))).data.revision, 2);
});

test('submit is idempotent, revision-checked and never touches the live post', async t => {
  const f = await deskFixture(t);
  const first = await submit(f, draft({ request_id: 'req-1' }));
  assert.equal(first.data.revision, 1);
  const retry = await submit(f, draft({ request_id: 'req-1' }));
  assert.deepEqual(retry, first);
  assert.equal((await f.blog.prepare('SELECT COUNT(*) AS c FROM blog_drafts').all()).results[0].c, 1);
  const overwrite = await submit(f, draft({ request_id: 'req-2', title: 'New title' }));
  assert.equal(overwrite.data.revision, 2);
  const conflict = await submit(f, draft({ request_id: 'req-3', base_revision: 1 }));
  assert.deepEqual(conflict, { ok: false, error: 'revision_conflict', status: 409 });
  const forced = await submit(f, draft({ request_id: 'req-4', title: 'Forced' }));
  assert.equal(forced.data.revision, 3);
  await seedPost(f, 'hello-world');
  const before = (await f.blog.prepare('SELECT * FROM blog_posts WHERE slug=?').bind('hello-world').all()).results[0];
  const resubmit = await submit(f, draft({ request_id: 'req-5', title: 'Resubmitted' }));
  assert.equal(resubmit.data.status, 'draft');
  const after = (await f.blog.prepare('SELECT * FROM blog_posts WHERE slug=?').bind('hello-world').all()).results[0];
  assert.deepEqual(after, before);
});

test('submitted HTML is sanitized and javascript: links are rejected', async t => {
  const f = await deskFixture(t);
  const withScript = await submit(f, draft({ slug: 'xss-script', body_markdown: 'Safe text\n\n<script>alert(1)</script>\n\n<img src=x onerror=alert(1)>' }));
  assert.equal(withScript.ok, true);
  const stored = (await f.blog.prepare('SELECT body_html FROM blog_drafts WHERE slug=?').bind('xss-script').all()).results[0];
  assert.match(stored.body_html, /Safe text/);
  assert.doesNotMatch(stored.body_html, /<script|onerror|<iframe/i);
  const jsLink = await submit(f, draft({ slug: 'xss-link', body_markdown: '[click](javascript:alert(1))' }));
  assert.deepEqual(jsLink, { ok: false, error: 'invalid_arguments', status: 400 });
});

test('retract only withdraws pending drafts', async t => {
  const f = await deskFixture(t);
  await submit(f, draft({ slug: 'retractable' }));
  const retracted = await f.rpc({ subject: 'kdp-owner', client: 'test-client', operation: 'retract', args: { slug: 'retractable' } });
  assert.equal(retracted.data.status, 'withdrawn');
  const missing = await f.rpc({ subject: 'kdp-owner', client: 'test-client', operation: 'retract', args: { slug: 'absent' } });
  assert.deepEqual(missing, { ok: false, error: 'not_found', status: 404 });
});

test('desk review publish reject and unpublish flow', async t => {
  const f = await deskFixture(t); const cookie = (await f.otpLogin('desk')).localCookie;
  await seedDraft(f, 'review');
  assert.equal((await f.call('/api/blog/drafts/review/publish', cookie, {})).status, 200);
  assert.equal((await f.blog.prepare('SELECT COUNT(*) AS c FROM blog_posts WHERE slug=?').bind('review').all()).results[0].c, 1);
  assert.equal((await f.call('/api/blog/posts/review/unpublish', cookie, {})).status, 200);
  assert.equal((await f.blog.prepare('SELECT COUNT(*) AS c FROM blog_posts WHERE slug=?').bind('review').all()).results[0].c, 0);
  assert.equal((await f.blog.prepare('SELECT status FROM blog_drafts WHERE slug=?').bind('review').all()).results[0].status, 'pending');
  const rejected = await f.call('/api/blog/drafts/review/reject', cookie, { note: 'Needs revision' });
  assert.equal(rejected.status, 200);
  assert.equal((await f.blog.prepare('SELECT review_note FROM blog_drafts WHERE slug=?').bind('review').all()).results[0].review_note, 'Needs revision');
  assert.equal((await f.call('/api/blog/drafts/absent/publish', cookie, {})).status, 404);
});

test('public routes render published only, preview shows drafts to the owner', async t => {
  const f = await deskFixture(t); const cookie = (await f.otpLogin('desk')).localCookie;
  await seedPost(f); await seedDraft(f, 'public-post');
  const worker = await f.runtime.getWorker('desk');
  const list = await worker.fetch('http://localhost:8804/blog/');
  assert.equal(list.status, 200);
  const listHtml = await list.text();
  assert.match(listHtml, /Public/);
  assert.doesNotMatch(listHtml, /正在整理/);
  const article = await worker.fetch('http://localhost:8804/blog/public-post/');
  assert.equal(article.status, 200);
  const articleHtml = await article.text();
  assert.match(articleHtml, /<title>Public · 博客<\/title>/);
  assert.match(articleHtml, /Public body/);
  assert.doesNotMatch(articleHtml, /blog-header/);
  assert.equal((await worker.fetch('http://localhost:8804/blog/missing/')).status, 404);
  const anonPreview = await worker.fetch('http://localhost:8804/blog/preview/public-post/', { redirect: 'manual' });
  assert.equal(anonPreview.status, 302);
  assert.match(anonPreview.headers.get('Location'), /\/api\/auth\/login\?return=/);
  const preview = await worker.fetch('http://localhost:8804/blog/preview/public-post/', { headers: { Cookie: cookie } });
  assert.equal(preview.status, 200);
  assert.equal(preview.headers.get('Cache-Control'), 'no-store');
  assert.equal(preview.headers.get('X-Robots-Tag'), 'noindex, nofollow');
  const previewHtml = await preview.text();
  assert.match(previewHtml, /Draft body/);
  assert.doesNotMatch(previewHtml, /Public body/);
});

test('sitemap and cache follow publish and unpublish', async t => {
  const f = await deskFixture(t); const cookie = (await f.otpLogin('desk')).localCookie;
  await seedDraft(f, 'cached-post');
  const worker = await f.runtime.getWorker('desk');
  const sitemapBefore = await (await worker.fetch('http://localhost:8804/sitemap-blog.xml')).text();
  assert.doesNotMatch(sitemapBefore, /cached-post/);
  await f.call('/api/blog/drafts/cached-post/publish', cookie, {});
  const first = await worker.fetch('http://localhost:8804/blog/cached-post/');
  assert.equal(first.headers.get('X-Asset-Fetch-Count'), '1');
  const second = await worker.fetch('http://localhost:8804/blog/cached-post/');
  assert.equal(second.headers.get('X-Asset-Fetch-Count'), '1');
  const sitemapAfter = await (await worker.fetch('http://localhost:8804/sitemap-blog.xml')).text();
  assert.match(sitemapAfter, /cached-post/);
  await f.call('/api/blog/posts/cached-post/unpublish', cookie, {});
  assert.equal((await worker.fetch('http://localhost:8804/blog/cached-post/')).status, 404);
  const sitemapFinal = await (await worker.fetch('http://localhost:8804/sitemap-blog.xml')).text();
  assert.doesNotMatch(sitemapFinal, /cached-post/);
});

test('blog summary reports publication and review counts', async t => {
  const f = await deskFixture(t);
  const empty = await f.rpc({ subject: 'kdp-owner', client: 'test-client', operation: 'list', args: {} });
  assert.deepEqual(empty.data.posts, []);
  const denied = await f.rpc({ subject: 'someone-else', client: 'test-client', operation: 'list', args: {} });
  assert.equal(denied.status, 403);
});
