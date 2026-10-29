import assert from 'node:assert/strict';
import { test, after } from 'node:test';
import { createRequire } from 'node:module';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
const require = createRequire(new URL('../../auth/package.json', import.meta.url));
const { build } = require('esbuild');
const dir = await mkdtemp(path.join(tmpdir(), 'codepi-modules-'));
after(() => rm(dir, { recursive: true, force: true }));
await build({ entryPoints: [fileURLToPath(new URL('../src/modules.ts', import.meta.url))],
  bundle: true, format: 'esm', platform: 'node', outfile: path.join(dir, 'modules.mjs') });
const { callTool, tools } = await import(pathToFileURL(path.join(dir, 'modules.mjs')));
const ctx = scope => ({ subject: 'kdp-owner', client: 'synthetic-client', clientName: 'Synthetic', scope });
const summary = source => ({ source, status: 'ok', asOf: '2026-10-20', updatedAt: '2026-10-20T00:00:00Z',
  stale: false, metrics: [{ label: '状态', value: '可用' }], facts: ['合成记录'], notes: [], attention: [],
  privateMetric: { label: 'Private', value: 'must never pass' }, unexpected: 'must never pass' });

test('write-only grants expose writes but never summaries or reads', async () => {
  const context = ctx('context.read projects.write me.write');
  const names = tools(context.scope).map(t => t.name);
  assert.ok(names.includes('project_handoff_save'));
  assert.ok(names.includes('memory_save'));
  assert.ok(!names.includes('project_get'));
  assert.ok(!names.includes('me_get_profile'));
  const env = { PROJECT: { summary() { throw Error('must not call'); } },
    ME: { summary() { throw Error('must not call'); } } };
  assert.deepEqual((await callTool(env, context, 'get_context', {})).sources, []);
  await assert.rejects(callTool(env, context, 'project_get', { project: 'synthetic/repo' }), /tool_not_available/);
});

test('context whitelist and UTF-8 budget prevent large or private summary fields', async () => {
  const env = Object.fromEntries(['HEALTH', 'PROJECT', 'ME', 'GU'].map(id => [id, { async summary() {
    return { ...summary(id.toLowerCase()), facts: Array(10).fill('中文'.repeat(1000)) };
  } }]));
  const result = await callTool(env, ctx('context.read health.read projects.read me.read invest.read'), 'get_context', {});
  assert.equal(result.sources.length, 4);
  assert.ok(Buffer.byteLength(JSON.stringify(result)) <= 8192);
  for (const item of result.sources) {
    assert.equal(item.summary.privateMetric, undefined);
    assert.equal(item.summary.unexpected, undefined);
    assert.ok(Buffer.byteLength(JSON.stringify(item.summary)) <= (item.id === 'me' ? 1536 : 4096));
    assert.ok(item.summary.notes.some(note => note.includes('精简')));
  }
  const focus = await callTool(env, ctx('context.read projects.read'), 'get_context', { focus: 'health' });
  assert.deepEqual(focus.sources, []);
});

test('one hanging or failed source cannot delay other summaries beyond the deadline', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const env = { HEALTH: { summary: () => new Promise(() => {}) },
    PROJECT: { summary: async () => summary('project') },
    ME: { summary: async () => { throw Error('unavailable'); } } };
  let completed = false;
  const pending = callTool(env, ctx('context.read health.read projects.read me.read'), 'get_context', {})
    .then(result => { completed = true; return result; });
  for (let i = 0; i < 10; i++) await Promise.resolve();
  assert.equal(completed, false);
  t.mock.timers.tick(1999);
  for (let i = 0; i < 10; i++) await Promise.resolve();
  assert.equal(completed, false);
  t.mock.timers.tick(1);
  for (let i = 0; i < 10; i++) await Promise.resolve();
  assert.equal(completed, true);
  const result = await pending;
  assert.equal(result.sources.find(s => s.id === 'health').summary.status, 'unavailable');
  assert.equal(result.sources.find(s => s.id === 'project').summary.status, 'ok');
  assert.equal(result.sources.find(s => s.id === 'me').summary.status, 'unavailable');
});

test('read-only Health grants force cache-only queries and reject requested synchronization', async () => {
  let args;
  const env = { HEALTH: { execute: async request => { args = request.args; return { ok: true, data: {} }; } } };
  await callTool(env, ctx('health.read'), 'health_query_records', { collection: 'sleep' });
  assert.equal(args.refresh, false);
  await assert.rejects(callTool(env, ctx('health.read'), 'health_query_records', { collection: 'sleep', refresh: true }), /insufficient_scope/);
  assert.ok(tools('health.read').find(t => t.name === 'health_query_records').annotations.readOnlyHint);
});

