import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fixture } from './runtime.mjs';
import { readFile } from 'node:fs/promises';

test('real named RPC: project handoffs preserve two clients and parallel tasks', async t => {
  const f = await fixture(t);
  const first = await f.grant({ scope: 'context.read projects.read projects.write' });
  const second = await f.grant({ scope: 'projects.write' });
  const args = { project: 'synthetic/repo', task_id: 'task-a', status: 'in_progress',
    summary: 'Synthetic change', next: 'Review change', branch: 'codex/synthetic-a',
    base_sha: 'a'.repeat(40), request_id: 'synthetic-a' };
  const saved = await f.tool(first.access_token, 'project_handoff_save', args);
  assert.equal(saved.isError, undefined, JSON.stringify(saved.structuredContent));
  assert.equal((await f.tool(first.access_token, 'project_handoff_save', args)).isError, undefined);
  assert.equal((await f.tool(second.access_token, 'project_handoff_save', {
    ...args, task_id: 'task-b', branch: 'codex/synthetic-b', request_id: 'synthetic-b',
  })).isError, undefined);
  const rows = (await f.projectDb.prepare('SELECT task_id,client_id,client_name FROM handoffs ORDER BY task_id').all()).results;
  assert.equal(rows.length, 2);
  assert.equal(rows[0].client_id, first.client.client_id);
  assert.equal(rows[1].client_id, second.client.client_id);
  assert.equal(rows[0].client_name, 'Synthetic client');
  const card = await f.tool(first.access_token, 'project_get', { project: 'synthetic/repo' });
  assert.equal(card.isError, undefined);
  const data = JSON.stringify(card.structuredContent);
  assert.match(data, /task-a/);
  assert.match(data, /task-b/);
  assert.equal((await f.tool(second.access_token, 'project_get', { project: 'synthetic/repo' })).structuredContent.error, 'tool_not_available');
});

test('real named RPC: all AI memories remain pending and import retries do not duplicate originals', async t => {
  const f = await fixture(t), grant = await f.grant({ scope: 'me.read me.write' });
  const saved = await f.tool(grant.access_token, 'memory_save', { text: '喜欢中文简短说明', kind: 'preference' });
  assert.equal(saved.isError, undefined, JSON.stringify(saved.structuredContent));
  assert.equal(saved.structuredContent.status, 'pending');
  const hidden = await f.tool(grant.access_token, 'memory_search', { query: '中文' });
  assert.ok(!JSON.stringify(hidden.structuredContent).includes('喜欢中文'));
  const started = await f.tool(grant.access_token, 'memory_import', { action: 'start', request_id: 'synthetic-import' });
  assert.equal(started.isError, undefined, JSON.stringify(started.structuredContent));
  const import_id = started.structuredContent.import_id;
  const args = { action: 'chunk', import_id, index: 0, items: [{ text: '合成个人背景', kind: 'fact' }] };
  assert.equal((await f.tool(grant.access_token, 'memory_import', args)).isError, undefined);
  assert.equal((await f.tool(grant.access_token, 'memory_import', args)).isError, undefined);
  const finished = await f.tool(grant.access_token, 'memory_import', { action: 'finish', import_id });
  assert.equal(finished.isError, undefined, JSON.stringify(finished.structuredContent));
  assert.equal((await f.tool(grant.access_token, 'memory_import', { action: 'finish', import_id })).isError, undefined);
  assert.equal((await f.meDb.prepare('SELECT COUNT(*) n FROM imports').first()).n, 1);
  assert.equal((await f.meDb.prepare("SELECT COUNT(*) n FROM memories WHERE status='active'").first()).n, 0);
  assert.equal((await f.meDb.prepare('SELECT COUNT(*) n FROM memories').first()).n, 2);
});

test('real named RPC: context aggregates only readable domains and GU empty state is honest', async t => {
  const f = await fixture(t), grant = await f.grant({ scope: 'context.read health.read projects.read me.read invest.read' });
  const context = await f.tool(grant.access_token, 'get_context');
  assert.equal(context.isError, undefined);
  assert.deepEqual(context.structuredContent.sources.map(s => s.id), ['health', 'project', 'me', 'gu']);
  assert.ok(context.structuredContent.sources.every(s => s.summary.status !== 'unavailable'), JSON.stringify(context.structuredContent));
  assert.ok(Buffer.byteLength(JSON.stringify(context.structuredContent)) <= 8192);
  assert.ok(!JSON.stringify(context.structuredContent).includes('privateMetric'));
  const gu = await f.tool(grant.access_token, 'invest_get_portfolio');
  assert.equal(gu.isError, undefined, JSON.stringify(gu.structuredContent));
  assert.equal(gu.structuredContent.empty, true);
  assert.equal(gu.structuredContent.revision, 0);
  assert.equal(gu.structuredContent.as_of, null);
  const writer = await f.grant({ scope: 'context.read projects.write me.write' });
  assert.deepEqual((await f.tool(writer.access_token, 'get_context')).structuredContent.sources, []);
});

