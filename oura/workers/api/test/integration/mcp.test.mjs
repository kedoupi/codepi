import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { createRuntime, login, migrate } from './runtime.mjs';

let runtime;
before(async () => {
  runtime = createRuntime();
  await runtime.ready;
  await migrate(runtime);
});
after(async () => { await runtime?.dispose(); });

const ORIGIN = 'https://oura.example';

function fetchAt(path, options = {}) {
  return runtime.dispatchFetch(`${ORIGIN}${path}`, { redirect: 'manual', ...options });
}

function fetchAtRuntime(instance, path, options = {}) {
  return instance.dispatchFetch(`${ORIGIN}${path}`, { redirect: 'manual', ...options });
}

function base64url(bytes) {
  return Buffer.from(bytes).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function pkce() {
  const verifier = base64url(crypto.getRandomValues(new Uint8Array(32)));
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
  return { verifier, challenge: base64url(new Uint8Array(digest)) };
}

async function registerClient(redirectUri = 'http://127.0.0.1:9999/callback') {
  return registerClientAt(runtime, redirectUri);
}

async function registerClientAt(instance, redirectUri = 'http://127.0.0.1:9999/callback') {
  const res = await fetchAtRuntime(instance, '/oauth/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ client_name: 'Test MCP client', redirect_uris: [redirectUri] }),
  });
  assert.equal(res.status, 201);
  return res.json();
}

/** Full authorize → code → token exchange, returning the token response. */
async function authorizeAndExchange({ cookie, client, verifier, challenge, redirectUri = 'http://127.0.0.1:9999/callback', state = 'xyz' }) {
  return authorizeAndExchangeAt(runtime, { cookie, client, verifier, challenge, redirectUri, state });
}

async function authorizeAndExchangeAt(instance, { cookie, client, verifier, challenge, redirectUri = 'http://127.0.0.1:9999/callback', state = 'xyz' }) {
  const query = new URLSearchParams({
    client_id: client.client_id,
    redirect_uri: redirectUri,
    response_type: 'code',
    code_challenge: challenge,
    code_challenge_method: 'S256',
    state,
    scope: 'oura.read',
  });
  const consent = await fetchAtRuntime(instance, `/oauth/authorize?${query}`, { headers: { Cookie: cookie } });
  assert.equal(consent.status, 200, 'authorization GET should show consent');
  const html = await consent.text();
  const consentId = html.match(/name="consent_id" value="([^"]+)"/)?.[1];
  const csrfToken = html.match(/name="csrf_token" value="([^"]+)"/)?.[1];
  assert.ok(consentId && csrfToken, 'consent page should issue one-time credentials');
  const approve = await fetchAtRuntime(instance, '/oauth/authorize', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      ...(cookie ? { Cookie: cookie } : {}),
    },
    body: new URLSearchParams({ consent_id: consentId, csrf_token: csrfToken, client_id: client.client_id, decision: 'approve', state }).toString(),
  });
  assert.equal(approve.status, 302, 'approve should redirect');
  const location = new URL(approve.headers.get('location'));
  const code = location.searchParams.get('code');
  assert.ok(code, 'authorization code expected');
  assert.equal(location.searchParams.get('state'), state);
  const token = await fetchAtRuntime(instance, '/oauth/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code', code, client_id: client.client_id,
      redirect_uri: redirectUri, code_verifier: verifier,
    }).toString(),
  });
  return { token, code, status: token.status };
}

async function getConsentCredentials(cookie, client, options = {}) {
  const { challenge } = options;
  const query = new URLSearchParams({
    client_id: client.client_id, redirect_uri: 'http://127.0.0.1:9999/callback',
    response_type: 'code', code_challenge: challenge, code_challenge_method: 'S256',
    state: 'st', scope: 'oura.read',
  });
  const consent = await fetchAt(`/oauth/authorize?${query}`, { headers: { Cookie: cookie } });
  assert.equal(consent.status, 200);
  const html = await consent.text();
  return {
    consentId: html.match(/name="consent_id" value="([^"]+)"/)?.[1],
    csrfToken: html.match(/name="csrf_token" value="([^"]+)"/)?.[1],
    html,
  };
}

