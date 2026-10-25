import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fixture } from './runtime.mjs';

test('read_document assembles Unicode fragments and returns whole fields without client JSON assembly', async t => {
  const f = await fixture(t), grant = await f.grant({ scope: 'health.read' });
  const comment = '合成🧪'.repeat(6000);
  await f.record('enhanced_tag', '2026-01-01', 'long', { comment, start_day: '2026-01-01' });
  const args = { tool: 'health_query_records', arguments: { collection: 'enhanced_tag', from: '2026-01-01', to: '2026-01-01' } };
  const root = (await f.tool(grant.access_token, 'read_document', args)).structuredContent;
  assert.equal(root.kind, 'object');
  assert.ok(root.fields.some(f => f.path === '/records'));
  let text = '', offset = 0;
  for (;;) {
    const reply = await f.tool(grant.access_token, 'read_document', { ...args, path: '/records/0/comment', offset, limit: 2000 });
    assert.equal(reply.isError, undefined);
    text += reply.structuredContent.text;
    if (reply.structuredContent.next_offset === null) break;
    offset = reply.structuredContent.next_offset;
  }
  assert.equal(text, comment);
  assert.equal((await f.tool(grant.access_token, 'read_document', { ...args, path: '/missing' })).structuredContent.error, 'path_not_found');
  assert.equal((await f.tool(grant.access_token, 'read_document', { tool: 'project_get', arguments: { project: 'x' } })).isError, true);
  assert.equal(f.state.providerCalls, 0);
});

test('read_document array pages contain valid objects and preserve data coverage', async t => {
  const f = await fixture(t), grant = await f.grant({ scope: 'health.read' });
  for (let i = 0; i < 3; i++) await f.record('daily_readiness', `2026-01-0${i + 1}`, `record-${i}`, { score: i });
  const args = { tool: 'health_query_records', arguments: { collection: 'daily_readiness', from: '2026-01-01', to: '2026-01-03' }, path: '/records', limit: 2 };
  const first = (await f.tool(grant.access_token, 'read_document', args)).structuredContent;
  assert.equal(first.items.length, 2);
  assert.equal(first.next_offset, 2);
  assert.ok(first.coverage);
  const last = (await f.tool(grant.access_token, 'read_document', { ...args, offset: first.next_offset,
    expected_digest: first.digest })).structuredContent;
  assert.equal(last.items.length, 1);
  assert.equal(last.next_offset, null);
  assert.equal(last.digest, first.digest);
  assert.deepEqual(last.coverage, first.coverage);
  assert.equal((await f.tool(grant.access_token, 'read_document', { ...args, expected_digest: '0'.repeat(64) })).isError, true);
});
