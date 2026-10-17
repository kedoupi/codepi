import { calendarDay } from "../../../../shared/dates.ts";
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { centralFixture, connectOura, createRuntime, login, loginSso, migrate } from './runtime.mjs';

const origin = 'https://oura.example';
const today = calendarDay();
async function fixture(t, options = {}) {
  const central = centralFixture();
  const runtime = createRuntime({ sso: true, serviceBindings: { AUTH: central.fetch }, ...options });
  t.after(() => runtime.dispose());
  await migrate(runtime);
  const db = await runtime.getD1Database('DB');
  await db.prepare("INSERT INTO users(id,oura_user_id) VALUES ('test-user','test-user')").run();
  return {
    runtime, db, central,
    request: (path, cookie = '', init = {}) => runtime.dispatchFetch(`${origin}${path}`, {
      redirect: 'manual', ...init, headers: { Cookie: cookie, ...init.headers },
    }),
  };
}

test('0010 contains the identical shared schema without rewriting legacy data', async () => {
  const shared = await readFile(new URL('../../../../../../packages/shared/auth/schema.sql', import.meta.url), 'utf8');
  const migration = await readFile(new URL('../../../../migrations/0010_shared_sso.sql', import.meta.url), 'utf8');
  assert.ok(migration.startsWith(shared));
  assert.doesNotMatch(migration, /DROP TABLE|DELETE FROM|UPDATE users/);
});

test('SSO owner starts disconnected; sso never uses DEV fixtures and all private routes accept sso', async t => {
  const f = await fixture(t, { bindings: { ALLOW_DEV_LOGIN: '1' } });
  const cookie = await loginSso(f.runtime);
  const me = await (await f.request('/api/me', cookie)).json();
  assert.equal(me.source, 'sso');
  assert.equal(me.userId, 'test-user');
  assert.deepEqual(me.websiteAccount, { userId: 'test-user', source: 'sso' });
  assert.equal(me.ouraConnection.status, 'disconnected');
  assert.equal(me.ouraConnection.hasCachedHistory, false);
  assert.equal(me.allowDevLogin, false);
  assert.equal(me.ssoEnabled, true);
  const daily = await f.request('/api/me/daily', cookie);
  assert.equal(daily.status, 401);
  assert.deepEqual((await daily.json()).error, 'reconnect_required');
  assert.equal((await f.request('/api/auth/dev/session')).status, 403);
  assert.equal((await f.request('/api/me/health-records/status', cookie)).status, 200);
  assert.equal((await f.request('/api/me/connections', cookie)).status, 200);
  const callback = await connectOura(f.runtime, cookie);
  assert.equal(callback.status, 302);
  assert.ok(!callback.headers.getSetCookie().some(c => /oura_session=/.test(c)), 'provider must not mint website session');
  assert.equal((await (await f.request('/api/me', cookie)).json()).ouraConnection.status, 'connected');
  const data = await (await f.request('/api/me/daily', cookie)).json();
  assert.equal(data.source, 'oura');
  assert.ok(data.days.length);
  for (const path of ['/api/me/insights/weekly', '/api/me/insights/compare?mode=week',
    '/api/me/ai?days=7', '/api/me/health-records?collection=sleep']) {
    assert.equal((await f.request(path, cookie)).status, 200, path);
  }
  const row = await f.db.prepare('SELECT expires_at,created_at,central_ref FROM kdp_sso_sessions').first();
  assert.ok(row.expires_at - row.created_at <= 30 * 86400000);
  assert.ok(!row.central_ref.includes('ref-'), 'central refs are encrypted at rest');
});

test('SSO rejects legacy cookies and unbound provider callbacks while flag off retains legacy login', async t => {
  const legacy = createRuntime();
  t.after(() => legacy.dispose());
  await migrate(legacy);
  const legacyCookie = await login(legacy);
  assert.equal((await (await legacy.dispatchFetch(`${origin}/api/me`, { headers: { Cookie: legacyCookie } })).json()).source, 'oauth');
  const f = await fixture(t);
  assert.equal((await (await f.request('/api/me', legacyCookie)).json()).authenticated, false);
  assert.equal((await f.request('/api/me/daily', legacyCookie)).status, 401);
  assert.equal((await f.request('/api/auth/oura/start')).status, 401);
  assert.equal((await f.request('/api/auth/oura/callback?code=code&state=state')).status, 401);
  // A row in the same database still cannot turn a legacy website cookie into SSO.
  await f.db.prepare("INSERT INTO sessions(id,user_id,kind,expires_at) VALUES ('legacy','test-user','oauth','2099-01-01')").run();
  assert.equal((await (await f.request('/api/me', legacyCookie)).json()).authenticated, false);
});

