// Scheduled production checks for the kdp platform. Read-only: every check is a
// plain HTTP request or a Cloudflare API read. No secrets are ever printed.
//
// Usage:
//   node scripts/cloudflare/production-monitor.mjs
// Environment (optional, enables the D1-based checks):
//   CLOUDFLARE_ACCOUNT_ID  Cloudflare account id
//   CLOUDFLARE_API_TOKEN   API token with D1 read permission
import assert from 'node:assert/strict';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const ORIGINS = {
  auth: 'https://auth.codepi.app',
  web: 'https://codepi.app',
  gu: 'https://gu.codepi.app',
  gzh: 'https://gzh.codepi.app',
  health: 'https://health.codepi.app',
};

// app → [private API path, expected SSO client_id]
// Note: Health keeps `oura` as its SSO client id (a protocol identifier per
// the health-naming contract), and its anonymous /api/me returns 200 with
// {authenticated:false} by design — the assertion pins that contract instead.
const PRIVATE_APPS = {
  web: { me: '/api/desk/me', client: 'desk', meStatus: 401 },
  gu: { me: '/api/me', client: 'gu', meStatus: 401 },
  gzh: { me: '/api/me', client: 'gzh', meStatus: 401 },
  health: { me: '/api/me', client: 'oura', meStatus: 200 },
};

// The retired CloudBase leak route. Must stay closed: any 2xx here is a breach.
const LEGACY_ROUTE = 'https://api.xiaotaozi.cc/oura/daily';

// D1 databases whose freshness we can verify remotely (read-only query).
const HEALTH_DB_ID = '2e35deaa-8066-49c1-b19a-afcd8706d58c';
const SYNC_STALE_HOURS = 30; // auto-sync runs daily; alert beyond this window

const request = (url, options = {}) =>
  fetch(url, { redirect: 'manual', signal: AbortSignal.timeout(20000), ...options });

async function checkAuthHealth(results) {
  const name = 'auth health endpoint';
  try {
    const res = await request(`${ORIGINS.auth}/api/health`);
    assert.equal(res.status, 200, `status ${res.status}`);
    const body = await res.json();
    assert.ok(body && typeof body === 'object' && body.ok === true, 'health payload must be {ok:true}');
    results.push({ name, ok: true });
  } catch (error) {
    results.push({ name, ok: false, detail: error.message });
  }
}

async function checkPrivateApp(app, results) {
  const { me: mePath, client: clientId, meStatus } = PRIVATE_APPS[app];
  const origin = ORIGINS[app];

  const meName = meStatus === 401
    ? `${app} anonymous private API is rejected`
    : `${app} anonymous private API returns the logged-out contract`;
  try {
    const me = await request(origin + mePath);
    assert.equal(me.status, meStatus, `status ${me.status}`);
    assert.match(me.headers.get('content-type') || '', /^application\/json\b/);
    const payload = await me.json();
    assert.notEqual(payload.authenticated, true, 'anonymous session must not authenticate');
    assert.ok(!payload.userId, 'anonymous session must not expose a user id');
    results.push({ name: meName, ok: true });
  } catch (error) {
    results.push({ name: meName, ok: false, detail: error.message });
  }

  const ssoName = `${app} login redirects to same-environment SSO`;
  try {
    const login = await request(`${origin}/api/auth/login`);
    await login.body?.cancel();
    assert.equal(login.status, 302, `status ${login.status}`);
    const location = new URL(login.headers.get('location') || '/', origin);
    assert.equal(location.origin, ORIGINS.auth, 'login must target auth.codepi.app');
    assert.equal(location.pathname, '/authorize');
    assert.equal(location.searchParams.get('client_id'), clientId);
    assert.equal(location.searchParams.get('redirect_uri'), `${origin}/api/auth/callback`);
    // Never print the authorization URL: it carries PKCE challenge and state.
    results.push({ name: ssoName, ok: true });
  } catch (error) {
    results.push({ name: ssoName, ok: false, detail: error.message });
  }
}

async function checkLegacyRouteClosed(results) {
  const name = 'legacy api.xiaotaozi.cc /oura/daily stays closed';
  try {
    // Cache-bust so a CDN hit cannot mask a re-opened origin.
    const res = await request(`${LEGACY_ROUTE}?user_id=kedoupi&_=${Date.now()}`);
    await res.body?.cancel();
    assert.ok(res.status === 401 || res.status === 403 || res.status === 404, `status ${res.status}`);
    results.push({ name, ok: true });
  } catch (error) {
    results.push({ name, ok: false, detail: error.message });
  }
}

async function d1Query(accountId, token, databaseId, sql) {
  const res = await request(
    `https://api.cloudflare.com/client/v4/accounts/${accountId}/d1/database/${databaseId}/query`,
    {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ sql }),
    },
  );
  const body = await res.json();
  assert.ok(res.ok && body.success === true && body.result?.[0]?.success === true,
    `D1 query failed: HTTP ${res.status}; codes=${(body.errors || []).map(e => e.code).join(',')}`);
  return body.result?.[0]?.results ?? [];
}

async function checkHealthSyncFreshness(results, requireD1) {
  const name = 'health auto-sync succeeded within 30 hours';
  const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;
  const token = process.env.CLOUDFLARE_API_TOKEN;
  if (!accountId || !token) {
    results.push(requireD1
      ? { name, ok: false, detail: 'CLOUDFLARE_ACCOUNT_ID/CLOUDFLARE_API_TOKEN are required' }
      : { name, ok: true, skipped: 'no CLOUDFLARE_ACCOUNT_ID/CLOUDFLARE_API_TOKEN' });
    return;
  }
  try {
    const rows = await d1Query(
      accountId, token, HEALTH_DB_ID,
      'SELECT last_success_at AS ts FROM auto_sync_state ORDER BY last_success_at DESC LIMIT 1',
    );
    assert.ok(rows.length > 0 && rows[0].ts, 'no auto-sync success recorded');
    const ageMs = Date.now() - new Date(rows[0].ts).getTime();
    assert.ok(Number.isFinite(ageMs), `unparseable last_success_at ${JSON.stringify(rows[0].ts)}`);
    assert.ok(ageMs < SYNC_STALE_HOURS * 3600 * 1000, `last success ${Math.round(ageMs / 3600000)}h ago exceeds ${SYNC_STALE_HOURS}h`);
    results.push({ name, ok: true });
  } catch (error) {
    results.push({ name, ok: false, detail: error.message });
  }
}

export async function runMonitor({ requireD1 = false } = {}) {
  const results = [];
  await checkAuthHealth(results);
  for (const app of Object.keys(PRIVATE_APPS)) await checkPrivateApp(app, results);
  await checkLegacyRouteClosed(results);
  await checkHealthSyncFreshness(results, requireD1);
  return results;
}

function report(results) {
  let failed = 0;
  for (const { name, ok, detail, skipped } of results) {
    if (skipped) console.log(`SKIP ${name} (${skipped})`);
    else if (ok) console.log(`PASS ${name}`);
    else {
      failed += 1;
      console.error(`FAIL ${name}: ${detail}`);
    }
  }
  return failed;
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;
if (isMain) {
  const args = process.argv.slice(2);
  assert.ok(args.length === 0 || args.length === 1 && args[0] === '--require-d1',
    'Usage: production-monitor.mjs [--require-d1]');
  const failed = report(await runMonitor({ requireD1: args.includes('--require-d1') }));
  if (failed > 0) {
    console.error(`${failed} production check(s) failed.`);
    process.exitCode = 1;
  } else {
    console.log('All production checks passed.');
  }
}
