import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import { beginLogin, finishLogin, readSsoSession, logoutSso, ssoEnabled } from './client.ts';

const require = createRequire(new URL('../../oura/workers/api/package.json', import.meta.url));
const wranglerRequire = createRequire(require.resolve('wrangler'));
const { Miniflare } = wranglerRequire('miniflare');
const origin = 'https://oura.example';
const request = (path, cookie = '', init = {}) => new Request(origin + path, {
  ...init, headers: { Cookie: cookie, ...init.headers },
});
const sessionCookie = response => response.headers.getSetCookie().find(v => v.includes('_session=')).split(';')[0];

async function fixture(t) {
  const runtime = new Miniflare({
    modules: true, script: 'export default { fetch() { return new Response("ok"); } }',
    d1Databases: ['DB'], compatibilityDate: '2025-01-01',
  });
  t.after(() => runtime.dispose());
  const db = await runtime.getD1Database('DB');
  const sql = await readFile(new URL('./schema.sql', import.meta.url), 'utf8');
  await db.batch(sql.split(';').filter(v => v.trim()).map(v => db.prepare(v)));
  const state = { active: true, unavailable: false, subject: 'kdp-owner', exchanges: 0, logout: 0 };
  const env = {
    DB: db, AUTH_ORIGIN: 'https://auth.example', AUTH_CLIENT_ID: 'oura', AUTH_CLIENT_SECRET: 'test-secret',
    AUTH: {
      async fetch(url, init) {
        if (state.unavailable) return new Response('', { status: 503 });
        assert.equal(init.headers.Authorization, `Basic ${btoa('oura:test-secret')}`);
        const body = JSON.parse(init.body);
        if (url.endsWith('/exchange')) {
          state.exchanges++;
          assert.equal(body.redirect_uri, origin + '/api/auth/callback');
          assert.match(body.code_verifier, /^[\w-]{43}$/);
          return Response.json({ subject: state.subject, session_ref: 'private-reference', expires_at: Date.now() + 30 * 86400000 });
        }
        assert.equal(body.session_ref, 'private-reference');
        if (url.endsWith('/session')) return Response.json({
          active: state.active, subject: state.subject, expires_at: Date.now() + 30 * 86400000,
        });
        if (url.endsWith('/logout')) {
          state.logout++; state.active = false;
          return Response.json({ ok: true });
        }
        throw new Error('Unexpected auth route');
      },
    },
  };
  return {
    env, db, state,
    async start(returnTo = '/sleep') {
      const response = await beginLogin(request('/api/auth/login?return=' + encodeURIComponent(returnTo)), env);
      const target = new URL(response.headers.get('location'));
      assert.equal(target.origin, 'https://auth.example');
      assert.equal(target.searchParams.get('code_challenge_method'), 'S256');
      const cookie = response.headers.get('set-cookie').split(';')[0];
      return { response, cookie, state: target.searchParams.get('state') };
    },
    finish(start, opts = {}) {
      return finishLogin(request(`/api/auth/callback?code=one-use-code&state=${start.state}`, start.cookie), env,
        { userId: 'existing-owner', ttlSeconds: 30 * 86400, ...opts });
    },
  };
}

test('PKCE transaction preserves destination and binds an encrypted local session to existing identity', async t => {
  const f = await fixture(t);
  const response = await f.finish(await f.start('/sleep?days=7'));
  assert.equal(response.status, 303);
  assert.equal(response.headers.get('location'), '/sleep?days=7');
  const cookie = sessionCookie(response);
  const session = await readSsoSession(request('/api/me', cookie), f.env);
  assert.equal(session.userId, 'existing-owner');
  assert.equal(session.subject, 'kdp-owner');
  const row = await f.db.prepare('SELECT * FROM kdp_sso_sessions').first();
  assert.notEqual(row.id, cookie.split('=')[1]);
  assert.ok(!row.central_ref.includes('private-reference'));
  assert.match(response.headers.get('set-cookie'), /HttpOnly; SameSite=Lax/);
  assert.match(response.headers.get('set-cookie'), /Secure/);
});

test('missing browser cookie, wrong state and concurrent callback replay cannot create extra sessions', async t => {
  const f = await fixture(t);
  const start = await f.start();
  await assert.rejects(f.finish({ ...start, cookie: '' }), { code: 'invalid_login' });
  await assert.rejects(f.finish({ ...start, state: 'wrong' }), { code: 'invalid_login' });
  const results = await Promise.allSettled([f.finish(start), f.finish(start)]);
  assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
  assert.equal(f.state.exchanges, 1);
  assert.equal((await f.db.prepare('SELECT COUNT(*) AS n FROM kdp_sso_sessions').first()).n, 1);
});

test('expired transaction and unexpected central identity are denied', async t => {
  const f = await fixture(t);
  const expired = await f.start();
  await f.db.prepare('UPDATE kdp_sso_transactions SET expires_at=0').run();
  await assert.rejects(f.finish(expired), { code: 'invalid_login' });
  const wrongIdentity = await f.start();
  f.state.subject = 'somebody-else';
  await assert.rejects(f.finish(wrongIdentity), { code: 'invalid_login' });
  assert.equal((await f.db.prepare('SELECT COUNT(*) AS n FROM kdp_sso_sessions').first()).n, 0);
});

test('return destinations cannot redirect to external hosts or start a login loop', async t => {
  const f = await fixture(t);
  for (const path of ['//evil.example', '/\\evil.example', 'https://evil.example', '/api/auth/login', '/api/auth/callback']) {
    const response = await f.finish(await f.start(path));
    assert.equal(response.headers.get('location'), '/');
  }
});