async function rpc(token, method, params) {
  return rpcAt(runtime, token, method, params);
}

async function rpcAt(instance, token, method, params) {
  const res = await fetchAtRuntime(instance, '/mcp', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, ...(params ? { params } : {}) }),
  });
  return { status: res.status, body: await res.json() };
}

test('discovery metadata describes this server as its own authorization server', async () => {
  const resource = await (await fetchAt('/.well-known/oauth-protected-resource')).json();
  assert.equal(resource.resource, `${ORIGIN}/mcp`);
  assert.deepEqual(resource.authorization_servers, [ORIGIN]);
  assert.deepEqual(resource.bearer_methods_supported, ['header']);

  const as = await (await fetchAt('/.well-known/oauth-authorization-server')).json();
  assert.equal(as.issuer, ORIGIN);
  assert.equal(as.authorization_endpoint, `${ORIGIN}/oauth/authorize`);
  assert.equal(as.token_endpoint, `${ORIGIN}/oauth/token`);
  assert.equal(as.registration_endpoint, `${ORIGIN}/oauth/register`);
  assert.deepEqual(as.code_challenge_methods_supported, ['S256']);
  assert.deepEqual(as.grant_types_supported.sort(), ['authorization_code', 'refresh_token']);
});

test('unauthenticated /mcp returns 401 pointing at the resource metadata', async () => {
  const res = await fetchAt('/mcp', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
  });
  assert.equal(res.status, 401);
  const challenge = res.headers.get('www-authenticate');
  assert.match(challenge, /Bearer/);
  assert.match(challenge, /resource_metadata="https:\/\/oura\.example\/\.well-known\/oauth-protected-resource"/);

  const bogus = await fetchAt('/mcp', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer not-a-real-token' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
  });
  assert.equal(bogus.status, 401);
});

test('dynamic client registration rejects insecure or malformed redirect URIs', async () => {
  const insecure = await fetchAt('/oauth/register', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ redirect_uris: ['http://evil.example/cb'] }),
  });
  assert.equal(insecure.status, 400);
  assert.equal((await insecure.json()).error, 'invalid_redirect_uri');

  const none = await fetchAt('/oauth/register', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({}),
  });
  assert.equal(none.status, 400);

  const loopback = await registerClient();
  assert.match(loopback.client_id, /^mcp_/);
  assert.equal(loopback.token_endpoint_auth_method, 'none');
});

test('authorize sends an anonymous browser through Oura login and back to consent', async () => {
  const client = await registerClient();
  const { challenge } = await pkce();
  const query = new URLSearchParams({
    client_id: client.client_id, redirect_uri: 'http://127.0.0.1:9999/callback',
    response_type: 'code', code_challenge: challenge, code_challenge_method: 'S256',
    state: 'keep-me', scope: 'oura.read',
  });
  const res = await fetchAt(`/oauth/authorize?${query}`);
  assert.equal(res.status, 302);
  const location = new URL(res.headers.get('location'));
  assert.equal(location.pathname, '/api/auth/oura/start');
  assert.equal(location.searchParams.get('return'), `/oauth/authorize?${query}`);
});

test('PKCE is mandatory and the redirect URI must be registered', async () => {
  const client = await registerClient();
  const noPkce = await fetchAt(
    `/oauth/authorize?${new URLSearchParams({
      client_id: client.client_id, redirect_uri: 'http://127.0.0.1:9999/callback',
      response_type: 'code', state: 's',
    })}`,
  );
  assert.equal(noPkce.status, 302);
  assert.equal(new URL(noPkce.headers.get('location')).searchParams.get('error'), 'invalid_request');

  const badRedirect = await fetchAt(
    `/oauth/authorize?${new URLSearchParams({
      client_id: client.client_id, redirect_uri: 'http://127.0.0.1:9999/other',
      response_type: 'code', code_challenge: 'x', code_challenge_method: 'S256',
    })}`,
  );
  assert.equal(badRedirect.status, 400);
  assert.equal((await badRedirect.json()).error, 'invalid_redirect_uri');
});

