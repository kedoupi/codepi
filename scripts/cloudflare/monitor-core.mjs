import assert from 'node:assert/strict';
import { checkMcp } from './mcp-checks.mjs';

const ORIGINS = {
  auth: 'https://auth.codepi.app',
  web: 'https://codepi.app',
  gu: 'https://gu.codepi.app',
  gzh: 'https://gzh.codepi.app',
  health: 'https://health.codepi.app',
  project: 'https://project.codepi.app',
  me: 'https://me.codepi.app',
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
  project: { me: '/api/me', client: 'project', meStatus: 401 },
  me: { me: '/api/me', client: 'me', meStatus: 401 },
};

const HEALTH_APPS = new Set(['project', 'me']);

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

async function checkAppHealth(app, results) {
  const name = `${app} health endpoint`;
  try {
    const res = await request(`${ORIGINS[app]}/api/health`);
    assert.equal(res.status, 200, `status ${res.status}`);
    const body = await res.json();
    assert.ok(body && typeof body === 'object' && body.ok === true, 'health payload must include ok=true');
    if (app === 'project' || app === 'me') {
      assert.match(body.build ?? '', /^[a-f0-9]{7,40}$/, `${app} health must report a source SHA`);
      assert.equal(body.sso_enabled, true, `${app} health must report SSO enabled`);
      assert.equal(body.sso_ready, true, `${app} health must validate the Auth credential pair`);
    }
    if (app === 'me') assert.equal(body.source, 'me', 'Me health must identify the Me source');
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

async function checkHealthSyncFreshness(results, requireD1, env) {
  const name = 'health auto-sync succeeded within 30 hours';
  const accountId = env.CLOUDFLARE_ACCOUNT_ID;
  const token = env.CLOUDFLARE_API_TOKEN;
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

export async function runMonitor({ requireD1 = false, requireVersions = false, cwd,
  versionCheck, env = process.env } = {}) {
  const results = [];
  await checkAuthHealth(results);
  for (const app of Object.keys(PRIVATE_APPS)) {
    if (HEALTH_APPS.has(app)) await checkAppHealth(app, results);
    await checkPrivateApp(app, results);
  }
  results.push(...await checkMcp());
  await checkLegacyRouteClosed(results);
  await checkHealthSyncFreshness(results, requireD1, env);
  if (versionCheck) results.push(...await versionCheck({ requireVersions, cwd, env }));
  return results;
}