test('blog_list is callable with blog.read alone; writes require blog.write', async () => {
  const calls = [];
  const env = { BLOG: { execute: async request => { calls.push(request); return { ok: true, data: { posts: [] } }; },
    summary: async () => ({ source: 'blog', status: 'empty', asOf: null, updatedAt: null, stale: false,
      metrics: [], facts: [], notes: [], attention: [] }) } };
  const reader = ctx('blog.read');
  assert.ok(tools(reader.scope).map(t => t.name).includes('blog_list'));
  assert.ok(tools(reader.scope).map(t => t.name).includes('blog_guide'));
  assert.ok(!tools('blog.write').map(t => t.name).includes('blog_guide'));
  await callTool(env, reader, 'blog_guide', {});
  assert.equal(calls[0].operation, 'guide');
  calls.length = 0;
  assert.ok(!tools(reader.scope).map(t => t.name).includes('blog_submit'));
  assert.ok(tools('blog.read').find(t => t.name === 'blog_list').annotations.readOnlyHint);
  await assert.rejects(callTool(env, reader, 'blog_submit', { slug: 'a', title: 'T', summary: 'S',
    body_markdown: 'b', request_id: 'r1' }), /tool_not_available/);
  await assert.rejects(callTool(env, reader, 'blog_retract', { slug: 'a' }), /tool_not_available/);
  await assert.rejects(callTool(env, reader, 'blog_upload_image', { data_base64: 'AA==', alt: 'Image' }), /tool_not_available/);
  await assert.rejects(callTool(env, ctx('blog.write'), 'blog_get', { slug: 'a' }), /tool_not_available/);
  await assert.rejects(callTool(env, ctx('blog.write'), 'blog_create_image_upload', { alt: 'Image', bytes: 1, content_type: 'image/png', client: 'spoofed' }), /invalid_arguments/);

  const writer = ctx('blog.write');
  const submit = { slug: 'synthetic-post', title: 'T', summary: 'S', body_markdown: 'body',
    cover_media_id: '12345678-1234-4234-8234-123456789012', category: 'tech', tags: ['synthetic'], request_id: 'r1' };
  await callTool(env, writer, 'blog_submit', submit);
  assert.equal(calls[0].client, 'synthetic-client');
  assert.equal(calls[0].clientName, 'Synthetic');
  assert.equal(calls[0].subject, 'kdp-owner');
  assert.equal(calls[0].operation, 'submit');
  await callTool(env, writer, 'blog_retract', { slug: 'synthetic-post' });
  assert.equal(calls[1].operation, 'retract');
  for (const invalid of [{ ...submit, slug: 'Bad_Slug' }, { ...submit, title: '' }, { ...submit, user_id: 'x' }]) {
    await assert.rejects(callTool(env, writer, 'blog_submit', invalid), /invalid_arguments/);
  }
  const { request_id: _omit, ...withoutId } = submit;
  await callTool(env, writer, 'blog_submit', withoutId);
  await assert.rejects(callTool(env, writer, 'blog_submit', { ...submit, body_markdown: 'x'.repeat(96 * 1024 + 1) }),
    /invalid_arguments/);
});

test('blog_submit schema requires fields enforced by the Blog worker', () => {
  const submit = tools('blog.write').find(tool => tool.name === 'blog_submit');
  assert.deepEqual(submit.inputSchema.required, ['slug', 'title', 'summary', 'body_markdown', 'cover_media_id', 'category', 'tags']);
});

test('a client on the first blog_submit schema still reaches the Blog worker', async () => {
  const calls = [];
  const env = { BLOG: { async execute(request) { calls.push(request); return { ok: true, data: { slug: request.args.slug, revision: 1 } }; } } };
  const writer = ctx('blog.write');
  // The first schema: one free-text tag, no cover, no category, no tags.
  await callTool(env, writer, 'blog_submit', {
    slug: 'legacy-post', title: 'T', summary: 'S', tag: '生活感悟', body_markdown: 'body', request_id: 'r1',
  });
  assert.deepEqual(calls[0].args.tags, ['生活感悟']);
  assert.equal(calls[0].args.cover_media_id, undefined);
  assert.equal(calls[0].args.category, undefined);
  // Without a legacy tag the request still reaches the worker and leaves the
  // tags empty instead of failing on a field the client never knew.
  await callTool(env, writer, 'blog_submit', {
    slug: 'legacy-post-2', title: 'T', summary: 'S', body_markdown: 'body', request_id: 'r2',
  });
  assert.equal(calls[1].args.tags, undefined);
  // A current client keeps the published required list: one taxonomy field
  // present is enough to hold it to the schema.
  for (const missing of ['tags', 'category']) {
    const args = { slug: 'current-post', title: 'T', summary: 'S', body_markdown: 'body',
      cover_media_id: '12345678-1234-4234-8234-123456789012', category: 'tech', tags: ['synthetic'] };
    delete args[missing];
    await assert.rejects(callTool(env, writer, 'blog_submit', args), error =>
      error.code === 'invalid_arguments' && error.field === `/${missing}` && error.reason === 'required');
  }
  // An explicit null is a field the client could not name: it is dropped and
  // left to the owner instead of failing the whole submission.
  await callTool(env, writer, 'blog_submit', {
    slug: 'null-category', title: 'T', summary: 'S', body_markdown: 'body',
    cover_media_id: '12345678-1234-4234-8234-123456789012', category: null, tags: ['synthetic'],
  });
  assert.equal(calls[2].args.category, undefined);
  assert.deepEqual(calls[2].args.tags, ['synthetic']);
  await callTool(env, writer, 'blog_submit', {
    slug: 'null-tags', title: 'T', summary: 'S', body_markdown: 'body', tag: '生活感悟', request_id: 'r3',
  });
  assert.deepEqual(calls[3].args.tags, ['生活感悟']);
  assert.equal(calls[3].args.category, undefined);
  // A client that names the category but still the old single tag is served.
  await callTool(env, writer, 'blog_submit', {
    slug: 'hybrid-post', title: 'T', summary: 'S', body_markdown: 'body', tag: '生活感悟',
    cover_media_id: '12345678-1234-4234-8234-123456789012', category: 'tech',
  });
  assert.deepEqual(calls[4].args.tags, ['生活感悟']);
  assert.equal(calls[4].args.category, 'tech');
});

