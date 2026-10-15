import { calendarDay } from "../../../../shared/dates.ts";
import assert from 'node:assert/strict';
import { test } from 'node:test';
import worker from '../../dist/index.js';
import { createRuntime, login, migrate } from './runtime.mjs';
import { failingDb } from './failing-db.mjs';

test('D1 quota is an explicit storage error with a reset time and redacted logs', async t => {
  const logs = [];
  t.mock.method(console, 'error', line => logs.push(JSON.parse(line)));
  const response = await worker.fetch(new Request('https://oura.example/api/auth/oura/start?private=test-secret'), {
    DB: failingDb(), OURA_CLIENT_ID: 'integration-client', SESSION_SECRET: 'integration-session-secret',
  });
  assert.equal(response.status, 503);
  const data = await response.json();
  assert.equal(data.error, 'storage_write_quota_exceeded');
  assert.ok(data.requestId);
  const reset = new Date(data.retryAt);
  assert.ok(reset.getTime() > Date.now());
  assert.equal(reset.getUTCHours(), 0);
  assert.equal(reset.getUTCMinutes(), 0);
  assert.ok(Number(response.headers.get('Retry-After')) > 0);
  assert.equal(JSON.stringify(data).includes('D1_ERROR'), false);
  assert.deepEqual(logs, [{
    event: 'api_failure', requestId: data.requestId, route: '/api/auth/oura/start',
    code: 'storage_write_quota_exceeded', status: 503,
  }]);
});

test('OAuth callback identifies quota both when consuming state and saving tokens', async t => {
  const runtime = createRuntime();
  t.after(() => runtime.dispose());
  await migrate(runtime);
  const bindings = await runtime.getBindings();
  t.mock.method(globalThis, 'fetch', async input => {
    const url = new URL(input);
    if (url.href === 'https://api.ouraring.com/oauth/token') return Response.json({
      access_token: 'test-access', refresh_token: 'test-refresh', expires_in: 86400,
    });
    if (url.pathname === '/v2/usercollection/personal_info') return Response.json({ id: 'test-user' });
    throw new Error('Unexpected provider request');
  });
  for (const reject of [
    sql => /^\s*DELETE FROM oauth_states/i.test(sql),
    sql => /^\s*INSERT INTO encrypted_tokens/i.test(sql),
  ]) {
    const start = await runtime.dispatchFetch('https://oura.example/api/auth/oura/start', { redirect: 'manual' });
    const state = new URL(start.headers.get('Location')).searchParams.get('state');
    const cookie = start.headers.get('Set-Cookie').split(';')[0];
    const callback = await worker.fetch(new Request(
      `https://oura.example/api/auth/oura/callback?code=test-code&state=${state}`, { headers: { Cookie: cookie } },
    ), { ...bindings, DB: failingDb(bindings.DB, reject) });
    assert.equal(callback.status, 302);
    const target = new URL(callback.headers.get('Location'));
    assert.equal(target.searchParams.get('error'), 'storage_write_quota_exceeded');
    assert.ok(Date.parse(target.searchParams.get('retry_at')) > Date.now());
  }
});

test('quota-blocked sync and score refresh preserve readable history and report storage failure', async t => {
  const runtime = createRuntime();
  t.after(() => runtime.dispose());
  await migrate(runtime);
  const cookie = await login(runtime);
  const bindings = await runtime.getBindings();
  const env = { ...bindings, DB: failingDb(bindings.DB) };
  const today = calendarDay();
  for (const path of [
    `/api/me/health-records?collection=sleep&from=${today}&to=${today}`,
    '/api/me/sync',
  ]) {
    const response = await worker.fetch(new Request(`https://oura.example${path}`, {
      method: 'POST', headers: { Cookie: cookie },
    }), env);
    assert.equal(response.status, 503);
    assert.equal((await response.json()).error, 'storage_write_quota_exceeded');
  }
  const status = await worker.fetch(new Request('https://oura.example/api/me/health-records/status', {
    headers: { Cookie: cookie },
  }), env);
  assert.equal(status.status, 200, 'quota must not block reading saved status');
});
