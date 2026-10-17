import assert from 'node:assert/strict';
import { test } from 'node:test';
import { centralFixture, createRuntime, loginSso, migrate } from './runtime.mjs';

const health = 'https://health.codepi.app';

async function fixture(t) {
  const central = centralFixture();
  const runtime = createRuntime({ sso: true, serviceBindings: { AUTH: central.fetch }, bindings: {
    FRONTEND_ORIGIN: health, FRONTEND_ORIGINS: health,
    OURA_REDIRECT_URI: `${health}/api/auth/oura/callback`,
  } });
  t.after(() => runtime.dispose());
  await migrate(runtime);
  const db = await runtime.getD1Database('DB');
  await db.prepare("INSERT INTO users(id,oura_user_id) VALUES ('test-user','test-user')").run();
  return { runtime, db, request: (origin, path, cookie = '', init = {}) =>
    runtime.dispatchFetch(origin + path, { redirect: 'manual', ...init,
      headers: { Cookie: cookie, ...init.headers } }) };
}

test('Health connects Oura directly on its new domain without a legacy-host bridge', async t => {
  const f = await fixture(t);
  assert.equal((await f.request(health, '/api/auth/oura/start')).status, 401);
  const healthCookie = await loginSso(f.runtime, health);
  const start = await f.request(health, '/api/auth/oura/start', healthCookie);
  assert.equal(start.status, 302);
  const authorize = new URL(start.headers.get('Location'));
  assert.equal(authorize.searchParams.get('redirect_uri'), `${health}/api/auth/oura/callback`);
  const state = authorize.searchParams.get('state');
  const stateCookie = start.headers.get('Set-Cookie').split(';')[0];
  const callback = await f.request(health, `/api/auth/oura/callback?code=test-code&state=${state}`,
    `${healthCookie}; ${stateCookie}`);
  assert.equal(callback.status, 302);
  assert.equal(callback.headers.get('Location'), `${health}/?login=ok`);
  const me = await (await f.request(health, '/api/me', healthCookie)).json();
  assert.equal(me.authenticated, true);
  assert.equal(me.userId, 'test-user');
  assert.equal(me.ouraConnection.status, 'connected');
  assert.equal((await f.request(health, '/api/me/daily', healthCookie)).status, 200);
  assert.equal((await f.db.prepare('SELECT COUNT(*) n FROM users').first()).n, 1);
  assert.equal((await f.db.prepare('SELECT COUNT(*) n FROM encrypted_tokens').first()).n, 1);
});

test('settings-triggered reconnect returns to the canonical settings page', async t => {
  const f = await fixture(t);
  const healthCookie = await loginSso(f.runtime, health);
  const settings = `${health}/settings`;
  const start = await f.request(health, `/api/auth/oura/start?health_return=${encodeURIComponent(settings)}`, healthCookie);
  assert.equal(new URL(start.headers.get('Location')).searchParams.get('redirect_uri'), `${health}/api/auth/oura/callback`);
  const state = new URL(start.headers.get('Location')).searchParams.get('state');
  const callback = await f.request(health, `/api/auth/oura/callback?code=test-code&state=${state}`,
    `${healthCookie}; ${start.headers.get('Set-Cookie').split(';')[0]}`);
  assert.equal(callback.headers.get('Location'), settings);
  const syncing = await f.request(health, '/api/auth/oura/start?sync_health=1', healthCookie);
  const syncState = new URL(syncing.headers.get('Location')).searchParams.get('state');
  const syncCallback = await f.request(health, `/api/auth/oura/callback?code=test-code&state=${syncState}`,
    `${healthCookie}; ${syncing.headers.get('Set-Cookie').split(';')[0]}`);
  assert.equal(syncCallback.headers.get('Location'), '/settings?sync=90');
});

test('existing MCP credentials remain usable on the new domain without data migration', async t => {
  const f = await fixture(t);
  await f.db.prepare("INSERT INTO oauth_clients(client_id,client_name,redirect_uris) VALUES ('existing-client','Existing client','[]')").run();
  for (const [kind, raw] of [['access', 'existing-access'], ['refresh', 'existing-refresh']]) {
    const hash = Buffer.from(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(raw))).toString('base64url');
    await f.db.prepare(`INSERT INTO mcp_tokens(token_hash,user_id,client_id,kind,expires_at,family_id)
      VALUES (?,'test-user','existing-client',?,?,'existing-family')`).bind(hash, kind, Date.now() + 3600000).run();
  }
  for (const origin of [health]) {
    const result = await f.request(origin, '/mcp', '', { method: 'POST',
      headers: { Authorization: 'Bearer existing-access', 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
    });
    assert.equal(result.status, 200);
    assert.ok((await result.json()).result.tools.length);
  }
  const refreshed = await f.request(health, '/oauth/token', '', { method: 'POST',
    body: new URLSearchParams({ grant_type: 'refresh_token', client_id: 'existing-client', refresh_token: 'existing-refresh' }),
  });
  assert.equal(refreshed.status, 200, 'old clients keep their refresh flow');
});

test('new-domain errors and provider returns cannot redirect elsewhere', async t => {
  const f = await fixture(t);
  for (const origin of [health]) {
    const response = await f.request(origin, '/api/auth/callback?error=denied');
    assert.equal(new URL(response.headers.get('Location')).origin, origin);
    for (const path of ['/.well-known/oauth-protected-resource', '/.well-known/oauth-authorization-server']) {
      const metadata = await (await f.request(origin, path)).json();
      if (metadata.resource) assert.equal(metadata.resource, origin + '/mcp');
      if (metadata.issuer) assert.equal(metadata.issuer, origin);
    }
  }
  const cookie = await loginSso(f.runtime, health);
  for (const target of ['https://evil.test/settings', `${health}/settings?next=evil`, `${health}/settings#fragment`]) {
    const start = await f.request(health, `/api/auth/oura/start?health_return=${encodeURIComponent(target)}`, cookie);
    const state = new URL(start.headers.get('Location')).searchParams.get('state');
    const callback = await f.request(health, `/api/auth/oura/callback?code=test-code&state=${state}`,
      `${cookie}; ${start.headers.get('Set-Cookie').split(';')[0]}`);
    assert.equal(new URL(callback.headers.get('Location')).origin, health);
  }
});
