import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';

export async function checkPages(app, target, request = fetch) {
  assert.ok(['web', 'gu', 'gzh'].includes(app), 'Unknown Pages app');
  assert.ok(['production', 'staging'].includes(target), 'Unknown environment');
  const staging = target === 'staging';
  const host = app === 'web' ? (staging ? 'staging' : '') : `${app}${staging ? '-staging' : ''}`;
  const origin = `https://${host ? host + '.' : ''}codepi.app`;
  const authOrigin = `https://auth${staging ? '-staging' : ''}.codepi.app`;
  const get = path => request(origin + path, { redirect: 'manual', signal: AbortSignal.timeout(15000) });
  const root = await get('/');
  await root.body?.cancel();
  assert.equal(root.status, app === 'web' ? 200 : 302, `${app} root status`);
  const me = await get(app === 'web' ? '/api/desk/me' : '/api/me');
  assert.equal(me.status, 401, `${app} private endpoint must reject anonymous access, not return 503 or HTML`);
  assert.match(me.headers.get('content-type') || '', /^application\/json\b/);
  const payload = await me.json();
  assert.ok(payload && typeof payload === 'object' && !Array.isArray(payload));
  assert.notEqual(payload.authenticated, true);
  const login = await get('/api/auth/login');
  await login.body?.cancel();
  assert.equal(login.status, 302, `${app} login status`);
  const location = new URL(login.headers.get('location') || '/', origin);
  // Do not print the authorization URL, PKCE challenge, state or cookies.
  assert.ok(location.origin === authOrigin && location.pathname === '/authorize', 'Login must reach same-environment Auth');
  assert.ok(location.searchParams.get('client_id') === (app === 'web' ? 'desk' : app), 'Incorrect SSO client');
  assert.ok(location.searchParams.get('redirect_uri') === `${origin}/api/auth/callback`, 'Incorrect callback');
  assert.ok(location.searchParams.get('code_challenge_method') === 'S256'
    && location.searchParams.get('code_challenge') && location.searchParams.get('state'), 'Missing PKCE transaction');
  return `${app} ${target}: root, anonymous private API and same-environment SSO redirect passed`;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try { console.log(await checkPages(process.argv[2], process.argv[3])); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
