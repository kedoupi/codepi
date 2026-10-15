import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fixture, cookie, authOrigin, clients } from './runtime.mjs';

test('real service bindings: one OTP signs into three sites; one logout revokes all, but not another browser', async t => {
  const f = await fixture(t);
  const oura = await f.otpLogin();
  assert.equal(oura.finished.status, 303);
  assert.equal(oura.finished.headers.get('Location'), '/private');
  const logged = [oura];
  for (const id of ['gu', 'fagao']) {
    const tx = await f.begin(id, oura.centralCookie);
    assert.equal(tx.response.status, 302, 'existing center session bypasses OTP');
    const done = await tx.app.fetch(tx.response.headers.get('Location'), { headers: { Cookie: tx.appCookie }, redirect: 'manual' });
    assert.equal(done.status, 303);
    logged.push({ ...tx, localCookie: cookie(done, '_session') });
  }
  assert.equal((await f.db.prepare('SELECT COUNT(*) n FROM auth_otp_sends').first()).n, 1);
  for (const item of logged) assert.equal((await item.app.fetch(item.origin + '/api/me', { headers: { Cookie: item.localCookie } })).status, 200);
  await f.db.prepare('DELETE FROM auth_otp_sends').run();
  const other = await f.otpLogin('gu');
  const out = await logged[1].app.fetch(logged[1].origin + '/api/auth/logout', {
    method: 'POST', headers: { Cookie: logged[1].localCookie, Origin: logged[1].origin },
  });
  assert.equal(out.status, 200);
  for (const item of logged) assert.equal((await item.app.fetch(item.origin + '/api/me', { headers: { Cookie: item.localCookie } })).status, 401);
  assert.equal((await other.app.fetch(other.origin + '/api/me', { headers: { Cookie: other.localCookie } })).status, 200);
  assert.equal((await f.begin('oura', oura.centralCookie)).response.status, 200, 'revoked center cookie requires OTP again');
});

test('OTP has a fixed recipient, production responses never expose the code, and HTML masks email', async t => {
  const f = await fixture(t, { RESEND_API_KEY: 'test-key' });
  const tx = await f.begin();
  const html = await tx.response.text();
  assert.ok(!html.includes('owner@example.test'));
  assert.match(html, /o\*\*\*@example.test/);
  assert.match(tx.response.headers.get('Content-Security-Policy'), /nonce-/);
  const res = await f.call('/api/auth/request-otp', tx.txCookie, { email: 'attacker@example.test' });
  assert.deepEqual(await res.json(), { ok: true });
  assert.deepEqual(f.sent[0].to, ['owner@example.test']);
  assert.equal(f.sent.length, 1);
  assert.equal(f.sent[0].from, 'kedoupi（codepi） <login@example.test>');
  assert.equal(f.sent[0].subject, 'kedoupi（codepi） 登录验证码');
  const code = f.sent[0].text.match(/验证码是 (\d{6})/)?.[1];
  assert.ok(code);
  assert.ok(f.sent[0].html.includes(code));
  assert.ok(f.sent[0].html.includes('统一登录'));
  assert.ok(!f.sent[0].html.includes('owner@example.test'));
});

test('browser binding, same-origin POST and strict redirect registration are required', async t => {
  const f = await fixture(t);
  const tx = await f.begin();
  assert.equal((await f.call('/api/auth/request-otp', '', {})).status, 400);
  const cross = await f.auth.fetch(authOrigin + '/api/auth/request-otp', {
    method: 'POST', headers: { Cookie: tx.txCookie, Origin: 'https://evil.test', 'Content-Type': 'application/json' }, body: '{}',
  });
  assert.equal(cross.status, 403);
  const invalid = new URL('/authorize', authOrigin);
  invalid.search = new URLSearchParams({ client_id: 'oura', redirect_uri: 'https://evil.test/api/auth/callback',
    state: 's'.repeat(43), code_challenge: 'a'.repeat(43), code_challenge_method: 'S256' });
  const res = await f.auth.fetch(invalid);
  assert.equal(res.status, 400);
  assert.equal(res.headers.get('Location'), null);
});

