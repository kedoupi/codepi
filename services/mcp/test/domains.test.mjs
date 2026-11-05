import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fixture } from './runtime.mjs';
import { readFile } from 'node:fs/promises';

test('real named RPC: project handoffs preserve two clients and parallel tasks', async t => {
  const f = await fixture(t);
  const first = await f.grant({ scope: 'context.read projects.read projects.write' });
  const second = await f.grant({ scope: 'projects.write' });
  const args = { project: 'synthetic/repo', task: 'task-a', status: 'in_progress',
    summary: 'Synthetic change', next: 'Review change', branch: 'codex/synthetic-a',
    base_sha: 'a'.repeat(40), request_id: 'synthetic-a' };
  const saved = await f.tool(first.access_token, 'project_handoff_save', args);
  assert.equal(saved.isError, undefined, JSON.stringify(saved.structuredContent));
  assert.equal((await f.tool(first.access_token, 'project_handoff_save', args)).isError, undefined);
  assert.equal((await f.tool(second.access_token, 'project_handoff_save', {
    project: 'synthetic-repo', task: 'task-b', status: 'blocked', summary: 'No remote', next: 'Wait', request_id: 'synthetic-b',
  })).isError, undefined);
  const rows = (await f.projectDb.prepare('SELECT task_key,client_id,client_name FROM handoffs ORDER BY task_key').all()).results;
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

test('work tools read pushed tasks through the named RPC with bounded, unpaged replies', async t => {
  const f = await fixture(t), grant = await f.grant({ scope: 'context.read projects.read projects.write' });
  const overview = await f.tool(grant.access_token, 'work_overview', {});
  assert.equal(overview.isError, undefined, JSON.stringify(overview.structuredContent));
  assert.equal(overview.structuredContent.counts.need_you, 1);
  assert.equal(overview.structuredContent.need_you[0].title, '合成待办');
  assert.ok(Buffer.byteLength(JSON.stringify(overview.structuredContent)) <= 12 * 1024);
  const list = await f.tool(grant.access_token, 'task_list', { need: 'decide', limit: 10 });
  assert.equal(list.isError, undefined, JSON.stringify(list.structuredContent));
  assert.equal(list.structuredContent.tasks.length, 1);
  assert.match(list.structuredContent.revision, /^[a-f0-9]{64}$/);
  assert.equal(list.structuredContent.next_offset, null);
  assert.equal((await f.tool(grant.access_token, 'task_list', { status: '执行' })).isError, true);
  const detail = await f.tool(grant.access_token, 'task_get', { project: 'synthetic/repo', key: 'synthetic-task' });
  assert.equal(detail.structuredContent.task.what, '合成说明');
  const saved = await f.tool(grant.access_token, 'project_handoff_save', {
    project: 'synthetic-repo', task: 'synthetic-task', status: 'in_progress',
    summary: '合成'.repeat(1000), next: '下一步'.repeat(600), blockers: '合成阻塞'.repeat(400),
    files: Array.from({ length: 20 }, (_, index) => `${index}-${'x'.repeat(290)}`), request_id: 'synthetic-long',
  });
  assert.equal(saved.isError, undefined, JSON.stringify(saved.structuredContent));
  const card = await f.tool(grant.access_token, 'project_get', { project: 'synthetic-repo' });
  assert.equal(card.isError, undefined);
  assert.equal(card.structuredContent.pagination, undefined);
  assert.ok(Buffer.byteLength(JSON.stringify(card.structuredContent)) <= 12 * 1024);
  assert.equal(card.structuredContent.counts.need_you, 1);
  const context = await f.tool(grant.access_token, 'get_context', { focus: 'project' });
  const project = context.structuredContent.sources.find(source => source.id === 'project');
  assert.equal(project.summary.metrics[0].label, '需要你');
  assert.deepEqual(project.next_tools, ["today_get", "work_overview"]);
  for (const retired of ['projects_list']) {
    assert.equal((await f.tool(grant.access_token, retired, {})).isError, true, retired);
  }
});
