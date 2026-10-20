import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fixture, authOrigin } from './runtime.mjs';

for (const id of ['project', 'me']) {
  test(`${id} is opt-in, exact-callback bound, and supports the existing SSO code exchange`, async t => {
    const key = `SSO_CLIENT_SECRET_${id.toUpperCase()}`;
    const secret = 'synthetic-new-client-' + 'x'.repeat(32);
    const verifier = 'v'.repeat(43);
    const challenge = Buffer.from(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))).toString('base64url');
    const params = new URLSearchParams({ client_id: id, redirect_uri: `https://${id}.codepi.app/api/auth/callback`,
      state: 's'.repeat(43), code_challenge: challenge, code_challenge_method: 'S256' });
    const disabled = await fixture(t);
    assert.equal((await disabled.auth.fetch(authOrigin + '/authorize?' + params)).status, 400);
    assert.equal((await disabled.internal(id, 'session', { session_ref: '0'.repeat(43) }, secret)).status, 401);
    const enabled = await fixture(t, { [key]: secret });
    const readiness = await enabled.internal(id, 'session', { session_ref: '0'.repeat(43) }, secret);
    assert.equal(readiness.status, 200);
    assert.deepEqual(await readiness.json(), { active: false });
    assert.equal((await enabled.internal(id, 'session', { session_ref: '0'.repeat(43) }, 'wrong-secret')).status, 401);
    const owner = await enabled.otpLogin('gu');
    const response = await enabled.auth.fetch(authOrigin + '/authorize?' + params, {
      headers: { Cookie: owner.centralCookie }, redirect: 'manual',
    });
    assert.equal(response.status, 302);
    const code = new URL(response.headers.get('Location')).searchParams.get('code');
    const exchange = await enabled.internal(id, 'exchange', {
      code, code_verifier: verifier, redirect_uri: params.get('redirect_uri'),
    }, secret);
    assert.equal(exchange.status, 200);
    assert.equal((await exchange.json()).subject, 'kdp-owner');
    params.set('redirect_uri', 'https://unregistered.example/api/auth/callback');
    assert.equal((await enabled.auth.fetch(authOrigin + '/authorize?' + params)).status, 400);
    for (const invalid of ['', 'short']) {
      const broken = await fixture(t, { [key]: invalid });
      assert.equal((await broken.auth.fetch(authOrigin + '/api/health')).status, 503);
    }
  });
}

test('planned callbacks do not activate clients or break existing login before secrets are paired', async t => {
  const callbacks = Object.fromEntries(['project', 'me'].map(id => [id, [`https://${id}.codepi.app/api/auth/callback`]]));
  const f = await fixture(t, { SSO_EXTRA_REDIRECT_URIS: JSON.stringify(callbacks) });
  assert.equal((await f.auth.fetch(authOrigin + '/api/health')).status, 200);
  assert.ok((await f.otpLogin('gu')).centralCookie);
  const wrong = await fixture(t, { SSO_EXTRA_REDIRECT_URIS: JSON.stringify({
    ...callbacks, project: ['https://unregistered.example/api/auth/callback'],
  }) });
  assert.equal((await wrong.auth.fetch(authOrigin + '/api/health')).status, 503);
});
