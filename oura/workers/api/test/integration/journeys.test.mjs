import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { createRuntime, login } from './runtime.mjs';

let runtime;
before(async () => {
  runtime = createRuntime();
  await runtime.ready;
});
after(async () => { await runtime?.dispose(); });

async function request(path, { cookie, ...options } = {}) {
  return runtime.dispatchFetch(`https://oura.example${path}`, {
    redirect: 'manual',
    ...options,
    headers: { ...(cookie ? { Cookie: cookie } : {}), ...options.headers },
  });
}

async function json(path, options) {
  const res = await request(path, options);
  assert.equal(res.status, 200, path);
  assert.match(res.headers.get('content-type'), /application\/json/);
  return res.json();
}

test('all frontend data routes exist and reject anonymous requests', async () => {
  for (const path of [
    '/api/me/daily?days=30', '/api/me/ai?days=7',
    '/api/me/insights/weekly', '/api/me/insights/compare?mode=week',
    '/api/me/insights/compare?mode=range',
  ]) {
    const res = await request(path);
    assert.equal(res.status, 401, path);
    assert.equal(typeof (await res.json()).error, 'string');
  }
  for (const path of ['/api/me/prefs', '/api/stripe/checkout', '/api/stripe/portal']) {
    assert.equal((await request(path, { method: 'POST' })).status, 401, path);
  }
});

test('production disables demo login and exposes frontend capability fields', async () => {
  const me = await json('/api/me');
  assert.equal(me.authenticated, false);
  assert.equal(me.allowDevLogin, false);
  assert.equal(me.stripeConfigured, false);
  assert.equal(me.subscribed, false);
  assert.equal(me.localePref, null);
  assert.equal((await request('/api/auth/dev/session')).status, 403);
  assert.equal((await request('/api/dev/subscription', { method: 'POST' })).status, 404);
});

test('OAuth rejects an unknown state without creating a session', async () => {
  const res = await request('/api/auth/oura/callback?code=test-code&state=unknown');
  assert.equal(new URL(res.headers.get('location')).searchParams.get('error'), 'invalid_state');
  assert.equal(res.headers.get('set-cookie'), null);
});

test('OAuth callback, daily windows, weekly report, compare, preferences and logout', async () => {
  const cookie = await login(runtime);
  assert.equal((await json('/api/me', { cookie })).authenticated, true);
  for (const days of [7, 30, 90]) {
    const daily = await json(`/api/me/daily?days=${days}`, { cookie });
    assert.equal(daily.source, 'oura');
    assert.equal(daily.count, days);
    assert.equal(daily.days.length, days);
    assert.equal(daily.days.at(-1).sleep.score, 80);
    assert.equal(daily.days.at(-1).activity.steps, 8000);
  }
  const weekly = await json('/api/me/insights/weekly', { cookie });
  assert.equal(weekly.ok, true);
  assert.equal(weekly.summaries.length, 3);
  assert.equal(weekly.locked, true);
  assert.deepEqual(weekly.tips, []);
  for (const mode of ['week', 'range']) {
    const compare = await json(`/api/me/insights/compare?mode=${mode}`, { cookie });
    assert.equal(compare.mode, mode);
    assert.equal(compare.locked, true);
    assert.equal(compare.left, null);
  }
  for (const locale of ['en', 'zh', 'system']) {
    await json('/api/me/prefs', {
      cookie, method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ locale }),
    });
    assert.equal((await json('/api/me', { cookie })).localePref, locale);
  }
  const db = await runtime.getD1Database('DB');
  const stored = await db.prepare('SELECT ciphertext FROM encrypted_tokens WHERE user_id = ?')
    .bind('test-user').first();
  assert.ok(stored.ciphertext);
  assert.ok(!stored.ciphertext.includes('test-refresh'));
  await json('/api/auth/logout', { cookie, method: 'POST' });
  assert.equal((await json('/api/me', { cookie })).authenticated, false);
  assert.equal((await request('/api/me/insights/weekly', { cookie })).status, 401);
});

test('subscribed reports contain computed data; unavailable services return explicit errors', async () => {
  const cookie = await login(runtime);
  const db = await runtime.getD1Database('DB');
  await db.prepare("INSERT OR REPLACE INTO subscriptions (user_id, status) VALUES (?, 'active')")
    .bind('test-user').run();
  assert.equal((await json('/api/me', { cookie })).subscribed, true);
  const weekly = await json('/api/me/insights/weekly', { cookie });
  assert.equal(weekly.locked, false);
  assert.ok(weekly.tips.length > 0);
  for (const mode of ['week', 'range']) {
    const compare = await json(`/api/me/insights/compare?mode=${mode}`, { cookie });
    assert.equal(compare.locked, false);
    assert.equal(compare.left.sleep, 80);
    assert.equal(compare.right.days, mode === 'range' ? 30 : 7);
  }
  const checkout = await request('/api/stripe/checkout', { cookie, method: 'POST' });
  assert.equal(checkout.status, 503);
  assert.equal((await checkout.json()).error, 'stripe_not_configured');
  const ai = await request('/api/me/ai', { cookie });
  assert.equal(ai.status, 501);
  assert.equal((await ai.json()).error, 'ai_not_ready');
});

test('tampered session cannot access reports', async () => {
  const cookie = await login(runtime);
  assert.equal((await request('/api/me/insights/weekly', { cookie: `${cookie}tampered` })).status, 401);
});
