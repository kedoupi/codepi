import test from 'node:test';
import assert from 'node:assert/strict';

// The monitor talks to live origins only in CI; unit coverage here pins the
// shape of the critical assertions (SSO redirect targets, leak-route closure)
// by exercising the module against stubbed fetch implementations.
import { runMonitor as runPlatformMonitor } from './production-monitor.mjs';
// Git/control-plane version scenarios are covered with real repositories in release-drift.test.mjs.
const runMonitor = options => runPlatformMonitor({ ...options, versionCheck: async () => [] });

const jsonResponse = (body, init = {}) =>
  new Response(JSON.stringify(body), {
    status: init.status ?? 200,
    headers: { 'content-type': 'application/json', ...init.headers },
  });

function stubFetch(handler) {
  return async (url, options = {}) => {
    const target = new URL(url);
    const res = await handler(target, options);
    if (!(res instanceof Response)) throw new Error(`no stub for ${target.origin}${target.pathname}`);
    return res;
  };
}

function happyHandler({ syncAgeHours = 1 } = {}) {
  return async target => {
    if (target.hostname === 'mcp.codepi.app') {
      if (target.pathname === '/api/health') return jsonResponse({ ok: true, service: 'codepi-mcp', build: 'a'.repeat(12) });
      if (target.pathname === '/.well-known/oauth-protected-resource/mcp') {
        return jsonResponse({ resource: target.origin + '/mcp', authorization_servers: [target.origin] });
      }
      if (target.pathname === '/.well-known/oauth-authorization-server') return jsonResponse({
        issuer: target.origin, authorization_endpoint: target.origin + '/oauth/authorize',
        token_endpoint: target.origin + '/oauth/token', code_challenge_methods_supported: ['S256'],
      });
      if (target.pathname === '/mcp') return jsonResponse({ error: 'unauthorized' }, {
        status: 401, headers: { 'www-authenticate': `Bearer resource_metadata="${target.origin}/.well-known/oauth-protected-resource/mcp"` },
      });
      if (target.pathname === '/connections') {
        return new Response(null, { status: 302, headers: { location: '/api/auth/login?return=%2Fconnections' } });
      }
    }
    if (target.origin === 'https://auth.codepi.app' && target.pathname === '/api/health') {
      return jsonResponse({ ok: true });
    }
    if (target.hostname === 'api.xiaotaozi.cc') {
      return new Response('Forbidden', { status: 403 });
    }
    if (target.hostname === 'api.cloudflare.com') {
      return jsonResponse({
        success: true,
        result: [{ success: true, results: [{ ts: new Date(Date.now() - syncAgeHours * 3600 * 1000).toISOString() }] }],
      });
    }
    const app = Object.entries({
      'codepi.app': 'desk', 'gu.codepi.app': 'gu', 'gzh.codepi.app': 'gzh', 'health.codepi.app': 'oura',
    }).find(([host]) => target.hostname === host)?.[1];
    if (!app) return undefined;
    if (target.pathname.endsWith('/me')) {
      // Health's anonymous /api/me is 200 with the logged-out contract; the
      // other apps hard-reject with 401. Both shapes must stay stable.
      const status = target.hostname === 'health.codepi.app' ? 200 : 401;
      return jsonResponse({ authenticated: false, userId: null }, { status });
    }
    if (target.pathname === '/api/auth/login') {
      const location = `https://auth.codepi.app/authorize?client_id=${app}&redirect_uri=${encodeURIComponent(target.origin + '/api/auth/callback')}`;
      return new Response(null, { status: 302, headers: { location } });
    }
    return undefined;
  };
}

test('monitor passes against a healthy platform', async () => {
  const realFetch = globalThis.fetch;
  const savedEnv = { ...process.env };
  try {
    process.env.CLOUDFLARE_ACCOUNT_ID = 'acct';
    process.env.CLOUDFLARE_API_TOKEN = 'token';
    globalThis.fetch = stubFetch(happyHandler());
    const results = await runMonitor();
    assert.ok(results.length >= 10, `expected all checks to run, got ${results.length}`);
    for (const r of results) assert.ok(r.ok, `${r.name} should pass: ${r.detail}`);
  } finally {
    globalThis.fetch = realFetch;
    process.env = savedEnv;
  }
});

test('monitor catches MCP credential mismatch, broken discovery and anonymous access', async t => {
  const savedEnv = { ...process.env };
  t.after(() => { process.env = savedEnv; });
  delete process.env.CLOUDFLARE_ACCOUNT_ID;
  delete process.env.CLOUDFLARE_API_TOKEN;
  const base = happyHandler();
  t.mock.method(globalThis, 'fetch', stubFetch(async target => {
    if (target.hostname === 'mcp.codepi.app') {
      if (target.pathname === '/api/health') return jsonResponse({ ok: false }, { status: 503 });
      if (target.pathname.startsWith('/.well-known/')) return jsonResponse({ issuer: 'https://wrong.invalid' });
      if (target.pathname === '/mcp') return jsonResponse({ result: { tools: [] } });
    }
    return base(target);
  }));
  const results = await runMonitor();
  for (const pattern of ['credential pair', 'protected-resource', 'authorization-server', 'anonymous tools']) {
    assert.equal(results.find(r => r.name.includes(pattern))?.ok, false, pattern);
  }
});