test('central failure returns 503, revocation returns logged out, logout is same-origin POST', async t => {
  const f = await fixture(t);
  const cookie = await loginSso(f.runtime);
  f.central.state.unavailable = true;
  const unavailable = await f.request('/api/me', cookie);
  assert.equal(unavailable.status, 503);
  assert.equal((await unavailable.json()).error, 'auth_unavailable');
  assert.equal(unavailable.headers.get('Cache-Control'), 'no-store');
  assert.equal((await f.request('/api/auth/oura/start', cookie)).status, 503);
  f.central.state.unavailable = false;
  assert.equal((await f.request('/api/auth/logout', cookie)).status, 405);
  assert.equal((await f.request('/api/auth/logout', cookie, { method: 'POST' })).status, 403);
  assert.equal((await f.request('/api/auth/logout', cookie, { method: 'POST', headers: { Origin: origin } })).status, 200);
  assert.equal((await (await f.request('/api/me', cookie)).json()).authenticated, false);
  assert.equal((await f.db.prepare('SELECT COUNT(*) AS n FROM kdp_sso_sessions').first()).n, 0);
});

test('provider state is tied to the exact initiating session; rejects different session, expired session and replay', async t => {
  const f = await fixture(t);
  const a = await loginSso(f.runtime);
  const b = await loginSso(f.runtime);
  async function start(cookie) {
    const res = await f.request('/api/auth/oura/start', cookie);
    return {
      state: new URL(res.headers.get('Location')).searchParams.get('state'),
      stateCookie: res.headers.get('Set-Cookie').split(';')[0],
    };
  }
  async function callback(tx, cookie) {
    return f.request(`/api/auth/oura/callback?code=code&state=${tx.state}`, `${cookie}; ${tx.stateCookie}`);
  }
  const tx = await start(a);
  assert.match((await callback(tx, b)).headers.get('Location'), /invalid_state/);
  assert.match((await callback(tx, a)).headers.get('Location'), /invalid_state/);
  assert.equal((await f.db.prepare('SELECT COUNT(*) AS n FROM encrypted_tokens').first()).n, 0);
  const tx2 = await start(a);
  // Revoking A cannot be bypassed with its valid provider CSRF cookie.
  [...f.central.refs.values()][0].active = false;
  assert.equal((await callback(tx2, a)).status, 401);
  const tx3 = await start(b);
  assert.match((await callback(tx3, b)).headers.get('Location'), /login=ok/);
  assert.match((await callback(tx3, b)).headers.get('Location'), /invalid_state/);
});

test('provider callback cannot recreate an owner removed after SSO login', async t => {
  const f = await fixture(t);
  const cookie = await loginSso(f.runtime);
  await f.db.prepare("DELETE FROM users WHERE id='test-user'").run();
  const callback = await connectOura(f.runtime, cookie);
  assert.match(callback.headers.get('Location'), /auth_error=unavailable/);
  assert.equal((await f.db.prepare('SELECT COUNT(*) AS n FROM users').first()).n, 0);
  assert.equal((await f.db.prepare('SELECT COUNT(*) AS n FROM encrypted_tokens').first()).n, 0);
});

