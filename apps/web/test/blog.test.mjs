import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { deskFixture } from './runtime.mjs';

const draft = (overrides = {}) => ({ slug: 'hello-world', title: 'Hello', summary: 'Summary', body_markdown: '# Body', request_id: crypto.randomUUID(), ...overrides });
const rpc = (f, operation, args = {}, subject = 'kdp-owner') => f.rpc({ subject, client: 'test-client', clientName: 'Test Client', operation, args });
const submit = (f, args, subject = 'kdp-owner') => rpc(f, 'submit', args, subject);
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+ip1sAAAAASUVORK5CYII=', 'base64');
const upload = (f, alt = '一张测试图片') => rpc(f, 'media_upload', { data_base64: png.toString('base64'), alt });
const startUpload = (f, overrides = {}) => rpc(f, 'media_upload_start', { alt: '原始图片', bytes: png.length, content_type: 'image/png', ...overrides });
const putUpload = async (f, slot, body = png, headers = {}) => (await f.runtime.getWorker('desk')).fetch(slot.upload_url, {
  method: slot.method, headers: { ...slot.headers, ...headers }, body,
});
const mediaPath = media => new URL(media.url).pathname;
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
  assert.equal(resubmit.data.status, 'pending');
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
  assert.deepEqual(jsLink, { ok: false, error: 'unsafe_content', status: 400 });
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

test('publish and submit are compare-and-swap operations', async t => {
  const f = await deskFixture(t); const cookie = (await f.otpLogin('desk')).localCookie;
  await seedDraft(f, 'race');
  const [published, submitted] = await Promise.all([
    f.call('/api/blog/drafts/race/publish', cookie, {}),
    submit(f, draft({ slug: 'race', request_id: 'race-submit', title: 'Concurrent' })),
  ]);
  assert.equal(submitted.ok || published.status === 200, true);
  assert.ok([200, 409].includes(published.status));
  if (!submitted.ok) assert.equal(submitted.error, 'revision_conflict');
  const state = await f.blog.prepare('SELECT status, revision, title FROM blog_drafts WHERE slug=?').bind('race').first();
  const post = await f.blog.prepare('SELECT revision, title FROM blog_posts WHERE slug=?').bind('race').first();
  assert.equal(state.revision, submitted.ok ? 2 : 1);
  if (published.status === 200) {
    const review = await published.json();
    assert.equal(post.revision, review.revision);
    assert.equal(post.title, post.revision === 1 ? 'Draft Title' : 'Concurrent');
    assert.ok(post.revision <= state.revision);
    assert.equal(state.status, post.revision === state.revision ? 'published' : 'pending');
  } else {
    assert.equal(post, null);
    assert.equal(state.status, 'pending');
  }
});