test('scheduled strict version requirements reach the drift checker and failures stay visible', async t => {
  const savedEnv = { ...process.env };
  t.after(() => { process.env = savedEnv; });
  delete process.env.CLOUDFLARE_ACCOUNT_ID;
  delete process.env.CLOUDFLARE_API_TOKEN;
  t.mock.method(globalThis, 'fetch', stubFetch(happyHandler()));
  const result = { name: 'codepi-mcp active BUILD_SHA matches main code', ok: false, detail: 'unreleased changes' };
  const results = await runPlatformMonitor({ requireVersions: true, versionCheck: async options => {
    assert.equal(options.requireVersions, true);
    return [result];
  } });
  assert.ok(results.includes(result));
});

test('monitor flags a re-opened legacy leak route', async () => {
  const realFetch = globalThis.fetch;
  const savedEnv = { ...process.env };
  try {
    delete process.env.CLOUDFLARE_ACCOUNT_ID;
    delete process.env.CLOUDFLARE_API_TOKEN;
    globalThis.fetch = stubFetch(async target =>
      target.hostname === 'api.xiaotaozi.cc' ? jsonResponse({ ok: true, days: [] }) : happyHandler()(target));
    const results = await runMonitor();
    const leak = results.find(r => r.name.includes('legacy'));
    assert.ok(leak && !leak.ok, 'a 200 on the legacy route must fail');
    assert.match(leak.detail, /200/);
  } finally {
    globalThis.fetch = realFetch;
    process.env = savedEnv;
  }
});

test('monitor flags a stale health auto-sync', async () => {
  const realFetch = globalThis.fetch;
  const savedEnv = { ...process.env };
  try {
    process.env.CLOUDFLARE_ACCOUNT_ID = 'acct';
    process.env.CLOUDFLARE_API_TOKEN = 'token';
    globalThis.fetch = stubFetch(happyHandler({ syncAgeHours: 72 }));
    const results = await runMonitor();
    const sync = results.find(r => r.name.includes('auto-sync'));
    assert.ok(sync && !sync.ok, 'a 72h-old sync must fail');
    assert.match(sync.detail, /72h ago/);
  } finally {
    globalThis.fetch = realFetch;
    process.env = savedEnv;
  }
});

test('monitor flags SSO redirects that leave the platform', async () => {
  const realFetch = globalThis.fetch;
  const savedEnv = { ...process.env };
  try {
    delete process.env.CLOUDFLARE_ACCOUNT_ID;
    delete process.env.CLOUDFLARE_API_TOKEN;
    const base = happyHandler();
    globalThis.fetch = stubFetch(async target => {
      if (target.hostname === 'gu.codepi.app' && target.pathname === '/api/auth/login') {
        return new Response(null, { status: 302, headers: { location: 'https://evil.example/authorize?client_id=gu' } });
      }
      return base(target);
    });
    const results = await runMonitor();
    const sso = results.find(r => r.name === 'gu login redirects to same-environment SSO');
    assert.ok(sso && !sso.ok, 'a foreign SSO origin must fail');
    assert.match(sso.detail, /auth\.codepi\.app/);
  } finally {
    globalThis.fetch = realFetch;
    process.env = savedEnv;
  }
});

test('monitor skips the D1 check cleanly without credentials', async () => {
  const realFetch = globalThis.fetch;
  const savedEnv = { ...process.env };
  try {
    delete process.env.CLOUDFLARE_ACCOUNT_ID;
    delete process.env.CLOUDFLARE_API_TOKEN;
    globalThis.fetch = stubFetch(happyHandler());
    const results = await runMonitor();
    const sync = results.find(r => r.name.includes('auto-sync'));
    assert.ok(sync?.ok && sync.skipped, 'missing credentials must skip, not fail');
    const strict = (await runMonitor({ requireD1: true })).find(r => r.name.includes('auto-sync'));
    assert.equal(strict.ok, false, 'scheduled monitoring must fail when credentials are missing');
    assert.equal(strict.skipped, undefined);
  } finally {
    globalThis.fetch = realFetch;
    process.env = savedEnv;
  }
});

test('D1 failures retain only HTTP status and error codes', async t => {
  const savedEnv = { ...process.env };
  t.after(() => { process.env = savedEnv; });
  process.env.CLOUDFLARE_ACCOUNT_ID = 'acct';
  process.env.CLOUDFLARE_API_TOKEN = 'synthetic-token';
  const base = happyHandler();
  t.mock.method(globalThis, 'fetch', stubFetch(async target => target.hostname === 'api.cloudflare.com'
    ? Response.json({ success: false, errors: [{ code: 7500, message: 'PRIVATE SQL AND TOKENS' }] }, { status: 403 })
    : base(target)));
  const sync = (await runMonitor({ requireD1: true })).find(r => r.name.includes('auto-sync'));
  assert.equal(sync.ok, false);
  assert.match(sync.detail, /HTTP 403; codes=7500/);
  assert.doesNotMatch(sync.detail, /PRIVATE|synthetic-token/);
});