test('explicit extra callback registrations accept the GU domain and reject other origins', async t => {
  const f = await fixture(t, { SSO_EXTRA_REDIRECT_URIS: JSON.stringify({ gu: ['https://gu.kdp.cool/api/auth/callback'] }) });
  for (const [uri, expected] of [
    ['https://gu.kdp.cool/api/auth/callback', 200],
    ['https://preview.kdp-gu.pages.dev/api/auth/callback', 400],
    ['https://gu.kdp.cool/api/auth/callback?next=evil', 400],
  ]) {
    const url = new URL('/authorize', authOrigin);
    url.search = new URLSearchParams({ client_id: 'gu', redirect_uri: uri,
      state: 's'.repeat(43), code_challenge: 'a'.repeat(43), code_challenge_method: 'S256' });
    assert.equal((await f.auth.fetch(url)).status, expected);
  }
});

test('invalid extra callback configuration fails closed', async t => {
  for (const extra of [
    { unknown: ['https://gu.kdp.cool/api/auth/callback'] },
    { gu: ['https://gu.kdp.cool/other'] },
    { gu: ['http://gu.kdp.cool/api/auth/callback'] },
    { gu: 'https://gu.kdp.cool/api/auth/callback' },
    [],
  ]) {
    const f = await fixture(t, { SSO_EXTRA_REDIRECT_URIS: JSON.stringify(extra) });
    assert.equal((await f.begin('gu')).response.status, 503);
  }
});

test('Health callback is explicitly registered while legacy Oura and other clients stay scoped', async t => {
  const f = await fixture(t, { SSO_EXTRA_REDIRECT_URIS: JSON.stringify({
    oura: ['https://health.kdp.cool/api/auth/callback'],
  }) });
  for (const [id, uri, expected] of [
    ['oura', 'https://health.kdp.cool/api/auth/callback', 200],
    ['oura', clients.oura.redirectUris[0], 200],
    ['gu', 'https://health.kdp.cool/api/auth/callback', 400],
    ['oura', 'https://health.kdp.cool.evil.test/api/auth/callback', 400],
    ['oura', 'https://health.kdp.cool/api/auth/callback?next=evil', 400],
  ]) {
    const url = new URL('/authorize', authOrigin);
    url.search = new URLSearchParams({ client_id: id, redirect_uri: uri,
      state: 's'.repeat(43), code_challenge: 'a'.repeat(43), code_challenge_method: 'S256' });
    assert.equal((await f.auth.fetch(url)).status, expected, uri);
  }
});

test('OTP is single-use under concurrent verification, wrong browser and expired code are refused', async t => {
  const f = await fixture(t);
  const tx = await f.begin();
  const data = await (await f.call('/api/auth/request-otp', tx.txCookie, {})).json();
  assert.equal((await f.call('/api/auth/verify-otp', '', { code: data.dev_otp })).status, 400);
  const responses = await Promise.all([1, 2].map(() => f.call('/api/auth/verify-otp', tx.txCookie, { code: data.dev_otp })));
  assert.equal(responses.filter(r => r.status === 200).length, 1);
  assert.equal((await f.db.prepare('SELECT COUNT(*) n FROM auth_sessions').first()).n, 1);
  await f.db.prepare('DELETE FROM auth_otp_sends').run();
  const next = await f.begin();
  const nextData = await (await f.call('/api/auth/request-otp', next.txCookie, {})).json();
  await f.db.prepare('UPDATE auth_transactions SET otp_expires_at=0').run();
  assert.equal((await f.call('/api/auth/verify-otp', next.txCookie, { code: nextData.dev_otp })).status, 400);
});

test('five failed OTP attempts lock the challenge, including concurrent requests', async t => {
  const f = await fixture(t);
  const tx = await f.begin();
  const { dev_otp: code } = await (await f.call('/api/auth/request-otp', tx.txCookie, {})).json();
  const wrong = code === '000000' ? '111111' : '000000';
  const results = await Promise.all(Array.from({ length: 8 }, () => f.call('/api/auth/verify-otp', tx.txCookie, { code: wrong })));
  assert.ok(results.every(r => r.status === 400));
  assert.equal((await f.db.prepare('SELECT attempts FROM auth_transactions').first()).attempts, 5);
  assert.equal((await f.call('/api/auth/verify-otp', tx.txCookie, { code })).status, 400);
});

