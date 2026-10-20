import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fixture } from './runtime.mjs';
import { healthData } from './health-pages.mjs';

test('Health catalog and large Unicode records page through the real MCP transport without data loss', async t => {
  const f = await fixture(t), grant = await f.grant({ scope: 'health.read' });
  const catalog = await healthData(f, grant.access_token, 'health_get_catalog');
  assert.equal(catalog.collections.length, 19);
  const comment = '合成健康记录🧪'.repeat(5000);
  await f.record('enhanced_tag', '2026-01-01', 'synthetic-long', { comment, start_day: '2026-01-01' });
  const args = { collection: 'enhanced_tag', from: '2026-01-01', to: '2026-01-01' };
  const result = await healthData(f, grant.access_token, 'health_query_records', args);
  assert.equal(result.records[0].comment, comment);
  assert.equal(result.next_offset, null);
  assert.equal(result.refresh_requested, false);
  assert.equal(f.state.providerCalls, 0);
  const first = await f.tool(grant.access_token, 'health_query_records', args);
  const stale = await f.tool(grant.access_token, 'health_query_records', {
    ...args, offset: 1, cursor: first.structuredContent.pagination.next_cursor,
  });
  assert.equal(stale.isError, true);
  assert.equal(stale.structuredContent.error, 'cursor_stale');
  assert.equal((await f.db.prepare("SELECT COUNT(*) n FROM sqlite_master WHERE type='table' AND name LIKE 'health%'").first()).n, 0);
});

test('a full-year Health aggregate keeps every day when paging across domain RPC and MCP', async t => {
  const f = await fixture(t), grant = await f.grant({ scope: 'health.read' });
  await f.healthDb.prepare("INSERT INTO users(id) VALUES ('health-owner')").run();
  const statements = Array.from({ length: 366 }, (_, index) => {
    const day = new Date(Date.UTC(2024, 0, index + 1)).toISOString().slice(0, 10);
    return f.healthDb.prepare(`INSERT INTO health_records(user_id,collection,record_id,day,payload,fetched_at)
      VALUES('health-owner','daily_readiness',?,?,?,?)`).bind(
      `synthetic-${index}`, day, JSON.stringify({ id: `synthetic-${index}`, day, score: index % 100 }),
      '2026-01-01T00:00:00.000Z',
    );
  });
  await f.healthDb.batch(statements);
  await f.cover('daily_readiness', '2024-01-01', '2024-12-31');
  const data = await healthData(f, grant.access_token, 'health_aggregate', {
    collection: 'daily_readiness', from: '2024-01-01', to: '2024-12-31', metrics: ['score'],
    interval: 'day', operations: ['count', 'mean'],
  });
  const buckets = data.periods[0].metrics[0].buckets;
  assert.equal(buckets.length, 366);
  assert.equal(buckets.reduce((sum, bucket) => sum + bucket.count, 0), 366);
  assert.deepEqual(buckets.map(bucket => bucket.mean), Array.from({ length: 366 }, (_, index) => index % 100));
  assert.equal(f.state.providerCalls, 0);
});

test('legacy Health grants can finish a large response after the first page enqueues refresh', async t => {
  const f = await fixture(t), grant = await f.grant();
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai' }).format(new Date());
  const comment = '合成首屏刷新'.repeat(4000);
  await f.record('enhanced_tag', today, 'synthetic-refresh', { comment, start_day: today });
  await f.healthDb.prepare('INSERT INTO encrypted_tokens(user_id,iv,ciphertext) VALUES(?,?,?)')
    .bind('health-owner', 'synthetic', 'synthetic').run();
  const result = await healthData(f, grant.access_token, 'health_query_records', {
    collection: 'enhanced_tag', from: today, to: today,
  });
  assert.equal(result.records[0].comment, comment);
  assert.equal(result.refresh_requested, true);
  assert.equal(result.refresh_error, null);
  const sync = await f.healthDb.prepare('SELECT payload FROM auto_sync_state').first();
  assert.equal(JSON.parse(sync.payload).length, 1);
  assert.equal(f.state.providerCalls, 0);
});