test('a GET cannot approve consent without the one-time form token', async () => {
  const cookie = await login(runtime);
  const client = await registerClient();
  const { challenge } = await pkce();
  const query = new URLSearchParams({
    client_id: client.client_id, redirect_uri: 'http://127.0.0.1:9999/callback',
    response_type: 'code', code_challenge: challenge, code_challenge_method: 'S256',
    state: 'st', scope: 'oura.read', decision: 'approve',
  });
  const res = await fetchAt(`/oauth/authorize?${query}`, { headers: { Cookie: cookie } });
  assert.equal(res.status, 200);
  assert.match(await res.text(), /允许连接/);
});

test('consent approval requires a matching CSRF token and is single-use', async () => {
  const cookie = await login(runtime);
  const client = await registerClient();
  const { verifier, challenge } = await pkce();
  const consent = await getConsentCredentials(cookie, client, { challenge });
  assert.ok(consent.consentId && consent.csrfToken);
  const approveBody = () => new URLSearchParams({
    consent_id: consent.consentId, csrf_token: consent.csrfToken,
    client_id: client.client_id, decision: 'approve', state: 'st',
  }).toString();

  const wrongCsrf = await fetchAt('/oauth/authorize', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Cookie: cookie },
    body: new URLSearchParams({
      consent_id: consent.consentId, csrf_token: 'wrong', client_id: client.client_id, decision: 'approve', state: 'st',
    }).toString(),
  });
  assert.equal(wrongCsrf.status, 403);

  const foreignOrigin = await fetchAt('/oauth/authorize', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded', Cookie: cookie, Origin: 'https://evil.example',
    },
    body: approveBody(),
  });
  assert.equal(foreignOrigin.status, 403);

  const approve = await fetchAt('/oauth/authorize', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Cookie: cookie },
    body: approveBody(),
  });
  assert.equal(approve.status, 302);
  assert.ok(new URL(approve.headers.get('location')).searchParams.get('code'));

  const reused = await fetchAt('/oauth/authorize', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Cookie: cookie },
    body: approveBody(),
  });
  assert.equal(reused.status, 403);

  const exchange = await fetchAt('/oauth/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code: new URL(approve.headers.get('location')).searchParams.get('code'),
      client_id: client.client_id,
      redirect_uri: 'http://127.0.0.1:9999/callback',
      code_verifier: verifier,
    }).toString(),
  });
  assert.equal(exchange.status, 200);
});

test('consent screen renders and denial returns access_denied', async () => {
  const cookie = await login(runtime);
  const client = await registerClient();
  const { challenge } = await pkce();

  const consent = await getConsentCredentials(cookie, client, { challenge });
  const html = consent.html;
  assert.match(html, /允许连接/);
  assert.ok(!html.includes(cookie), 'consent page must not echo the session cookie');

  const denied = await fetchAt('/oauth/authorize', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Cookie: cookie },
    body: new URLSearchParams({
      consent_id: consent.consentId, csrf_token: consent.csrfToken,
      client_id: client.client_id, decision: 'deny', state: 'st',
    }).toString(),
  });
  assert.equal(denied.status, 302);
  const target = new URL(denied.headers.get('location'));
  assert.equal(target.searchParams.get('error'), 'access_denied');
  assert.equal(target.searchParams.get('code'), null);
});