test('a rejected draft cannot be published', async t => {
  const f = await deskFixture(t); const cookie = (await f.otpLogin('desk')).localCookie;
  await seedDraft(f, 'rejected-publish');
  assert.equal((await f.call('/api/blog/drafts/rejected-publish/reject', cookie, { note: 'No' })).status, 200);
  assert.equal((await f.call('/api/blog/drafts/rejected-publish/publish', cookie, {})).status, 404);
  assert.equal((await f.blog.prepare('SELECT COUNT(*) AS c FROM blog_posts WHERE slug=?').bind('rejected-publish').all()).results[0].c, 0);
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
test('HEAD blog routes match GET metadata and never return a body', async t => {
  const f = await deskFixture(t);
  await seedPost(f, 'head-post');
  const worker = await f.runtime.getWorker('desk');
  for (const path of ['/blog/', '/blog/head-post/']) {
    const get = await worker.fetch(`http://localhost:8804${path}`);
    const head = await worker.fetch(`http://localhost:8804${path}`, { method: 'HEAD' });
    assert.equal(head.status, get.status);
    assert.equal(head.headers.get('Content-Type'), get.headers.get('Content-Type'));
    assert.equal(head.headers.get('Cache-Control'), get.headers.get('Cache-Control'));
    assert.equal(head.headers.get('X-Asset-Method'), 'GET');
    assert.equal(await head.text(), '');
  }
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
test('tracked query URLs are purged across publish and unpublish', async t => {
  const f = await deskFixture(t); const cookie = (await f.otpLogin('desk')).localCookie;
  await seedDraft(f, 'tracked-post');
  const worker = await f.runtime.getWorker('desk');
  const query = '?utm_source=tracked';
  const preheated = await worker.fetch(`http://localhost:8804/blog/${query}`);
  assert.equal(preheated.status, 200);
  assert.doesNotMatch(await preheated.text(), /tracked-post/);
  await f.call('/api/blog/drafts/tracked-post/publish', cookie, {});
  const publishedList = await worker.fetch(`http://localhost:8804/blog/${query}`);
  assert.match(await publishedList.text(), /tracked-post/);
  const publishedArticle = await worker.fetch(`http://localhost:8804/blog/tracked-post/${query}`);
  assert.equal(publishedArticle.status, 200);
  await f.call('/api/blog/posts/tracked-post/unpublish', cookie, {});
  assert.equal((await worker.fetch(`http://localhost:8804/blog/tracked-post/${query}`)).status, 404);
  await f.call('/api/blog/drafts/tracked-post/publish', cookie, {});
  assert.equal((await worker.fetch(`http://localhost:8804/blog/tracked-post/${query}`)).status, 200);
});

test('inline image stays private until a referencing post is published and becomes private on unpublish', async t => {
  const f = await deskFixture(t); const cookie = (await f.otpLogin('desk')).localCookie;
  const result = await upload(f, '封面 [测试]');
  assert.equal(result.ok, true);
  const image = result.data;
  assert.match(image.id, /^[a-f0-9-]{36}$/);
  assert.equal(image.url, `https://codepi.app/blog/media/${image.id}`);
  assert.equal(image.markdown, `![封面 \\[测试\\]](/blog/media/${image.id})`);
  assert.equal(image.content_type, 'image/png');
  assert.equal(image.bytes, png.length);
  assert.equal(image.width, 1); assert.equal(image.height, 1);
  const path = mediaPath(image);
  const anonymous = await f.call(path);
  assert.equal(anonymous.status, 404);
  assert.equal(anonymous.headers.get('Cache-Control'), 'no-store');
  const preview = await f.call(path, cookie);
  assert.equal(preview.status, 200);
  assert.equal(preview.headers.get('Content-Type'), 'image/png');
  assert.equal(preview.headers.get('X-Content-Type-Options'), 'nosniff');
  assert.deepEqual(Buffer.from(await preview.arrayBuffer()), png);
  const submitted = await submit(f, draft({ slug: 'illustrated', cover_media_id: image.id, body_markdown: image.markdown }));
  assert.equal(submitted.ok, true);
  assert.equal(submitted.data.status, 'pending');
  assert.equal((await f.call(path)).status, 404);
  const saved = await f.blog.prepare('SELECT cover_media_id,media_ids,body_html FROM blog_drafts WHERE slug=?').bind('illustrated').first();
  assert.equal(saved.cover_media_id, image.id);
  assert.deepEqual(JSON.parse(saved.media_ids), [image.id]);
  assert.match(saved.body_html, /<figure><img src="\/blog\/media\//);
  assert.match(saved.body_html, /alt="封面 \[测试\]"/);
  assert.equal((await f.call('/api/blog/drafts/illustrated/publish', cookie, { revision: 1 })).status, 200);
  const published = await f.call(path);
  assert.equal(published.status, 200);
  assert.equal(published.headers.get('Cache-Control'), 'no-store');
  assert.deepEqual(Buffer.from(await published.arrayBuffer()), png);
  const worker = await f.runtime.getWorker('desk');
  const head = await worker.fetch(`http://localhost:8804${path}`, { method: 'HEAD' });
  assert.equal(head.status, 200); assert.equal(head.headers.get('Content-Length'), String(png.length));
  assert.equal(await head.text(), '');
  assert.equal((await f.call('/api/blog/posts/illustrated/unpublish', cookie, {})).status, 200);
  assert.equal((await f.call(path)).status, 404);
  assert.equal((await f.call(path, cookie)).status, 200);
});

test('raw upload grants return scoped headers, store original bytes and are single use', async t => {
  const f = await deskFixture(t);
  const started = await startUpload(f);
  assert.equal(started.ok, true);
  const slot = started.data;
  assert.equal(slot.method, 'PUT');
  assert.equal(new URL(slot.upload_url).origin, 'https://codepi.app');
  assert.equal(new URL(slot.upload_url).search, '');
  assert.equal(slot.headers['Content-Type'], 'image/png');
  assert.match(slot.headers.Authorization, /^Bearer [a-f0-9-]+$/);
  assert.ok(Date.parse(slot.expires_at) > Date.now());
  const response = await putUpload(f, slot);
  assert.equal(response.status, 201);
  const image = await response.json();
  assert.equal(image.alt, '原始图片');
  assert.equal(image.url, `https://codepi.app/blog/media/${image.id}`);
  assert.equal(image.markdown, `![原始图片](/blog/media/${image.id})`);
  assert.equal((await f.call(mediaPath(image))).status, 404);
  const stored = await f.blog.prepare('SELECT * FROM blog_media WHERE id=?').bind(image.id).first();
  assert.equal(stored.source, 'upload'); assert.equal(stored.client_id, 'test-client');
  assert.equal(stored.client_name, 'Test Client');
  assert.equal(stored.sha256, Buffer.from(await crypto.subtle.digest('SHA-256', png)).toString('hex'));
  const bucket = await f.runtime.getR2Bucket('BLOG_MEDIA', 'desk');
  assert.deepEqual(Buffer.from(await (await bucket.get(stored.object_key)).arrayBuffer()), png);
  assert.equal((await putUpload(f, slot)).status, 401);
  assert.equal(await f.blog.prepare('SELECT COUNT(*) AS n FROM blog_media').first('n'), 1);
});

test('upload validates alt, encoding, slot type and declared size', async t => {
  const f = await deskFixture(t);
  for (const alt of ['', ' ', '\n', 'x'.repeat(501)]) {
    assert.deepEqual(await rpc(f, 'media_upload', { alt, data_base64: png.toString('base64') }), { ok: false, error: 'alt_required', status: 400 });
  }
  for (const data_base64 of ['not base64!', '', Buffer.from('<svg/>').toString('base64')]) {
    assert.deepEqual(await rpc(f, 'media_upload', { alt: '图片', data_base64 }), { ok: false, error: data_base64 === '' ? 'payload_too_large' : 'invalid_image', status: data_base64 === '' ? 413 : 400 });
  }
  const invalid = [
    { content_type: 'image/svg+xml' }, { content_type: 'text/html' },
    { bytes: 0 }, { bytes: -1 }, { bytes: 1.5 }, { bytes: 8 * 1024 * 1024 + 1 },
  ];
  for (const args of invalid) {
    const reply = await startUpload(f, args);
    assert.equal(reply.ok, false, JSON.stringify(args)); assert.equal(reply.status, 400);
  }
  assert.equal((await rpc(f, 'media_upload', { alt: '图片', data_base64: png.toString('base64') }, 'intruder')).status, 403);
  assert.equal((await rpc(f, 'media_upload_start', { alt: '图片', bytes: png.length, content_type: 'image/png' }, 'intruder')).status, 403);
  assert.equal(await f.blog.prepare('SELECT COUNT(*) AS n FROM blog_media').first('n'), 0);
});

test('raw upload rejects missing or cross-slot tokens, foreign origins, mismatched type and size', async t => {
  const f = await deskFixture(t);
  const slot = (await startUpload(f)).data;
  const other = (await startUpload(f)).data;
  for (const [headers, status] of [
    [{ Authorization: '' }, 401],
    [{ Authorization: other.headers.Authorization }, 401],
    [{ Origin: 'https://evil.test' }, 403],
    [{ 'Content-Type': 'image/jpeg' }, 400],
    [{ 'Content-Type': 'multipart/form-data; boundary=test' }, 400],
  ]) assert.equal((await putUpload(f, slot, png, headers)).status, status);
  const wrongSize = (await startUpload(f, { bytes: png.length + 1 })).data;
  assert.equal((await putUpload(f, wrongSize)).status, 400);
  const wrongType = (await startUpload(f, { content_type: 'image/jpeg' })).data;
  assert.equal((await putUpload(f, wrongType)).status, 400);
  const malformed = (await startUpload(f, { bytes: 12 })).data;
  assert.equal((await putUpload(f, malformed, Buffer.from('not an image'))).status, 400);
  const oversized = (await startUpload(f)).data;
  assert.equal((await putUpload(f, oversized, Buffer.alloc(8 * 1024 * 1024 + 1))).status, 413);
  await f.blog.prepare('UPDATE blog_uploads SET expires_at=? WHERE id=?').bind('2000-01-01T00:00:00.000Z', new URL(other.upload_url).pathname.split('/').at(-1)).run();
  assert.equal((await putUpload(f, other)).status, 401);
  assert.equal(await f.blog.prepare('SELECT COUNT(*) AS n FROM blog_media').first('n'), 0);
  assert.equal((await (await f.runtime.getR2Bucket('BLOG_MEDIA', 'desk')).list()).objects.length, 0);
});

test('complete WebP and JPEG images pass inline and raw upload validation', async t => {
  const f = await deskFixture(t);
  const webp = await readFile(new URL('../public/brand/codepi-symbol.webp', import.meta.url));
  // Complete 1x1 JPEG generated by macOS sips from the PNG above, with APP metadata removed.
  const jpeg = Buffer.from('/9j/wAALCAABAAEBAREA/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/9sAQwACAgICAgIDAgIDBQMDAwUGBQUFBQYIBgYGBgYICggICAgICAoKCgoKCgoKDAwMDAwMDg4ODg4PDw8PDw8PDw8P/90ABAAB/9oACAEBAAA/AP38r//Z', 'base64');
  for (const [content_type, bytes] of [['image/webp', webp], ['image/jpeg', jpeg]]) {
    const inline = await rpc(f, 'media_upload', { alt: '完整图片', data_base64: bytes.toString('base64') });
    assert.equal(inline.ok, true, JSON.stringify(inline));
    assert.equal(inline.data.content_type, content_type); assert.equal(inline.data.bytes, bytes.length);
    assert.ok(inline.data.width > 0 && inline.data.height > 0);
    const started = await startUpload(f, { bytes: bytes.length, content_type });
    assert.equal(started.ok, true);
    const response = await putUpload(f, started.data, bytes);
    assert.equal(response.status, 201);
    const raw = await response.json();
    assert.equal(raw.content_type, content_type); assert.equal(raw.bytes, bytes.length);
    assert.equal(raw.width, inline.data.width); assert.equal(raw.height, inline.data.height);
    const bucket = await f.runtime.getR2Bucket('BLOG_MEDIA', 'desk');
    assert.deepEqual(Buffer.from(await (await bucket.get(`media/${raw.id}`)).arrayBuffer()), bytes);
  }
  assert.equal(await f.blog.prepare('SELECT COUNT(*) AS n FROM blog_media').first('n'), 4);
});

test('incomplete raster containers are rejected by inline and raw uploads without ready media', async t => {
  const f = await deskFixture(t);
  // A dimension-bearing VP8X header without a VP8/VP8L image payload.
  const webp = Buffer.alloc(30);
  webp.write('RIFF', 0); webp.writeUInt32LE(22, 4); webp.write('WEBP', 8);
  webp.write('VP8X', 12); webp.writeUInt32LE(10, 16);
  const samples = [
    ['PNG header only', 'image/png', png.subarray(0, 33)],
    ['JPEG frame without scan or end', 'image/jpeg', Buffer.from([255, 216, 255, 192, 0, 8, 0, 0, 1, 0, 1, 0])],
    ['JPEG unterminated marker fill', 'image/jpeg', Buffer.from([255, 216, ...Array(10).fill(255)])],
    ['WebP extended header without image', 'image/webp', webp],
  ];
  for (const [name, content_type, bytes] of samples) {
    for (const mode of ['inline', 'raw']) await t.test(`${name}: ${mode}`, async () => {
      if (mode === 'inline') {
        assert.deepEqual(await rpc(f, 'media_upload', { alt: name, data_base64: bytes.toString('base64') }),
          { ok: false, error: 'invalid_image', status: 400 });
      } else {
        const started = await startUpload(f, { alt: name, bytes: bytes.length, content_type });
        assert.equal(started.ok, true);
        const response = await putUpload(f, started.data, bytes);
        assert.equal(response.status, 400);
        assert.deepEqual(await response.json(), { error: 'invalid_image' });
      }
      assert.equal(await f.blog.prepare('SELECT COUNT(*) AS n FROM blog_media').first('n'), 0);
      assert.equal((await (await f.runtime.getR2Bucket('BLOG_MEDIA', 'desk')).list()).objects.length, 0);
    });
  }
});

test('legacy published snapshots with unavailable Markdown report conflict rather than empty content', async t => {
  const f = await deskFixture(t);
  // Migration cannot recover live revision 1 from an already-edited revision 2 draft.
  await seedPost(f, 'legacy-post');
  await seedDraft(f, 'legacy-post');
  await f.blog.prepare('UPDATE blog_drafts SET revision=2,body_markdown=? WHERE slug=?').bind('Pending replacement', 'legacy-post').run();
  assert.equal(await f.blog.prepare('SELECT body_markdown FROM blog_posts WHERE slug=?').bind('legacy-post').first('body_markdown'), null);
  assert.deepEqual(await rpc(f, 'get', { slug: 'legacy-post', view: 'published' }),
    { ok: false, error: 'markdown_unavailable', status: 409 });
  const pending = await rpc(f, 'get', { slug: 'legacy-post' });
  assert.equal(pending.ok, true); assert.equal(pending.data.revision, 2);
  assert.equal(pending.data.body_markdown, 'Pending replacement');
  const publicPage = await f.call('/blog/legacy-post/');
  assert.equal(publicPage.status, 200); assert.match(await publicPage.text(), /Public body/);
});

test('submit rejects unknown cover images and external or unknown markdown images', async t => {
  const f = await deskFixture(t);
  const unknown = crypto.randomUUID();
  for (const args of [
    { cover_media_id: unknown },
    { cover_media_id: 'https://external.test/image.png' },
    { body_markdown: `![unknown](/blog/media/${unknown})` },
    { body_markdown: '![external](https://external.test/image.png)' },
    { body_markdown: '![external](https://external.test/blog/media/' + unknown + ')' },
    { body_markdown: '![inline](data:image/png;base64,' + png.toString('base64') + ')' },
    { body_markdown: `![reference][image]\n\n[image]: /blog/media/${unknown}` },
  ]) {
    const reply = await submit(f, draft(args));
    assert.deepEqual(reply, { ok: false, error: 'unknown_media', status: 400 });
  }
  assert.equal(await f.blog.prepare('SELECT COUNT(*) AS n FROM blog_drafts').first('n'), 0);
});

test('get slices Unicode code points, pins revisions and validates read arguments', async t => {
  const f = await deskFixture(t);
  const body = '甲😀乙𠮷丙';
  await submit(f, draft({ body_markdown: body }));
  const first = await rpc(f, 'get', { slug: 'hello-world', limit: 2 });
  assert.equal(first.ok, true); assert.equal(first.data.status, 'pending');
  assert.equal(first.data.body_markdown, '甲😀'); assert.equal(first.data.body_total, 5);
  assert.equal(first.data.next_offset, 2); assert.equal(first.data.revision, 1);
  assert.equal('body_html' in first.data, false);
  const rest = await rpc(f, 'get', { slug: 'hello-world', offset: 2, limit: 8000, expected_revision: 1 });
  assert.equal(rest.data.body_markdown, '乙𠮷丙'); assert.equal(rest.data.next_offset, null);
  assert.equal((await rpc(f, 'get', { slug: 'hello-world', offset: 5 })).data.body_markdown, '');
  assert.deepEqual(await rpc(f, 'get', { slug: 'missing' }), { ok: false, error: 'not_found', status: 404 });
  assert.equal((await rpc(f, 'get', { slug: 'hello-world', view: 'published' })).status, 404);
  assert.equal((await rpc(f, 'get', { slug: 'hello-world' }, 'intruder')).status, 403);
  for (const args of [{ limit: 8001 }, { limit: 0 }, { limit: 1.5 }, { offset: -1 }, { offset: 0.5 }, { view: 'submissions' }]) {
    assert.deepEqual(await rpc(f, 'get', { slug: 'hello-world', ...args }), { ok: false, error: 'invalid_arguments', status: 400 });
  }
  await submit(f, draft({ body_markdown: '修订后', base_revision: 1 }));
  assert.deepEqual(await rpc(f, 'get', { slug: 'hello-world', offset: 2, expected_revision: 1 }), { ok: false, error: 'revision_conflict', status: 409 });
});

test('published edits keep the live snapshot and its images until revision-checked review', async t => {
  const f = await deskFixture(t); const cookie = (await f.otpLogin('desk')).localCookie;
  const oldImage = (await upload(f, '已公开')).data, newImage = (await upload(f, '未审核')).data;
  const original = draft({ title: 'Original', cover_media_id: oldImage.id, body_markdown: `Original body\n\n${oldImage.markdown}` });
  assert.equal((await submit(f, original)).data.status, 'pending');
  assert.equal((await f.call('/api/blog/drafts/hello-world/publish', cookie, { revision: 1 })).status, 200);
  const worker = await f.runtime.getWorker('desk');
  assert.match(await (await worker.fetch('http://localhost:8804/blog/hello-world/')).text(), /Original body/);
  const edit = await submit(f, draft({ title: 'Edited', cover_media_id: newImage.id, body_markdown: `Edited body\n\n${newImage.markdown}`, base_revision: 1 }));
  assert.equal(edit.data.status, 'pending'); assert.equal(edit.data.revision, 2);
  const live = await rpc(f, 'get', { slug: 'hello-world', view: 'published', expected_revision: 1 });
  assert.equal(live.data.title, 'Original'); assert.equal(live.data.body_markdown, original.body_markdown);
  const pending = await rpc(f, 'get', { slug: 'hello-world' });
  assert.equal(pending.data.title, 'Edited'); assert.equal(pending.data.status, 'pending');
  assert.equal((await f.call(mediaPath(oldImage))).status, 200);
  assert.equal((await f.call(mediaPath(newImage))).status, 404);
  const stale = await f.call('/api/blog/drafts/hello-world/publish', cookie, { revision: 1 });
  assert.equal(stale.status, 409); assert.deepEqual(await stale.json(), { error: 'revision_conflict' });
  assert.equal((await f.call('/api/blog/drafts/hello-world/reject', cookie, { revision: 1, note: 'stale' })).status, 409);
  const cached = await (await worker.fetch('http://localhost:8804/blog/hello-world/')).text();
  assert.match(cached, /Original body/); assert.doesNotMatch(cached, /Edited body/);
  assert.equal((await f.call('/api/blog/drafts/hello-world/publish', cookie, { revision: 2 })).status, 200);
  const reviewed = await rpc(f, 'get', { slug: 'hello-world', view: 'published' });
  assert.equal(reviewed.data.revision, 2); assert.equal(reviewed.data.title, 'Edited');
  assert.equal((await f.call(mediaPath(oldImage))).status, 404);
  assert.equal((await f.call(mediaPath(newImage))).status, 200);
  const current = await (await worker.fetch('http://localhost:8804/blog/hello-world/')).text();
  assert.match(current, /Edited body/); assert.doesNotMatch(current, /Original body/);
});

test('list defaults to published and submissions expose filterable review statuses', async t => {
  const f = await deskFixture(t); const cookie = (await f.otpLogin('desk')).localCookie;
  for (const slug of ['pending-post', 'rejected-post', 'withdrawn-post', 'published-post']) await submit(f, draft({ slug }));
  assert.equal((await f.call('/api/blog/drafts/rejected-post/reject', cookie, { revision: 1, note: 'Needs work' })).status, 200);
  assert.equal((await rpc(f, 'retract', { slug: 'withdrawn-post' })).ok, true);
  assert.equal((await f.call('/api/blog/drafts/published-post/publish', cookie, { revision: 1 })).status, 200);
  const published = await rpc(f, 'list');
  assert.deepEqual(published.data.posts.map(p => p.slug), ['published-post']);
  assert.equal(published.data.total, 1);
  assert.deepEqual(await rpc(f, 'list', { view: 'published' }), published);
  const all = await rpc(f, 'list', { view: 'submissions', limit: 2 });
  assert.equal(all.data.total, 4); assert.equal(all.data.drafts.length, 2); assert.equal(all.data.next_offset, 2);
  const next = await rpc(f, 'list', { view: 'submissions', offset: 2, limit: 2 });
  assert.equal(next.data.next_offset, null);
  assert.equal(new Set([...all.data.drafts, ...next.data.drafts].map(d => d.slug)).size, 4);
  for (const status of ['pending', 'rejected', 'withdrawn', 'published']) {
    const filtered = await rpc(f, 'list', { view: 'submissions', status });
    assert.equal(filtered.data.total, 1); assert.equal(filtered.data.drafts[0].status, status);
    assert.equal(filtered.data.drafts[0].slug, `${status}-post`);
    const read = await rpc(f, 'get', { slug: `${status}-post` });
    assert.equal(read.data.status, status);
    if (status === 'rejected') assert.equal(read.data.review_note, 'Needs work');
  }
  for (const args of [{ view: 'draft' }, { view: 'submissions', status: 'draft' }, { limit: 101 }, { offset: -1 }]) {
    assert.deepEqual(await rpc(f, 'list', args), { ok: false, error: 'invalid_arguments', status: 400 });
  }
});

test('blog summary reports publication and review counts', async t => {
  const f = await deskFixture(t);
  const empty = await f.rpc({ subject: 'kdp-owner', client: 'test-client', operation: 'list', args: {} });
  assert.deepEqual(empty.data.posts, []);
  const denied = await f.rpc({ subject: 'someone-else', client: 'test-client', operation: 'list', args: {} });
  assert.equal(denied.status, 403);
});