test('real named RPC: blog source appears only with a blog.read grant', async t => {
  const f = await fixture(t);
  const withBlog = await f.grant({ scope: 'context.read blog.read blog.write' });
  const context = await f.tool(withBlog.access_token, 'get_context');
  assert.equal(context.isError, undefined, JSON.stringify(context.structuredContent));
  const blog = context.structuredContent.sources.find(s => s.id === 'blog');
  assert.ok(blog, JSON.stringify(context.structuredContent));
  assert.equal(blog.summary.status, 'ok');
  const listed = await f.tool(withBlog.access_token, 'blog_list');
  assert.equal(listed.isError, undefined, JSON.stringify(listed.structuredContent));
  assert.deepEqual(listed.structuredContent.posts, []);
  const uploaded = await f.tool(withBlog.access_token, 'blog_upload_image', {
    data_base64: (await readFile(new URL('../../../apps/web/public/favicon-32.png', import.meta.url))).toString('base64'), alt: '合成图片',
  });
  assert.equal(uploaded.isError, undefined, JSON.stringify(uploaded));
  const image = uploaded.structuredContent;
  const saved = await f.tool(withBlog.access_token, 'blog_submit', {
    slug: 'mcp-image-post', title: '合成文章', summary: '完整 MCP 流程', body_markdown: image.markdown,
    cover_media_id: image.id, base_revision: 0, request_id: 'first-submit', category: 'tech', tags: ['合成'],
  });
  assert.equal(saved.isError, undefined, JSON.stringify(saved));
  assert.equal(saved.structuredContent.status, 'pending');
  const row = await f.blogDb.prepare('SELECT * FROM blog_drafts WHERE slug=?').bind('mcp-image-post').first();
  assert.equal(row.client_id, withBlog.client.client_id);
  const pending = await f.tool(withBlog.access_token, 'blog_get', { slug: row.slug });
  assert.equal(pending.structuredContent.body_markdown, image.markdown);
  assert.equal(pending.structuredContent.revision, 1);
  const focus = await f.tool(withBlog.access_token, 'get_context', { focus: 'blog' });
  assert.equal(focus.structuredContent.sources[0].summary.attention[0].href, 'https://codepi.app/desk/');
  const noBlog = await f.grant({ scope: 'context.read' });
  assert.equal((await f.tool(noBlog.access_token, 'get_context')).structuredContent.sources.find(s => s.id === 'blog'), undefined);
});

test('project lists stay bounded and expose forward pagination through the MCP schema', async t => {
  const f = await fixture(t), grant = await f.grant({ scope: 'projects.read projects.write' });
  const saved = await f.tool(grant.access_token, 'project_handoff_save', {
    project: 'synthetic/repo', task_id: 'synthetic-long-list', status: 'in_progress',
    summary: '合成'.repeat(1000), next: '下一步'.repeat(600), blockers: '合成阻塞'.repeat(400),
    files: Array.from({ length: 20 }, (_, index) => `${index}-${'x'.repeat(290)}`),
    branch: 'codex/synthetic-list', base_sha: 'a'.repeat(40), request_id: 'synthetic-long-list',
  });
  assert.equal(saved.isError, undefined);
  await f.projectDb.prepare('INSERT INTO projects(id,repo,name) VALUES(?,?,?)')
    .bind('synthetic-another', 'synthetic/another', 'Another synthetic project').run();
  const projects = [];
  let offset = 0;
  let revision;
  for (let page = 0; page < 3; page++) {
    const result = await f.tool(grant.access_token, 'projects_list', {
      offset, limit: 1, ...(revision ? { revision } : {}),
    });
    assert.equal(result.isError, undefined, JSON.stringify(result.structuredContent));
    const data = result.structuredContent;
    revision ??= data.revision;
    assert.match(revision, /^[a-f0-9]{64}$/);
    assert.equal(data.revision, revision);
    assert.ok(Buffer.byteLength(JSON.stringify(data)) <= 12 * 1024);
    assert.equal(data.projects.length, 1);
    projects.push(...data.projects);
    if (data.next_offset === null) break;
    assert.ok(Number.isSafeInteger(data.next_offset) && data.next_offset > offset);
    offset = data.next_offset;
  }
  assert.deepEqual(projects.map(project => project.repo).sort(), ['synthetic/another', 'synthetic/repo']);
  const latest = projects.find(project => project.repo === 'synthetic/repo').latest_handoff;
  assert.equal(latest.task_id, 'synthetic-long-list');
  assert.equal(latest.files, undefined);
});