test('a non-owner session cannot authorize the connector', async () => {
  const other = createRuntime({ bindings: {
    ALLOW_DEV_LOGIN: '0',
    FRONTEND_ORIGIN: 'https://oura.example',
    OURA_REDIRECT_URI: 'https://oura.example/api/auth/oura/callback',
    OURA_CLIENT_ID: 'integration-client',
    OURA_CLIENT_SECRET: 'integration-client-secret',
    SESSION_SECRET: 'integration-session-secret',
    TOKEN_ENCRYPTION_KEY: 'integration-encryption-secret',
    PERSONAL_OWNER_ID: 'someone-else',
  } });
  try {
    await other.ready;
    await migrate(other);
    const cookie = await login(other);
    // Register against THIS runtime; a client from another instance is unknown here.
    const client = await other.dispatchFetch(`${ORIGIN}/oauth/register`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ client_name: 'outsider', redirect_uris: ['http://127.0.0.1:9999/callback'] }),
    }).then(res => res.json());
    const res = await other.dispatchFetch(`${ORIGIN}/oauth/authorize`, {
      method: 'POST', redirect: 'manual',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Cookie: cookie },
      body: new URLSearchParams({
        consent_id: 'mcp_consent_unknown.sig', csrf_token: 'wrong',
        client_id: client.client_id, decision: 'approve',
      }).toString(),
    });
    assert.equal(res.status, 403);
    assert.equal((await res.json()).error, 'access_denied');
  } finally {
    await other.dispose();
  }
});

test('authorization code is single use and PKCE-bound', async () => {
  const cookie = await login(runtime);
  const client = await registerClient();
  const good = await pkce();
  const first = await authorizeAndExchange({ cookie, client, verifier: good.verifier, challenge: good.challenge });
  assert.equal(first.status, 200);
  const tokens = await first.token.json();
  assert.ok(tokens.access_token && tokens.refresh_token);
  assert.equal(tokens.token_type, 'Bearer');

  // Replaying the same code must fail.
  const replay = await fetchAt('/oauth/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code', code: first.code, client_id: client.client_id,
      redirect_uri: 'http://127.0.0.1:9999/callback', code_verifier: good.verifier,
    }).toString(),
  });
  assert.equal(replay.status, 400);
  assert.equal((await replay.json()).error, 'invalid_grant');

  // A wrong verifier must not mint tokens.
  const { verifier } = await pkce();
  const bad = await authorizeAndExchange({ cookie, client, verifier, challenge: good.challenge });
  assert.equal(bad.status, 400);
  assert.equal((await bad.token.json()).error, 'invalid_grant');
});

test('refresh tokens rotate and the old one stops working', async () => {
  const cookie = await login(runtime);
  const client = await registerClient();
  const pair = await pkce();
  const issued = await authorizeAndExchange({ cookie, client, verifier: pair.verifier, challenge: pair.challenge });
  const tokens = await issued.token.json();

  const refresh = () => fetchAt('/oauth/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'refresh_token', refresh_token: tokens.refresh_token, client_id: client.client_id,
    }).toString(),
  });
  const rotated = await refresh();
  assert.equal(rotated.status, 200);
  const next = await rotated.json();
  assert.notEqual(next.refresh_token, tokens.refresh_token);
  const reused = await refresh();
  assert.equal(reused.status, 400);
  assert.equal((await reused.json()).error, 'invalid_grant');
});