test('MCP consent uses SSO without connecting Oura; grants work after website logout and a central outage', async t => {
  const f = await fixture(t);
  const redirectUri = 'http://127.0.0.1:9999/callback';
  const registered = await f.request('/oauth/register', '', { method: 'POST',
    body: JSON.stringify({ client_name: 'SSO MCP app', redirect_uris: [redirectUri] }),
  });
  assert.equal(registered.status, 201);
  const client = await registered.json();
  const verifier = Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString('base64url');
  const challenge = Buffer.from(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))).toString('base64url');
  const back = `/oauth/authorize?${new URLSearchParams({
    client_id: client.client_id, redirect_uri: redirectUri, response_type: 'code',
    code_challenge: challenge, code_challenge_method: 'S256', state: 'mcp-state',
  })}`;
  const anonymous = await f.request(back);
  const loginUrl = new URL(anonymous.headers.get('Location'));
  assert.equal(loginUrl.pathname, '/api/auth/login');
  assert.equal(loginUrl.searchParams.get('return'), back);
  const cookie = await loginSso(f.runtime, origin, back);
  const consent = await f.request(back, cookie);
  assert.equal(consent.status, 200);
  const html = await consent.text();
  const approval = await f.request('/oauth/authorize', cookie, { method: 'POST',
    headers: { Origin: origin },
    body: new URLSearchParams({
      client_id: client.client_id, decision: 'approve', state: 'mcp-state',
      consent_id: html.match(/name="consent_id" value="([^"]+)"/)[1],
      csrf_token: html.match(/name="csrf_token" value="([^"]+)"/)[1],
    }),
  });
  assert.equal(approval.status, 302);
  const callback = new URL(approval.headers.get('Location'));
  assert.equal(callback.origin + callback.pathname, redirectUri);
  assert.equal(callback.searchParams.get('state'), 'mcp-state');
  const exchange = await f.request('/oauth/token', '', { method: 'POST',
    body: new URLSearchParams({
      grant_type: 'authorization_code', code: callback.searchParams.get('code'),
      client_id: client.client_id, redirect_uri: redirectUri, code_verifier: verifier,
    }),
  });
  assert.equal(exchange.status, 200);
  const tokens = await exchange.json();
  assert.equal((await (await f.request('/api/me', cookie)).json()).ouraConnection.status, 'disconnected');
  assert.equal((await f.db.prepare('SELECT COUNT(*) AS n FROM encrypted_tokens').first()).n, 0);
  assert.equal((await f.request('/api/auth/logout', cookie, { method: 'POST', headers: { Origin: origin } })).status, 200);
  f.central.state.unavailable = true;
  const mcp = await f.request('/mcp', '', { method: 'POST',
    headers: { Authorization: `Bearer ${tokens.access_token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
  });
  assert.equal(mcp.status, 200);
  const refreshed = await f.request('/oauth/token', '', { method: 'POST',
    body: new URLSearchParams({ grant_type: 'refresh_token', client_id: client.client_id, refresh_token: tokens.refresh_token }),
  });
  assert.equal(refreshed.status, 200);
});

test('provider cannot replace owner identity or tokens; archives and MCP grants survive SSO migration and reconnect', async t => {
  let providerId = 'test-user';
  const f = await fixture(t, { providerResponse: url => url.pathname.endsWith('/personal_info')
    ? Response.json({ id: providerId, email: 'provider@example.invalid' }) : undefined });
  const cookie = await loginSso(f.runtime);
  assert.equal((await connectOura(f.runtime, cookie)).status, 302);
  await f.db.prepare("INSERT INTO oauth_clients(client_id,client_name,redirect_uris) VALUES ('existing-client','Existing MCP app','[]')").run();
  const rawToken = 'existing-mcp-access';
  const rawRefresh = 'existing-mcp-refresh';
  for (const [kind, raw] of [['access', rawToken], ['refresh', rawRefresh]]) {
    const tokenHash = Buffer.from(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(raw))).toString('base64url');
    await f.db.prepare(`INSERT INTO mcp_tokens(token_hash,user_id,client_id,kind,expires_at,family_id)
      VALUES (?,'test-user','existing-client',?,?,'existing-family')`).bind(tokenHash, kind, Date.now() + 3600000).run();
  }
  await f.request('/api/me/daily', cookie);
  const before = await f.db.prepare('SELECT ciphertext,iv FROM encrypted_tokens').first();
  const count = await f.db.prepare('SELECT COUNT(*) AS n FROM daily_cache').first();
  providerId = 'another-oura-account';
  assert.match((await connectOura(f.runtime, cookie)).headers.get('Location'), /oura_account_mismatch/);
  assert.deepEqual(await f.db.prepare('SELECT ciphertext,iv FROM encrypted_tokens').first(), before);
  assert.deepEqual(await f.db.prepare('SELECT COUNT(*) AS n FROM daily_cache').first(), count);
  assert.equal((await f.db.prepare('SELECT oura_user_id FROM users').first()).oura_user_id, 'test-user');
  const next = await loginSso(f.runtime);
  assert.equal((await (await f.request('/api/me', next)).json()).ouraConnection.hasCachedHistory, true);
  // Existing AAD-bound tokens can still be decrypted and used by the mapped owner.
  assert.equal((await f.request(`/api/me/health-records?collection=sleep&from=${today}&to=${today}`, next, { method: 'POST' })).status, 200);
  providerId = 'test-user';
  const returnTo = '/oauth/authorize?client_id=example&state=mcp-state';
  assert.equal((await connectOura(f.runtime, next, origin, returnTo)).headers.get('Location'), returnTo);
  assert.equal((await (await f.request('/api/me', next)).json()).authenticated, true);
  assert.equal((await (await f.request('/api/me/connections', next)).json()).connections[0].client_id, 'existing-client');
  await f.request('/api/auth/logout', next, { method: 'POST', headers: { Origin: origin } });
  const mcp = await f.request('/mcp', '', { method: 'POST',
    headers: { Authorization: `Bearer ${rawToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
  });
  assert.equal(mcp.status, 200, 'website logout must preserve independently granted MCP credentials');
  const refresh = await f.request('/oauth/token', '', { method: 'POST',
    body: new URLSearchParams({ grant_type: 'refresh_token', client_id: 'existing-client', refresh_token: rawRefresh }),
  });
  assert.equal(refresh.status, 200, 'MCP refresh must remain independent of website login');
});

