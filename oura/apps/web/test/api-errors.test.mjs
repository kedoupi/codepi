import assert from 'node:assert/strict';
import { test } from 'node:test';
import { api, errorText, RequestError } from '../src/lib/api.ts';
import { runBackfill } from '../src/lib/backfill.ts';

test('quota details survive HTTP parsing and backfill and show an explicit Shanghai reset', async t => {
  const retryAt = '2026-10-15T00:00:00.000Z';
  t.mock.method(globalThis, 'fetch', async () => Response.json({
    error: 'storage_write_quota_exceeded', retryAt,
  }, { status: 503, headers: { 'X-Request-ID': 'test-request-id' } }));
  const window = { collection: 'sleep', from: '2026-10-14', to: '2026-10-14' };
  const result = await runBackfill([window, { ...window, collection: 'daily_readiness' }], {
    request: () => api('/api/me/health-records', { method: 'POST' }),
    shouldStop: () => false, progress: () => {},
  });
  assert.equal(result.failed.length, 1);
  assert.equal(result.remaining.length, 1);
  const failure = result.failed[0];
  assert.equal(failure.retryAt, retryAt);
  const error = new RequestError(failure.code, 503, failure.requestId, failure.retryAt);
  const zh = errorText(error, 'zh');
  assert.match(zh, /数据库写入额度/);
  assert.match(zh, /2026\/10\/15.*08:00/);
  assert.match(zh, /历史数据保留/);
  assert.match(errorText(error, 'en'), /daily reset at 00:00 UTC/);
  assert.doesNotMatch(errorText(new RequestError(failure.code, 503, '', 'invalid'), 'zh'), /Invalid Date/);
});
