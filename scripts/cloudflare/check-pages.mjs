import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';

export async function checkPages(app, target, request = fetch, { origin } = {}) {
  assert.ok(['web', 'gu', 'gzh'].includes(app), 'Unknown app');
  assert.ok(['production', 'staging'].includes(target), 'Unknown environment');
  const staging = target === 'staging';
  const host = app === 'web' ? (staging ? 'staging' : '') : `${app}${staging ? '-staging' : ''}`;
  // --origin 用于 Pages → Workers 迁移窗口：域名仍指向旧 Pages 时，
  // smoke 直接命中新 Worker 的 workers.dev 子域（从 Cloudflare API 查询）。
  origin ??= `https://${host ? host + '.' : ''}codepi.app`;
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
  if (app === 'web') {
    const desk = await get('/desk/');
    await desk.body?.cancel();
    assert.equal(desk.status, 200, 'Desk must serve its public page shell');
    assert.match(desk.headers.get('content-type') || '', /^text\/html\b/);
    assert.equal(desk.headers.get('cache-control'), 'no-store', 'Desk shell must not be cached');
    assert.match(desk.headers.get('x-robots-tag') || '', /\bnoindex\b/, 'Desk must stay out of search indexes');
  }
  if (app === 'gzh') {
    for (const path of ['/p/kdp-0917-zao/', '/previews/kdp-0917-zao/index.html']) {
      const preview = await get(path);
      await preview.body?.cancel();
      assert.equal(preview.status, 302, 'GZH private preview must require a session');
      const loginUrl = new URL(preview.headers.get('location') || '/', origin);
      assert.ok(loginUrl.origin === origin && loginUrl.pathname === '/login', 'GZH preview must redirect to its own login');
      assert.equal(preview.headers.get('cache-control'), 'no-store', 'GZH private preview must not be cached');
    }
    for (const path of ['/%70reviews/kdp-0917-zao/', '/previews%2fkdp-0917-zao/', '//previews/kdp-0917-zao/']) {
      const alias = await get(path);
      await alias.body?.cancel();
      assert.equal(alias.status, 404, 'GZH asset aliases must not bypass authentication');
      assert.equal(alias.headers.get('cache-control'), 'no-store', 'GZH rejected aliases must not be cached');
    }
  }
  return `${app} ${target}: root, anonymous private API and same-environment SSO redirect passed`;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2);
  const originFlag = args.includes('--origin') ? args[args.indexOf('--origin') + 1] : undefined;
  try { console.log(await checkPages(args[0], args[1], fetch, { origin: originFlag })); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