test('OTP cooldown, rolling 15 minute limit and UTC daily budget cannot be bypassed by new transactions', async t => {
  const f = await fixture(t);
  const tx = await f.begin();
  const results = await Promise.all([1, 2].map(() => f.call('/api/auth/request-otp', tx.txCookie, {})));
  assert.equal(results.filter(r => r.status === 200).length, 1);
  assert.equal(results.filter(r => r.status === 429).length, 1);
  const now = Date.now();
  await f.db.prepare('DELETE FROM auth_otp_sends').run();
  for (let i = 0; i < 3; i++) await f.db.prepare('INSERT INTO auth_otp_sends VALUES (?,?)').bind('recent-' + i, now - 120000 - i).run();
  assert.equal((await f.call('/api/auth/request-otp', (await f.begin('gu')).txCookie, {})).status, 429);
  await f.db.prepare('DELETE FROM auth_otp_sends').run();
  const midnight = Math.floor(now / 86400000) * 86400000;
  for (let i = 0; i < 10; i++) await f.db.prepare('INSERT INTO auth_otp_sends VALUES (?,?)').bind('daily-' + i, midnight + i).run();
  assert.equal((await f.call('/api/auth/request-otp', tx.txCookie, {})).status, 429);
});

test('PKCE/client/code binding, expired codes, replay and cross-client references are enforced', async t => {
  const f = await fixture(t);
  const original = await f.otpLogin();
  const tx = await f.begin('gu', original.centralCookie);
  const url = new URL(tx.response.headers.get('Location')), code = url.searchParams.get('code');
  const guDb = await f.runtime.getD1Database('DB', 'gu');
  const { code_verifier: verifier } = await guDb.prepare('SELECT code_verifier FROM kdp_sso_transactions').first();
  const payload = { code, code_verifier: verifier, redirect_uri: clients.gu.redirectUris[0] };
  assert.equal((await f.internal('gu', 'exchange', payload, 'wrong')).status, 401);
  assert.equal((await f.internal('gu', 'exchange', { ...payload, code_verifier: 'x'.repeat(43) })).status, 400);
  assert.equal((await f.internal('oura', 'exchange', payload)).status, 400);
  const valid = await f.internal('gu', 'exchange', payload);
  assert.equal(valid.status, 200);
  const { session_ref } = await valid.json();
  assert.equal((await f.internal('gu', 'exchange', payload)).status, 400);
  assert.deepEqual(await (await f.internal('oura', 'session', { session_ref })).json(), { active: false });
  assert.equal((await f.internal('oura', 'logout', { session_ref })).status, 200);
  assert.equal((await (await f.internal('gu', 'session', { session_ref })).json()).active, true);
  const expiring = await f.begin('fagao', original.centralCookie);
  await f.db.prepare('UPDATE auth_codes SET expires_at=0').run();
  assert.equal((await expiring.app.fetch(expiring.response.headers.get('Location'), {
    headers: { Cookie: expiring.appCookie }, redirect: 'manual',
  })).status, 400);
});

test('missing production email configuration fails closed and debug OTP is never enabled by environment alone', async t => {
  const registry = Object.fromEntries(Object.entries(clients).map(([id, c]) => [id, { ...c, redirectUris: [`https://${id}.test/api/auth/callback`] }]));
  const f = await fixture(t, { AUTH_ORIGIN: 'https://auth.test', ENVIRONMENT: 'test', SSO_CLIENTS: JSON.stringify(registry) });
  // Miniflare's Node proxy rejects non-loopback Origin headers before the Worker.
  // Exercise the built handler directly with the same real D1 bindings here.
  const { default: handler } = await import('../dist/index.js');
  const env = await f.runtime.getBindings('auth');
  const url = new URL('/authorize', 'https://auth.test');
  url.search = new URLSearchParams({ client_id: 'oura', redirect_uri: registry.oura.redirectUris[0],
    state: 's'.repeat(43), code_challenge: 'a'.repeat(43), code_challenge_method: 'S256' });
  const start = await handler.fetch(new Request(url), env);
  const res = await handler.fetch(new Request('https://auth.test/api/auth/request-otp', {
    method: 'POST', headers: { Cookie: cookie(start, '_transaction'), Origin: 'https://auth.test', 'Content-Type': 'application/json' }, body: '{}',
  }), env);
  assert.equal(res.status, 503);
  assert.equal((await res.json()).dev_otp, undefined);
});