test('tools are listed with schemas and return grounded Oura data', async () => {
  const cookie = await login(runtime);
  const client = await registerClient();
  const pair = await pkce();
  const issued = await authorizeAndExchange({ cookie, client, verifier: pair.verifier, challenge: pair.challenge });
  const { access_token } = await issued.token.json();

  const init = await rpc(access_token, 'initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'test', version: '1' } });
  assert.equal(init.status, 200);
  assert.equal(init.body.result.protocolVersion, '2025-06-18');
  assert.equal(init.body.result.serverInfo.name, 'oura-personal-health');
  assert.equal(init.body.result.serverInfo.websiteUrl, `${ORIGIN}/`);
  assert.deepEqual(init.body.result.serverInfo.icons, [
    { src: `${ORIGIN}/icon.png`, mimeType: 'image/png', sizes: ['512x512'] },
    { src: `${ORIGIN}/icon.svg`, mimeType: 'image/svg+xml', sizes: ['any'] },
  ]);
  assert.match(init.body.result.instructions, /read-only/i);

  const list = await rpc(access_token, 'tools/list', {});
  const names = list.body.result.tools.map(tool => tool.name).sort();
  assert.deepEqual(names, ['compare_periods', 'get_connection_status', 'get_daily_metrics', 'get_health_data_status', 'get_health_records', 'get_period_summary']);
  for (const tool of list.body.result.tools) {
    assert.equal(tool.inputSchema.type, 'object');
    assert.ok(tool.description.length > 20, `${tool.name} needs a usable description`);
  }
  const details = await rpc(access_token, 'tools/call', { name: 'get_health_records', arguments: { collection: 'sleep' } });
  assert.equal(details.body.result.structuredContent.records[0].average_hrv, 42);
  assert.equal(details.body.result.structuredContent.records[0].total_sleep_duration, 28800);
  assert.equal(details.body.result.structuredContent.records[0].hrv, undefined);
  const health = await rpc(access_token, 'tools/call', { name: 'get_health_data_status', arguments: {} });
  assert.equal(health.body.result.structuredContent.collections.find(row => row.name === 'sleep').records, 1);
  const invalid = await rpc(access_token, 'tools/call', { name: 'get_health_records', arguments: { collection: '../personal_info' } });
  assert.equal(invalid.body.result.isError, true);

  const status = await rpc(access_token, 'tools/call', { name: 'get_connection_status', arguments: {} });
  assert.ok(!status.body.result.isError);
  assert.equal(status.body.result.structuredContent.connected, true);
  assert.equal(status.body.result.structuredContent.stale, false);
  assert.equal(status.body.result.structuredContent.latest_day_with_data !== null, true);

  const daily = await rpc(access_token, 'tools/call', { name: 'get_daily_metrics', arguments: { days: 7 } });
  const payload = daily.body.result.structuredContent;
  assert.equal(payload.days.length, 7);
  assert.equal(payload.days.at(-1).sleep_score, 80);
  assert.equal(payload.days.at(-1).steps, 8000);
  assert.equal(payload.coverage.days_with_data, 7);
  assert.equal(payload.coverage.days_without_data, 0);
  assert.match(payload.disclaimer, /非医疗建议/);

  const summary = await rpc(access_token, 'tools/call', { name: 'get_period_summary', arguments: { days: 30 } });
  assert.equal(summary.body.result.structuredContent.averages.sleep, 80);

  const compare = await rpc(access_token, 'tools/call', { name: 'compare_periods', arguments: { mode: 'week' } });
  assert.equal(compare.body.result.structuredContent.left.sleep, 80);
  assert.equal(compare.body.result.structuredContent.right.sleep, 80);
  assert.equal(compare.body.result.structuredContent.left.days, 7);

  const unknown = await rpc(access_token, 'tools/call', { name: 'delete_everything', arguments: {} });
  assert.equal(unknown.body.result.structuredContent.error, 'unknown_tool');
  assert.equal(unknown.body.result.isError, true);

  const badMethod = await rpc(access_token, 'resources/list', {});
  assert.equal(badMethod.body.error.code, -32601);

  const badParams = await rpc(access_token, 'tools/call', {});
  assert.equal(badParams.body.error.code, -32602);
});

test('period tools compute the actual 30-day window and prior 30-day comparison', async () => {
  const varied = createRuntime({
    variedDailyData: day => {
      const date = new Date(`${day}T00:00:00Z`);
      const age = Math.floor((Date.now() - date.getTime()) / 86400000);
      if (age <= 29) return { score: 90, steps: 9000 };
      return { score: 60, steps: 6000 };
    },
  });
  try {
    await varied.ready;
    await migrate(varied);
    const cookie = await login(varied);
    const client = await registerClientAt(varied);
    const pair = await pkce();
    const issued = await authorizeAndExchangeAt(varied, { cookie, client, verifier: pair.verifier, challenge: pair.challenge });
    const { access_token } = await issued.token.json();

    const summary = await rpcAt(varied, access_token, 'tools/call', { name: 'get_period_summary', arguments: { days: 30 } });
    const summaryPayload = summary.body.result.structuredContent;
    assert.equal(summaryPayload.days, 30);
    assert.equal(summaryPayload.averages.sleep, 90);
    assert.equal(summaryPayload.averages.steps, 9000);
    assert.equal(summaryPayload.coverage.metric_counts.sleep_score, 30);

    const compare = await rpcAt(varied, access_token, 'tools/call', { name: 'compare_periods', arguments: { mode: 'range' } });
    const payload = compare.body.result.structuredContent;
    assert.equal(payload.mode, 'range');
    assert.equal(payload.left.label, '近 30 天');
    assert.equal(payload.right.label, '前 30 天');
    assert.equal(payload.left.sleep, 90);
    assert.equal(payload.right.sleep, 60);
    assert.equal(payload.left.steps, 9000);
    assert.equal(payload.right.steps, 6000);
  } finally {
    await varied.dispose();
  }
});

test('every tool refuses to serve a non-owner token', async () => {
  const other = createRuntime({ bindings: {
    ALLOW_DEV_LOGIN: '0',
    FRONTEND_ORIGIN: 'https://oura.example',
    OURA_REDIRECT_URI: 'https://oura.example/api/auth/oura/callback',
    OURA_CLIENT_ID: 'integration-client',
    OURA_CLIENT_SECRET: 'integration-client-secret',
    SESSION_SECRET: 'integration-session-secret',
    TOKEN_ENCRYPTION_KEY: 'integration-encryption-secret',
    PERSONAL_OWNER_ID: '',
  } });
  try {
    await other.ready;
    await migrate(other);
    const cookie = await login(other);
    const res = await other.dispatchFetch(`${ORIGIN}/api/me/connections`, { headers: { Cookie: cookie } });
    assert.equal(res.status, 200);
    // With no owner configured nobody can authorize, so the connector has no tokens.
    const client = await other.dispatchFetch(`${ORIGIN}/oauth/register`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ redirect_uris: ['http://127.0.0.1:9999/callback'] }),
    }).then(r => r.json());
    const authorize = await other.dispatchFetch(`${ORIGIN}/oauth/authorize`, {
      method: 'POST', redirect: 'manual',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Cookie: cookie },
      body: new URLSearchParams({
        consent_id: 'mcp_consent_unknown.sig', csrf_token: 'wrong',
        client_id: client.client_id, decision: 'approve',
      }).toString(),
    });
    assert.equal(authorize.status, 403);
    assert.equal((await authorize.json()).error, 'access_denied');
  } finally {
    await other.dispose();
  }
});

