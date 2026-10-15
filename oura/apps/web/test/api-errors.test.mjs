import assert from 'node:assert/strict';
import { test } from 'node:test';
import { api, errorText, RequestError } from '../src/lib/api.ts';
import { runBackfill } from '../src/lib/backfill.ts';

test('HTML failures preserve HTTP status and request id, including expired sessions', async t => {
  for (const [status, code] of [[401, 'unauthorized'], [503, 'service_unavailable']]) {
    const mock = t.mock.method(globalThis, 'fetch', async () => new Response('<html>error</html>', {
      status, headers: { 'X-Request-ID': 'edge-request' },
    }));
    await assert.rejects(api('/api/me'), { code, status, requestId: 'edge-request' });
    mock.mock.restore();
  }
});

test('a successful HTTP response with HTML or primitive JSON is invalid', async t => {
  for (const body of ['<html>SPA fallback</html>', 'null', '"unexpected"', '42']) {
    const mock = t.mock.method(globalThis, 'fetch', async () => new Response(body));
    await assert.rejects(api('/api/me'), { code: 'invalid_response', status: 502 });
    mock.mock.restore();
  }
});

test('network failure is distinguished from request cancellation and timeout', async t => {
  t.mock.method(globalThis, 'fetch', async () => { throw new TypeError('Failed to fetch'); });
  await assert.rejects(api('/api/me'), { code: 'network_error', status: 0 });
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(api('/api/me', { signal: controller.signal }), { code: 'aborted', status: 0 });
  t.mock.method(AbortSignal, 'timeout', () => AbortSignal.abort());
  await assert.rejects(api('/api/me'), { code: 'timeout', status: 0 });
  await assert.rejects(api('/api/me', { signal: controller.signal }), { code: 'aborted', status: 0 });
});

test('cancellation or timeout while reading the body is not mislabeled as invalid JSON', async t => {
  const timeout = new AbortController();
  const caller = new AbortController();
  t.mock.method(AbortSignal, 'timeout', () => timeout.signal);
  const response = trigger => ({
    ok: true,
    headers: new Headers(),
    json: async () => { trigger(); throw new DOMException('Cancelled', 'AbortError'); },
  });
  const mock = t.mock.method(globalThis, 'fetch', async () => response(() => caller.abort()));
  await assert.rejects(api('/api/me', { signal: caller.signal }), { code: 'aborted', status: 0 });
  mock.mock.mockImplementation(async () => response(() => timeout.abort()));
  await assert.rejects(api('/api/me'), { code: 'timeout', status: 0 });
});

test('completed and failed requests remove listeners from a shared caller signal', async t => {
  const caller = new AbortController();
  const add = t.mock.method(caller.signal, 'addEventListener');
  const remove = t.mock.method(caller.signal, 'removeEventListener');
  const fetch = t.mock.method(globalThis, 'fetch', async (_url, init) => {
    assert.equal(init.credentials, 'include');
    assert.equal(init.cache, 'no-store');
    return Response.json({ ok: true });
  });
  assert.deepEqual(await api('/api/me', { signal: caller.signal }), { ok: true });
  fetch.mock.mockImplementation(async () => { throw new Error('offline'); });
  await assert.rejects(api('/api/me', { signal: caller.signal }), { code: 'network_error' });
  assert.equal(add.mock.callCount(), 2);
  assert.equal(remove.mock.callCount(), 2);
  for (let i = 0; i < 2; i++) {
    assert.equal(remove.mock.calls[i].arguments[1], add.mock.calls[i].arguments[1]);
  }
});

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