test('revocation differs from outages and local sessions cannot outlive their central parent', async t => {
  const f = await fixture(t);
  const cookie = sessionCookie(await f.finish(await f.start(), { ttlSeconds: 7 * 86400 }));
  const requestMe = request('/api/me', cookie);
  const session = await readSsoSession(requestMe, f.env);
  assert.ok(session.expiresAt <= Date.now() + 7 * 86400000);
  f.state.unavailable = true;
  await assert.rejects(readSsoSession(requestMe, f.env), { code: 'auth_unavailable', status: 503 });
  f.state.unavailable = false;
  assert.ok(await readSsoSession(requestMe, f.env));
  f.state.active = false;
  assert.equal(await readSsoSession(requestMe, f.env), null);
});

test('logout revokes the central session; cross-origin requests and failed revocation do not fake success', async t => {
  const f = await fixture(t);
  const cookie = sessionCookie(await f.finish(await f.start()));
  await assert.rejects(logoutSso(request('/api/auth/logout', cookie, {
    method: 'POST', headers: { Origin: 'https://other.example' },
  }), f.env), { code: 'origin_not_allowed' });
  const logout = request('/api/auth/logout', cookie, { method: 'POST', headers: { Origin: origin } });
  f.state.unavailable = true;
  await assert.rejects(logoutSso(logout, f.env), { code: 'auth_unavailable' });
  assert.equal(f.state.logout, 0);
  f.state.unavailable = false;
  const response = await logoutSso(logout, f.env);
  assert.equal(response.status, 200);
  assert.equal(f.state.logout, 1);
  assert.match(response.headers.get('set-cookie'), /Max-Age=0/);
  assert.equal(await readSsoSession(request('/api/me', cookie), f.env), null);
});

test('configuration and transport failures never create an insecure or fallback session', async t => {
  const f = await fixture(t);
  const diagnostics = t.mock.method(console, 'error', () => {});
  assert.equal(ssoEnabled({ ...f.env, SSO_ENABLED: '0' }), false);
  assert.equal(ssoEnabled({ ...f.env, SSO_ENABLED: '1' }), true);
  for (const override of [
    { AUTH: undefined }, { AUTH_CLIENT_ID: 'unknown' }, { AUTH_CLIENT_SECRET: '' },
    { AUTH_ORIGIN: 'http://auth.example' }, { AUTH_ORIGIN: 'https://auth.example/path' },
    { AUTH_ORIGIN: 'https://user:password@auth.example' },
  ]) {
    await assert.rejects(beginLogin(request('/api/auth/login'), { ...f.env, ...override }),
      { code: 'auth_not_configured', status: 503 });
  }
  assert.deepEqual(diagnostics.mock.calls.map(call => call.arguments), [
    ['sso_configuration_error', JSON.stringify({ missing: ['AUTH'] })],
    ['sso_configuration_error', JSON.stringify({ missing: ['AUTH_CLIENT_ID'] })],
    ['sso_configuration_error', JSON.stringify({ missing: ['AUTH_CLIENT_SECRET'] })],
  ]);
  await assert.rejects(beginLogin(new Request('http://oura.example/api/auth/login'), f.env),
    { code: 'https_required', status: 400 });
  await assert.rejects(beginLogin(request('/api/auth/login', '', { method: 'POST' }), f.env),
    { code: 'method_not_allowed', status: 405 });
  assert.equal((await f.db.prepare('SELECT COUNT(*) AS n FROM kdp_sso_sessions').first()).n, 0);
});

test('encrypted references cannot be moved to another local user or reused under a rotated secret', async t => {
  const f = await fixture(t);
  const cookie = sessionCookie(await f.finish(await f.start()));
  const me = request('/api/me', cookie);
  await assert.rejects(readSsoSession(me, { ...f.env, AUTH_CLIENT_SECRET: 'rotated-test-secret' }),
    { code: 'auth_unavailable', status: 503 });
  await f.db.prepare('UPDATE kdp_sso_sessions SET user_id=?').bind('other-owner').run();
  await assert.rejects(readSsoSession(me, f.env), { code: 'auth_unavailable', status: 503 });
});

test('duplicate cookies and expired local sessions are rejected without central requests', async t => {
  const f = await fixture(t);
  const cookie = sessionCookie(await f.finish(await f.start()));
  f.state.unavailable = true;
  assert.equal(await readSsoSession(request('/api/me', `${cookie}; ${cookie}`), f.env), null);
  await f.db.prepare('UPDATE kdp_sso_sessions SET expires_at=0').run();
  assert.equal(await readSsoSession(request('/api/me', cookie), f.env), null);
});

test('the logout-only cookie revokes central access after a seven-day app session expires', async t => {
  const f = await fixture(t);
  const response = await f.finish(await f.start(), { ttlSeconds: 7 * 86400 });
  const logoutCookie = response.headers.getSetCookie().find(v => v.includes('_logout=')).split(';')[0];
  assert.equal(await readSsoSession(request('/api/me', logoutCookie), f.env), null,
    'the logout handle must never authenticate a request, even before expiry');
  await f.db.prepare('UPDATE kdp_sso_sessions SET expires_at=?').bind(Date.now() - 1000).run();
  await f.start(); // Another browser's login cleanup must preserve the revocation handle.
  const logout = await logoutSso(request('/api/auth/logout', logoutCookie, {
    method: 'POST', headers: { Origin: origin },
  }), f.env);
  assert.equal(logout.status, 200);
  assert.equal(f.state.logout, 1);
  assert.equal(f.state.active, false);
  assert.ok(logout.headers.getSetCookie().some(v => v.includes('_logout=;') && v.includes('Max-Age=0')));
});