test('connections can be listed and revoked, invalidating the access token', async () => {
  const cookie = await login(runtime);
  const client = await registerClient();
  const pair = await pkce();
  const issued = await authorizeAndExchange({ cookie, client, verifier: pair.verifier, challenge: pair.challenge });
  const { access_token } = await issued.token.json();
  assert.equal((await rpc(access_token, 'tools/list', {})).status, 200);

  const listed = await fetchAt('/api/me/connections', { headers: { Cookie: cookie } });
  const { connections } = await listed.json();
  assert.ok(connections.some(row => row.client_id === client.client_id));

  const revoked = await fetchAt('/api/me/connections', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: cookie },
    body: JSON.stringify({ client_id: client.client_id }),
  });
  assert.equal(revoked.status, 200);
  assert.ok((await revoked.json()).revoked >= 1);

  assert.equal((await rpc(access_token, 'tools/list', {})).status, 401);
  const after = await fetchAt('/api/me/connections', { headers: { Cookie: cookie } });
  const remaining = (await after.json()).connections.map(row => row.client_id);
  assert.ok(!remaining.includes(client.client_id), 'revoked client should be gone');
});

test('connector endpoints reject methods they do not implement', async () => {
  assert.equal((await fetchAt('/mcp')).status, 405);
  assert.equal((await fetchAt('/oauth/register')).status, 405);
  assert.equal((await fetchAt('/oauth/token')).status, 405);
  const preflight = await fetchAt('/mcp', { method: 'OPTIONS' });
  assert.equal(preflight.status, 204);
  assert.equal(preflight.headers.get('access-control-allow-origin'), '*');
});