test('argument failures identify schema paths and rules without exposing input', async () => {
  const submit = { slug: 'synthetic', title: 'T', summary: 'S', body_markdown: 'body',
    cover_media_id: '12345678-1234-4234-8234-123456789012', category: 'tech', tags: ['生活感悟'] };
  const cases = [
    [{ ...submit, category: undefined }, '/category', 'required'],
    [{ ...submit, slug: 'Bad_Slug' }, '/slug', 'pattern'],
    [{ ...submit, title: '' }, '/title', 'minLength'],
    [{ ...submit, summary: 'x'.repeat(501) }, '/summary', 'maxLength'],
    [{ ...submit, cover_media_id: null }, '/cover_media_id', 'type'],
    [{ ...submit, base_revision: -1 }, '/base_revision', 'minimum'],
    [{ ...submit, is_test: 'false' }, '/is_test', 'type'],
    [{ ...submit, tags: [] }, '/tags', 'minItems'],
    [{ ...submit, tags: Array(6).fill('tag') }, '/tags', 'maxItems'],
    [{ ...submit, tags: [null] }, '/tags/0', 'type'],
    [{ ...submit, sources: [{ title: 'Source', url: 42 }] }, '/sources/0/url', 'type'],
    [{ ...submit, sources: [{ title: 'Source', url: 'https://example.com', 'private-input-key': 'private-input-value' }] }, '/sources/0', 'additionalProperties'],
  ];
  const env = { BLOG: { execute() { throw Error('invalid arguments must not reach RPC'); } } };
  for (const [input, field, reason] of cases) {
    const args = Object.fromEntries(Object.entries(input).filter(([, value]) => value !== undefined));
    await assert.rejects(callTool(env, ctx('blog.write'), 'blog_submit', args), error => {
      assert.equal(error.code, 'invalid_arguments');
      assert.equal(error.status, 400);
      assert.equal(error.field, field);
      assert.equal(error.reason, reason);
      assert.doesNotMatch(JSON.stringify(error), /private-input/);
      return true;
    });
  }
  await assert.rejects(callTool(env, ctx('blog.write'), 'blog_submit', null), error =>
    error.field === '' && error.reason === 'type');
  await assert.rejects(callTool(env, ctx('health.read'), 'health_query_records', { collection: 'sleep', refresh: 'yes' }), error =>
    error.field === '/refresh' && error.reason === 'type');
});

test('blog optional nulls are advertised and omitted before RPC without mutating input', async () => {
  let received;
  const env = { BLOG: { execute: async request => { received = request.args; return { ok: true, data: {} }; } } };
  const submit = { slug: 'synthetic', title: 'T', summary: 'S', body_markdown: 'body',
    cover_media_id: '12345678-1234-4234-8234-123456789012', category: 'tech', tags: ['生活感悟'] };
  const optional = { tag: null, series: null, request_id: null, base_revision: null, sources: null, is_test: null };
  const args = { ...submit, ...optional };
  await callTool(env, ctx('blog.write'), 'blog_submit', args);
  assert.deepEqual(received, submit);
  assert.deepEqual(args, { ...submit, ...optional });
  const schema = tools('blog.write').find(tool => tool.name === 'blog_submit').inputSchema;
  for (const field of Object.keys(optional)) assert.ok(schema.properties[field].type.includes('null'), field);
});

test('domain writes receive grant identity, enforce schema and reject spoofed identity', async () => {
  let received;
  const env = { PROJECT: { execute: async request => { received = request; return { ok: true, data: { id: 'synthetic' } }; } } };
  const args = { project: 'synthetic/repo', task_id: 'task-1', status: 'in_progress', summary: 'Done', next: 'Next',
    branch: 'codex/synthetic', base_sha: 'a'.repeat(40) };
  await callTool(env, ctx('projects.write'), 'project_handoff_save', args);
  assert.equal(received.client, 'synthetic-client');
  assert.equal(received.clientName, 'Synthetic');
  for (const invalid of [{ ...args, user_id: 'other' }, { ...args, status: 'maybe' }, { ...args, task_id: '' }]) {
    await assert.rejects(callTool(env, ctx('projects.write'), 'project_handoff_save', invalid), /invalid_arguments/);
  }
});