test('SSO transaction preserves MCP return URL and enforces state, single use, subject and owner config', async t => {
  const f = await fixture(t);
  const back = '/oauth/authorize?client_id=mcp-client&state=consent-state';
  const start = await f.request(`/api/auth/login?return=${encodeURIComponent(back)}`);
  const state = new URL(start.headers.get('Location')).searchParams.get('state');
  const cookie = start.headers.get('Set-Cookie').split(';')[0];
  const path = `/api/auth/callback?code=one-code&state=${state}`;
  assert.match((await f.request(path, '')).headers.get('Location'), /auth_error=retry/);
  const callback = await f.request(path, cookie);
  assert.equal(callback.status, 303);
  assert.equal(callback.headers.get('Location'), back);
  assert.match((await f.request(path, cookie)).headers.get('Location'), /auth_error=retry/);
  const outageStart = await f.request('/api/auth/login');
  const outageState = new URL(outageStart.headers.get('Location')).searchParams.get('state');
  f.central.state.unavailable = true;
  const outage = await f.request(`/api/auth/callback?code=outage&state=${outageState}`,
    outageStart.headers.get('Set-Cookie').split(';')[0]);
  assert.equal(outage.status, 302);
  assert.match(outage.headers.get('Location'), /auth_error=unavailable/);
  assert.equal(outage.headers.get('Cache-Control'), 'no-store');
  assert.equal(await outage.text(), '');
  f.central.state.unavailable = false;
  const noOwner = await fixture(t, { bindings: { PERSONAL_OWNER_ID: '' } });
  assert.equal((await noOwner.request('/api/me')).status, 503);
  const wrongOwner = await fixture(t, { bindings: { PERSONAL_OWNER_ID: 'wrong-owner' } });
  const invalidStart = await wrongOwner.request('/api/auth/login');
  const wrongState = new URL(invalidStart.headers.get('Location')).searchParams.get('state');
  const ownerError = await wrongOwner.request(`/api/auth/callback?code=owner&state=${wrongState}`,
    invalidStart.headers.get('Set-Cookie').split(';')[0]);
  assert.equal(ownerError.status, 302);
  assert.match(ownerError.headers.get('Location'), /auth_error=unavailable/);
  assert.equal((await wrongOwner.db.prepare('SELECT COUNT(*) AS n FROM users').first()).n, 1);
  assert.equal((await wrongOwner.db.prepare('SELECT COUNT(*) AS n FROM kdp_sso_sessions').first()).n, 0);
  f.central.state.subject = 'someone-else';
  await assert.rejects(loginSso(f.runtime), /SSO callback: HTTP 302/);
});
