import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { createRuntime, login, migrate } from './runtime.mjs';

let runtime;
before(async () => {
  runtime = createRuntime();
  await runtime.ready;
  await migrate(runtime);
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
  for (const path of ['/api/me/prefs']) {
    assert.equal((await request(path, { method: 'POST' })).status, 401, path);
  }
});

test('payment endpoints are removed and report 404 instead of a subscription flow', async () => {
  // The product no longer sells access: the Stripe and DEV-grant routes are gone.
  for (const path of ['/api/stripe/checkout', '/api/stripe/portal', '/api/stripe/webhook', '/api/dev/subscription']) {
    const res = await request(path, { method: 'POST' });
    assert.equal(res.status, 404, path);
    assert.equal((await res.json()).error, 'not found');
  }
});

test('production disables demo login and exposes frontend capability fields', async () => {
  const me = await json('/api/me');
  assert.equal(me.authenticated, false);
  assert.equal(me.allowDevLogin, false);
  assert.equal(me.localePref, null);
  assert.equal(me.capabilities.personal, false);
  assert.equal(me.capabilities.weeklyFull, false);
  assert.equal('billing' in me.capabilities, false);
  for (const field of ['subscribed', 'subscriptionStatus', 'stripeConfigured', 'priceLabel']) {
    assert.equal(field in me, false, field);
  }
  assert.equal((await request('/api/auth/dev/session')).status, 403);
});

test('OAuth rejects an unknown state without creating a session', async () => {
  const res = await request('/api/auth/oura/callback?code=test-code&state=unknown');
  assert.equal(new URL(res.headers.get('location')).searchParams.get('error'), 'invalid_state');
  assert.equal(res.headers.get('set-cookie'), null);
});

test('OAuth callback, daily windows, weekly report, compare, preferences and logout', async () => {
  const cookie = await login(runtime);
  assert.equal((await json('/api/me', { cookie })).authenticated, true);
  const state = new URL((await request('/api/auth/oura/start')).headers.get('location')).searchParams.get('state');
  assert.equal(new URL((await request(`/api/auth/oura/callback?code=x&state=${state}`)).headers.get('location')).searchParams.get('error'), 'invalid_state');
  for (const days of [7, 30, 90]) {
    const daily = await json(`/api/me/daily?days=${days}`, { cookie });
    assert.equal(daily.source, 'oura');
    assert.equal(daily.count, days);
    assert.equal(daily.days.length, days);
    assert.equal(daily.days.at(-1).sleep.score, 80);
    assert.equal(daily.days.at(-1).activity.steps, 8000);
    assert.equal(typeof daily.sync.syncedAt, 'string');
  }
  const weekly = await json('/api/me/insights/weekly', { cookie });
  assert.equal(weekly.ok, true);
  assert.equal(weekly.summaries.length, 3);
  assert.equal(weekly.locked, false);
  assert.ok(weekly.tips.length > 0);
  for (const mode of ['week', 'range']) {
    const compare = await json(`/api/me/insights/compare?mode=${mode}`, { cookie });
    assert.equal(compare.mode, mode);
    assert.equal(compare.locked, false);
    assert.equal(compare.left.sleep, 80);
  }
  const me = await json('/api/me', { cookie });
  assert.equal(me.capabilities.personal, true);
  assert.equal(me.capabilities.weeklyFull, true);
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

test('personal owner gets template analysis; AI is grounded and cached', async () => {
  const cookie = await login(runtime);
  const first = await json('/api/me/ai?days=7', { cookie });
  assert.equal(first.source, 'template');
  assert.equal(first.ok, true);
  assert.ok(Array.isArray(first.evidence));
  const second = await json('/api/me/ai?days=7', { cookie });
  assert.deepEqual(second.evidence, first.evidence);
  assert.equal(second.generatedAt, first.generatedAt);
});

test('non-owner sees locked reports and stays locked even with a legacy subscription row', async () => {
  const other = createRuntime({
    bindings: {
      ALLOW_DEV_LOGIN: '0',
      FRONTEND_ORIGIN: 'https://oura.example',
      OURA_REDIRECT_URI: 'https://oura.example/api/auth/oura/callback',
      OURA_CLIENT_ID: 'integration-client',
      OURA_CLIENT_SECRET: 'integration-client-secret',
      SESSION_SECRET: 'integration-session-secret',
      TOKEN_ENCRYPTION_KEY: 'integration-encryption-secret',
      PERSONAL_OWNER_ID: 'someone-else',
    },
  });
  try {
    await other.ready;
    await migrate(other);
    const start = await other.dispatchFetch('https://oura.example/api/auth/oura/start', { redirect: 'manual' });
    const state = new URL(start.headers.get('location')).searchParams.get('state');
    const oauthCookie = start.headers.get('set-cookie').split(';')[0];
    const callback = await other.dispatchFetch(
      `https://oura.example/api/auth/oura/callback?code=test-code&state=${encodeURIComponent(state)}`,
      { headers: { Cookie: oauthCookie }, redirect: 'manual' },
    );
    const cookie = callback.headers.get('set-cookie').split(';')[0];
    const meRes = await other.dispatchFetch('https://oura.example/api/me', { headers: { Cookie: cookie } });
    const me = await meRes.json();
    assert.equal(me.capabilities.personal, false);
    assert.equal(me.capabilities.weeklyFull, false);
    assert.equal(me.capabilities.compare, false);
    const weekly = await other.dispatchFetch('https://oura.example/api/me/insights/weekly', { headers: { Cookie: cookie } });
    const weeklyBody = await weekly.json();
    assert.equal(weeklyBody.locked, true);
    // The historical `subscriptions` table is still in the schema, but nothing
    // reads it any more: access must come from PERSONAL_OWNER_ID alone.
    const db = await other.getD1Database('DB');
    await db.prepare("INSERT OR REPLACE INTO subscriptions (user_id, status) VALUES ('test-user', 'active')").run();
    const stillLocked = await (await other.dispatchFetch('https://oura.example/api/me', { headers: { Cookie: cookie } })).json();
    assert.equal(stillLocked.capabilities.weeklyFull, false);
    assert.equal((await (await other.dispatchFetch('https://oura.example/api/me/insights/weekly', { headers: { Cookie: cookie } })).json()).locked, true);
    const ai = await other.dispatchFetch('https://oura.example/api/me/ai?days=7', { headers: { Cookie: cookie } });
    assert.equal(ai.status, 200);
    assert.equal((await ai.json()).source, 'template');
  } finally {
    await other.dispose();
  }
});

test('tampered session cannot access reports', async () => {
  const cookie = await login(runtime);
  assert.equal((await request('/api/me/insights/weekly', { cookie: `${cookie}tampered` })).status, 401);
});
