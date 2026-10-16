import assert from 'node:assert/strict';
import { test } from 'node:test';
import { checkPages } from './check-pages.mjs';

function fixture(app, target, override = {}) {
  const requests = [];
  const auth = target === 'staging' ? 'auth-staging' : 'auth';
  const request = async (url, options) => {
    requests.push({ url, redirect: options.redirect });
    const { pathname, origin } = new URL(url);
    if (pathname === '/') return new Response('', { status: app === 'web' ? 200 : 302 });
    if (pathname.endsWith('/me')) return override.me?.() ?? Response.json({ authenticated: false }, { status: 401 });
    const location = new URL(`https://${auth}.codepi.app/authorize`);
    location.search = new URLSearchParams({
      client_id: app === 'web' ? 'desk' : app, redirect_uri: `${origin}/api/auth/callback`,
      code_challenge_method: 'S256', code_challenge: 'synthetic', state: 'synthetic',
    }).toString();
    override.location?.(location);
    return new Response(null, { status: 302, headers: { location: location.href } });
  };
  return { request, requests };
}

test('all Pages clients validate root, anonymous private API and environment-specific login', async () => {
  for (const app of ['web', 'gu', 'gzh']) for (const target of ['production', 'staging']) {
    const f = fixture(app, target);
    await checkPages(app, target, f.request);
    assert.equal(f.requests.length, 3);
    assert.ok(f.requests.every(r => r.redirect === 'manual'));
  }
});

test('public homepage 200 cannot hide broken Desk authentication or a private-data leak', async () => {
  for (const status of [200, 503]) {
    const f = fixture('web', 'production', { me: () => Response.json({ error: 'auth_not_configured' }, { status }) });
    await assert.rejects(checkPages('web', 'production', f.request), /private endpoint/);
  }
  const html = fixture('web', 'production', { me: () => new Response('<html>', { status: 401 }) });
  await assert.rejects(checkPages('web', 'production', html.request));
});

test('rejects wrong Auth environment, callback, client and missing PKCE without exposing URLs', async () => {
  for (const location of [
    url => { url.hostname = 'auth.codepi.app'; },
    url => { url.pathname = '/login'; },
    url => url.searchParams.set('client_id', 'desk'),
    url => url.searchParams.set('redirect_uri', 'https://gu.codepi.app/api/auth/callback'),
    url => url.searchParams.delete('state'),
    url => url.searchParams.delete('code_challenge'),
  ]) {
    const f = fixture('gu', 'staging', { location });
    await assert.rejects(checkPages('gu', 'staging', f.request), error => !error.message.includes('synthetic'));
  }
});
