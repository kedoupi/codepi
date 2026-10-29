import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fixture, ORIGIN, REDIRECT, hash } from './runtime.mjs';
import { healthData } from './health-pages.mjs';
import { MCP_LIMITS } from '@kedoupi/shared/mcp/contract';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

test('official SDK client initializes and calls tools across independent HTTP requests', async t => {
  const f = await fixture(t), grant = await f.grant();
  const client = new Client({ name: 'codepi-sdk-test', version: '1.0.0' });
  t.after(() => client.close());
  await client.connect(new StreamableHTTPClientTransport(new URL(ORIGIN + '/mcp'), {
    fetch: f.fetch, requestInit: { headers: { Authorization: 'Bearer ' + grant.access_token } },
  }));
  assert.equal((await client.listTools()).tools.length, 6);
  const result = await client.callTool({ name: 'list_data_sources', arguments: {} });
  assert.equal(result.structuredContent.sources[0].id, 'health');
});

test('SSO, resource bound OAuth, SDK transport and private Health RPC work together', async t => {
  const f = await fixture(t), grant = await f.grant();
  const discovery = await (await f.at('/.well-known/oauth-protected-resource/mcp')).json();
  assert.equal(discovery.resource, ORIGIN + '/mcp');
  assert.deepEqual(discovery.scopes_supported, ['context.read', 'projects.read', 'projects.write',
    'health.read', 'health.sync', 'me.read', 'me.write', 'invest.read', 'blog.read', 'blog.write']);
  const unauthorized = await f.rpc('x'.repeat(43), 'tools/list');
  assert.equal(unauthorized.status, 401);
  assert.match(unauthorized.headers.get('WWW-Authenticate'), /oauth-protected-resource/);
  const init = await f.rpc(grant.access_token, 'initialize', {
    protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'test', version: '1' },
  });
  assert.equal(init.body.result.serverInfo.name, 'codepi');
  const listed = await f.rpc(grant.access_token, 'tools/list');
  assert.equal(listed.body.result.tools.length, 6);
  assert.equal(listed.body.result.tools.find(t => t.name === 'health_query_records').annotations.readOnlyHint, false);
  const directory = await f.tool(grant.access_token, 'list_data_sources');
  assert.deepEqual(directory.structuredContent.sources.map(s => s.id), ['health']);
  const catalog = await healthData(f, grant.access_token, 'health_get_catalog');
  assert.equal(catalog.collections.find(c => c.name === 'sleep').metrics[4].unit, 'ms');
  // The HTTP dispatcher does not expose the capability, even with spoofed identity.
  const publicRpc = await f.health.fetch('https://health.example/internal/mcp', {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'X-User-ID': 'health-owner' },
    body: JSON.stringify({ operation: 'catalog', subject: 'kdp-owner' }),
  });
  assert.equal(publicRpc.status, 404);
  const tokens = await f.db.prepare('SELECT token_hash,resource FROM mcp_tokens').all();
  assert.ok(tokens.results.every(row => row.token_hash !== grant.access_token && row.resource === ORIGIN + '/mcp'));
  const badResource = await f.post('/oauth/token', { ...grant.tokenForm, resource: 'https://health.example/mcp' });
  assert.equal(badResource.status, 400);
  assert.equal((await badResource.json()).error, 'invalid_target');
  assert.equal((await f.post('/oauth/token', grant.tokenForm)).status, 400, 'code is single use');
});

test('rotation replay retires only its family, wrong audience and expired access fail closed', async t => {
  const f = await fixture(t), grant = await f.grant();
  const refresh = { grant_type: 'refresh_token', client_id: grant.client.client_id,
    refresh_token: grant.refresh_token, resource: ORIGIN + '/mcp' };
  const response = await f.post('/oauth/token', refresh);
  assert.equal(response.status, 200);
  const pair = await response.json();
  assert.notEqual(pair.refresh_token, grant.refresh_token);
  // A retry after a lost response, within the grace window, keeps the connection alive.
  const retry = await f.post('/oauth/token', refresh);
  assert.equal(retry.status, 200);
  const retried = await retry.json();
  assert.notEqual(retried.refresh_token, pair.refresh_token);
  assert.equal((await f.rpc(pair.access_token, 'tools/list')).status, 200, 'the first successor stays valid');
  assert.equal((await f.rpc(retried.access_token, 'tools/list')).status, 200);
  // The window issues a bounded number of live pairs; further reuse is a leak and closes the family.
  assert.equal((await f.post('/oauth/token', refresh)).status, 200);
  assert.equal((await f.post('/oauth/token', refresh)).status, 200);
  assert.equal((await f.post('/oauth/token', refresh)).status, 400, 'a fifth live pair is never minted');
  assert.equal((await f.rpc(retried.access_token, 'tools/list')).status, 401);
  const capped = await f.grant(), cappedRefresh = { ...refresh, client_id: capped.client.client_id, refresh_token: capped.refresh_token };
  const cappedPair = await (await f.post('/oauth/token', cappedRefresh)).json();
  assert.equal((await f.post('/oauth/token', cappedRefresh)).status, 200);
  // Outside the window the same token is a leak and retires the whole family.
  await f.db.prepare('UPDATE mcp_tokens SET rotated_at=rotated_at-120000 WHERE token_hash=?')
    .bind(await hash(capped.refresh_token)).run();
  assert.equal((await f.post('/oauth/token', cappedRefresh)).status, 400);
  assert.equal((await f.rpc(cappedPair.access_token, 'tools/list')).status, 401);
  assert.equal((await f.post('/oauth/token', { ...cappedRefresh, refresh_token: cappedPair.refresh_token })).status, 400);
  const another = await f.grant();
  await f.db.prepare('UPDATE mcp_tokens SET resource=? WHERE token_hash=?')
    .bind('https://wrong.example/mcp', await hash(another.access_token)).run();
  assert.equal((await f.rpc(another.access_token, 'tools/list')).status, 401);
  await f.db.prepare('UPDATE mcp_tokens SET resource=?,expires_at=0 WHERE token_hash=?')
    .bind(ORIGIN + '/mcp', await hash(another.access_token)).run();
  assert.equal((await f.rpc(another.access_token, 'tools/list')).status, 401);
});

test('client grants remain independent of website logout and central Auth availability', async t => {
  const f = await fixture(t), grant = await f.grant();
  const loggedOut = await f.post('/api/auth/logout', {}, { Cookie: grant.cookie, Origin: ORIGIN });
  assert.equal(loggedOut.status, 200);
  assert.equal((await f.db.prepare('SELECT COUNT(*) n FROM kdp_sso_sessions').first()).n, 0);
  f.state.authUnavailable = true;
  const catalog = await f.tool(grant.access_token, 'health_get_catalog');
  assert.equal(catalog.isError, undefined);
  const refreshed = await f.post('/oauth/token', { grant_type: 'refresh_token',
    client_id: grant.client.client_id, refresh_token: grant.refresh_token, resource: ORIGIN + '/mcp' });
  assert.equal(refreshed.status, 200);
  const pair = await refreshed.json();
  assert.equal((await f.rpc(pair.access_token, 'tools/list')).status, 200);
});

test('consent and connection revocation require owner session, same origin and CSRF', async t => {
  const f = await fixture(t), grant = await f.grant();
  const replay = await f.post('/oauth/authorize', grant.approval, { Cookie: grant.cookie, Origin: ORIGIN });
  assert.equal(replay.status, 403);
  const cross = await f.post('/oauth/authorize', grant.approval, { Cookie: grant.cookie, Origin: 'https://evil.example' });
  assert.equal(cross.status, 403);
  const page = await f.at('/connections', { headers: { Cookie: grant.cookie } });
  const html = await page.text();
  assert.match(html, /Synthetic client/);
  const csrf = html.match(/name="csrf_token" value="([^"]+)"/)[1];
  assert.equal((await f.post('/connections', { client_id: grant.client.client_id, csrf_token: 'wrong' },
    { Cookie: grant.cookie, Origin: ORIGIN })).status, 403);
  const revoked = await f.post('/connections', { client_id: grant.client.client_id, csrf_token: csrf },
    { Cookie: grant.cookie, Origin: ORIGIN });
  assert.equal(revoked.status, 303);
  assert.equal((await f.rpc(grant.access_token, 'tools/list')).status, 401);
  f.state.subject = 'someone-else';
  await assert.rejects(() => f.login(), /SSO callback failed/);
});

test('an approved client re-authorizes without the consent screen until revoked', async t => {
  const f = await fixture(t), first = await f.grant();
  const reauthorize = async () => {
    const verifier = Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString('base64url');
    const params = new URLSearchParams({ client_id: first.client.client_id, redirect_uri: REDIRECT,
      response_type: 'code', code_challenge: await hash(verifier), code_challenge_method: 'S256',
      state: 'reauth', resource: ORIGIN + '/mcp' });
    const screen = await f.at('/oauth/authorize?' + params, { headers: { Cookie: first.cookie } });
    return { screen, verifier };
  };
  const second = await reauthorize();
  assert.equal(second.screen.status, 302, 'a live grant must skip the consent screen');
  const location = new URL(second.screen.headers.get('Location'));
  assert.equal(location.searchParams.get('state'), 'reauth');
  const code = location.searchParams.get('code');
  assert.ok(code);
  const exchanged = await f.post('/oauth/token', { grant_type: 'authorization_code', code,
    client_id: first.client.client_id, redirect_uri: REDIRECT, code_verifier: second.verifier, resource: ORIGIN + '/mcp' });
  assert.equal(exchanged.status, 200, 'the auto-issued code must exchange for tokens');

  const page = await f.at('/connections', { headers: { Cookie: first.cookie } });
  const csrf = (await page.text()).match(/name="csrf_token" value="([^"]+)"/)[1];
  await f.post('/connections', { client_id: first.client.client_id, csrf_token: csrf },
    { Cookie: first.cookie, Origin: ORIGIN });
  const third = await reauthorize();
  assert.equal(third.screen.status, 200, 'a revoked grant must show the consent screen again');
  assert.match(await third.screen.text(), /name="consent_id"/);
});

test('statistics scan all saved records with units, daily weighting and honest missingness', async t => {
  const f = await fixture(t), grant = await f.grant();
  for (let i = 1; i <= 25; i++) await f.record('sleep', '2026-01-01', 's' + i,
    { total_sleep_duration: 100, average_hrv: 40 });
  await f.record('sleep', '2026-01-02', 'next', { total_sleep_duration: 5000, average_hrv: 60 });
  await f.record('sleep', '2026-01-03', 'missing', { total_sleep_duration: 100, average_hrv: null });
  await f.record('sleep', '2026-01-01', 'another-owner', { total_sleep_duration: 999999, average_hrv: 999 }, 'different-owner');
  await f.cover('sleep', '2026-01-01', '2026-01-04');
  const first = await f.tool(grant.access_token, 'health_query_records', {
    collection: 'sleep', from: '2026-01-01', to: '2026-01-04', refresh: false, fields: ['id', 'average_hrv'],
  });
  assert.equal(first.structuredContent.records.length, 20);
  assert.equal(first.structuredContent.next_offset, 20);
  assert.equal(first.structuredContent.total, 27);
  const stats = await f.tool(grant.access_token, 'health_aggregate', {
    collection: 'sleep', from: '2026-01-01', to: '2026-01-04', metrics: ['average_hrv'], refresh: false,
    compare_from: '2025-12-01', compare_to: '2025-12-31',
  });
  const [current, baseline] = stats.structuredContent.periods;
  const bucket = current.metrics[0].buckets[0];
  assert.equal(bucket.mean, 50, 'equal day weighting, not mean of 26 records');
  assert.equal(bucket.valid_days, 2);
  assert.equal(bucket.valid_records, 26);
  assert.equal(baseline.metrics[0].buckets[0].mean, null);
  assert.equal(stats.structuredContent.coverage[0].days_verified, 4, 'empty successful day is verified too');
  assert.equal(stats.structuredContent.coverage[1].days_verified, 0);
  const sum = await f.tool(grant.access_token, 'health_aggregate', {
    collection: 'sleep', from: '2026-01-01', to: '2026-01-04', metrics: ['total_sleep_duration'],
    operations: ['sum'], refresh: false,
  });
  assert.equal(sum.structuredContent.periods[0].metrics[0].buckets[0].sum, 7600);
  const rejected = await f.tool(grant.access_token, 'health_aggregate', {
    collection: 'sleep', metrics: ['average_hrv'], operations: ['sum'],
  });
  assert.equal(rejected.isError, true);
  assert.equal(rejected.structuredContent.error, 'unsupported_operation');
  const spoof = await f.tool(grant.access_token, 'health_query_records', { collection: 'sleep', user_id: 'different-owner' });
  assert.equal(spoof.structuredContent.error, 'invalid_arguments');
  assert.equal(f.state.providerCalls, 0);
});

test('stale queries enqueue durable deduplicated work, pagination and historical queries do not', async t => {
  const f = await fixture(t), grant = await f.grant();
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai' }).format(new Date());
  await f.healthDb.prepare('INSERT INTO users (id) VALUES (?)').bind('health-owner').run();
  await f.healthDb.prepare(`INSERT INTO encrypted_tokens (user_id,iv,ciphertext) VALUES (?,?,?)`)
    .bind('health-owner', 'synthetic', 'synthetic').run();
  const args = { collection: 'sleep', from: today, to: today };
  const first = await f.tool(grant.access_token, 'health_query_records', args);
  assert.equal(first.structuredContent.refresh_requested, true);
  assert.equal(first.structuredContent.records.length, 0);
  assert.deepEqual(first.structuredContent.coverage[0].days_unverified, [today]);
  await f.tool(grant.access_token, 'health_query_records', args);
  const state = await f.healthDb.prepare('SELECT payload FROM auto_sync_state').first();
  assert.equal(JSON.parse(state.payload).length, 1);
  await f.tool(grant.access_token, 'health_query_records', { ...args, collection: 'heartrate', offset: 20 });
  assert.equal(JSON.parse((await f.healthDb.prepare('SELECT payload FROM auto_sync_state').first()).payload).length, 1);
  await f.cover('daily_sleep', today, today);
  const fresh = await f.tool(grant.access_token, 'health_query_records', { ...args, collection: 'daily_sleep' });
  assert.equal(fresh.structuredContent.refresh_requested, false);
  const old = await f.tool(grant.access_token, 'health_query_records', {
    collection: 'sleep', from: '2020-01-01', to: '2020-01-02',
  });
  assert.equal(old.structuredContent.refresh_requested, false);
  assert.ok(old.structuredContent.warnings.includes('outside_automatic_backfill'));
  assert.equal(f.state.providerCalls, 0);
});

test('dashboard score history stays queryable independently of detailed provider records', async t => {
  const f = await fixture(t), grant = await f.grant();
  await f.healthDb.prepare('INSERT INTO users(id) VALUES (?)').bind('health-owner').run();
  for (const [day, score] of [['2024-01-01', 70], ['2024-01-02', 90]]) {
    await f.healthDb.prepare('INSERT INTO daily_cache(user_id,day,payload) VALUES (?,?,?)')
      .bind('health-owner', day, JSON.stringify({ date: day, sleep: { score }, activity: { steps: 1000 } })).run();
  }
  const records = await f.tool(grant.access_token, 'health_query_records', {
    collection: 'daily_metrics', from: '2024-01-01', to: '2024-01-02', refresh: false,
  });
  assert.equal(records.structuredContent.storage, 'daily_cache');
  assert.equal(records.structuredContent.records[0].sleep_score, 70);
  assert.equal(records.structuredContent.records[0].readiness_score, null);
  const stats = await f.tool(grant.access_token, 'health_aggregate', {
    collection: 'daily_metrics', from: '2024-01-01', to: '2024-01-02', metrics: ['sleep_score'], refresh: false,
  });
  assert.equal(stats.structuredContent.periods[0].metrics[0].buckets[0].mean, 80);
  assert.equal(stats.structuredContent.refresh_requested, false);
});

test('invalid ranges, fields and unknown metrics never become arbitrary SQL or silent truncation', async t => {
  const f = await fixture(t), grant = await f.grant();
  for (const [args, error] of [
    [{ collection: 'sleep', to: 'not-a-date' }, 'invalid_date_range'],
    [{ collection: 'sleep', to: '2026-02-30' }, 'invalid_date_range'],
    [{ collection: 'heartrate', from: '2026-01-01', to: '2026-01-08' }, 'invalid_date_range'],
    [{ collection: 'sleep', fields: ['constructor.prototype'] }, 'invalid_fields'],
    [{ collection: 'sleep', fields: ['hrv.items'] }, 'series_requires_include_series'],
    [{ collection: 'personal_info', from: '2026-01-01' }, 'snapshot_has_no_historical_range'],
  ]) {
    const result = await f.tool(grant.access_token, 'health_query_records', args);
    assert.equal(result.structuredContent.error, error);
  }
  const invalid = await f.tool(grant.access_token, 'health_aggregate', {
    collection: 'sleep', metrics: ["average_hrv');DROP TABLE users;--"],
  });
  assert.equal(invalid.structuredContent.error, 'invalid_fields');
  assert.equal((await f.tool(grant.access_token, 'health_get_catalog')).isError, undefined);
});

test('query refresh preserves collection refusals, OAuth blocks and provider retry deadlines', async t => {
  const f = await fixture(t), grant = await f.grant();
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai' }).format(new Date());
  await f.healthDb.prepare('INSERT INTO users(id) VALUES (?)').bind('health-owner').run();
  await f.healthDb.prepare('INSERT INTO encrypted_tokens(user_id,iv,ciphertext) VALUES (?,?,?)')
    .bind('health-owner', 'synthetic', 'synthetic').run();
  await f.cover('daily_spo2', today, today, null, 'upstream_access_denied');
  const refused = await f.tool(grant.access_token, 'health_query_records', {
    collection: 'daily_spo2', from: today, to: today,
  });
  assert.equal(refused.structuredContent.refresh_requested, false);
  assert.ok(refused.structuredContent.warnings.includes('upstream_access_denied'));
  const after = Date.now() + 15 * 60_000;
  const tasks = [{ collection: 'sleep', from: today, to: today, state: 'failed', attempts: 3, after, error: 'rate_limited' }];
  await f.healthDb.prepare(`UPDATE auto_sync_state SET status='partial',payload=? WHERE user_id=?`)
    .bind(JSON.stringify(tasks), 'health-owner').run();
  await f.tool(grant.access_token, 'health_query_records', { collection: 'daily_activity', from: today, to: today });
  const queued = JSON.parse((await f.healthDb.prepare('SELECT payload FROM auto_sync_state').first()).payload);
  assert.equal(queued[0].attempts, 3);
  assert.equal(queued[0].after, after);
  assert.equal(queued[1].after, after, 'new work cannot bypass provider-wide cooldown');
  await f.healthDb.prepare("UPDATE auto_sync_state SET payload=?").bind(JSON.stringify([{
    ...tasks[0], state: 'pending', error: 'daily_sync_budget_reached',
  }])).run();
  await f.tool(grant.access_token, 'health_query_records', { collection: 'daily_activity', from: today, to: today });
  const quota = JSON.parse((await f.healthDb.prepare('SELECT payload FROM auto_sync_state').first()).payload);
  assert.equal(quota[1].after, after, 'new work must preserve the global storage budget hold');
  assert.equal(quota[1].error, 'daily_sync_budget_reached');
  await f.healthDb.prepare("UPDATE auto_sync_state SET status='blocked',last_error='reconnect_required'").run();
  const blocked = await f.tool(grant.access_token, 'health_query_records', { collection: 'sleep', from: today, to: today });
  assert.equal(blocked.structuredContent.refresh_requested, false);
  assert.ok(blocked.structuredContent.warnings.includes('reconnect_required'));
});

test('bad PKCE does not burn a code and a wrong client cannot rotate or revoke its tokens', async t => {
  const f = await fixture(t), pending = await f.grant({ exchange: false });
  assert.equal((await f.post('/oauth/token', { ...pending.tokenForm, code_verifier: 'x'.repeat(43) })).status, 400);
  const valid = await f.post('/oauth/token', pending.tokenForm);
  assert.equal(valid.status, 200);
  const pair = await valid.json(), another = await f.grant();
  const wrong = await f.post('/oauth/token', {
    grant_type: 'refresh_token', client_id: another.client.client_id, refresh_token: pair.refresh_token,
  });
  assert.equal(wrong.status, 400);
  await f.post('/oauth/revoke', { client_id: another.client.client_id, token: pair.access_token });
  assert.equal((await f.rpc(pair.access_token, 'tools/list')).status, 200);
});

test('MCP validates browser origins before preflight or bearer authorization', async t => {
  const f = await fixture(t, { mcpBindings: { MCP_ALLOWED_ORIGINS: 'http://localhost:6274' } });
  const grant = await f.grant();
  for (const method of ['OPTIONS', 'POST']) {
    const denied = await f.at('/mcp', { method, headers: {
      Origin: 'https://untrusted.example', Authorization: 'Bearer ' + grant.access_token,
    } });
    assert.equal(denied.status, 403);
    assert.equal(denied.headers.get('Access-Control-Allow-Origin'), null);
  }
  const preflight = await f.at('/mcp', { method: 'OPTIONS', headers: { Origin: 'http://localhost:6274' } });
  assert.equal(preflight.status, 204);
  assert.equal(preflight.headers.get('Access-Control-Allow-Origin'), 'http://localhost:6274');
  const allowed = await f.at('/mcp', { method: 'POST', headers: {
    Origin: 'http://localhost:6274', Authorization: 'Bearer ' + grant.access_token,
    'Content-Type': 'application/json', Accept: 'application/json, text/event-stream',
  }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }) });
  assert.equal(allowed.status, 200);
  assert.equal(allowed.headers.get('Access-Control-Allow-Origin'), 'http://localhost:6274');
});

test('anonymous release smoke fails when the MCP SSO credential has not been paired', async t => {
  const f = await fixture(t, { mcpBindings: { AUTH_CLIENT_SECRET: '' } });
  const status = await f.at('/api/health');
  assert.equal(status.status, 503);
  assert.equal((await status.json()).ok, false);
  const wrong = await fixture(t, { mcpBindings: { AUTH_CLIENT_SECRET: 'wrong-synthetic-secret-' + 'x'.repeat(32) } });
  assert.equal((await wrong.at('/api/health')).status, 503);
  const paired = await fixture(t);
  assert.equal((await paired.at('/api/health')).status, 200);
  paired.state.authUnavailable = true;
  assert.equal((await paired.at('/api/health')).status, 503);
});

test('concurrent code redemptions issue one pair; racing refreshes both keep the connection', async t => {
  const f = await fixture(t), grant = await f.grant({ exchange: false });
  const codes = await Promise.all([f.post('/oauth/token', grant.tokenForm), f.post('/oauth/token', grant.tokenForm)]);
  assert.deepEqual(codes.map(r => r.status).sort(), [200, 400]);
  const first = await codes.find(r => r.status === 200).json();
  assert.equal((await f.rpc(first.access_token, 'tools/list')).status, 200);
  const request = { grant_type: 'refresh_token', client_id: grant.client.client_id, refresh_token: first.refresh_token };
  const rotated = await Promise.all([f.post('/oauth/token', request), f.post('/oauth/token', request)]);
  assert.deepEqual(rotated.map(r => r.status), [200, 200], 'two processes sharing one credential must not disconnect it');
  for (const response of rotated) {
    assert.equal((await f.rpc((await response.json()).access_token, 'tools/list')).status, 200);
  }
  // Explicit revocation is not a rotation: a revoked token gets no grace.
  const another = await f.grant();
  await f.post('/oauth/revoke', { client_id: another.client.client_id, token: another.refresh_token });
  assert.equal((await f.post('/oauth/token', { grant_type: 'refresh_token', client_id: another.client.client_id,
    refresh_token: another.refresh_token })).status, 400);
});

test('protocol bounds bodies, validates media type and rejects unsafe client redirects', async t => {
  const f = await fixture(t), grant = await f.grant();
  const headers = { Authorization: 'Bearer ' + grant.access_token, Accept: 'application/json, text/event-stream' };
  assert.equal((await f.at('/mcp', { headers })).status, 405);
  assert.equal((await f.at('/mcp', { method: 'POST', headers, body: '{}' })).status, 415);
  const large = await f.at('/mcp', { method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' },
    body: ' '.repeat(MCP_LIMITS.blogBody * 4 + 1) });
  assert.equal(large.status, 413);
  const malformed = await f.at('/mcp', { method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' }, body: '{' });
  assert.equal(malformed.status, 400);
  for (const uri of ['http://outside.example/callback', 'https://outside.example/callback#fragment', 'https://synthetic-user@outside.example/']) {
    assert.equal((await f.at('/oauth/register', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ redirect_uris: [uri] }) })).status, 400);
  }
});

test('blog submissions accept domain-sized bodies without widening the envelope', async t => {
  const f = await fixture(t), grant = await f.grant({ scope: 'blog.write' });
  const headers = { Authorization: 'Bearer ' + grant.access_token, 'Content-Type': 'application/json',
    Accept: 'application/json, text/event-stream', 'MCP-Protocol-Version': '2025-11-25' };
  const body = 'x'.repeat(40 * 1024);
  const uploaded = await f.rpc(grant.access_token, 'tools/call', {
    name: 'blog_upload_image', arguments: { alt: '合成头图',
      data_base64: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+ip1sAAAAASUVORK5CYII=', 'base64').toString('base64') },
  });
  const coverId = uploaded.body?.result?.structuredContent?.id;
  assert.ok(coverId, JSON.stringify(uploaded.body));
  const accepted = await f.rpc(grant.access_token, 'tools/call', {
    name: 'blog_submit', arguments: { slug: 'long-post', title: 'Long post',
      summary: 'Long post summary', body_markdown: body, cover_media_id: coverId, category: 'tech', tags: ['合成'] },
  });
  assert.equal(accepted.status, 200);
  assert.equal(accepted.body?.result?.structuredContent?.status, 'pending');
  assert.equal((await f.blogDb.prepare('SELECT body_markdown FROM blog_drafts WHERE slug=?').bind('long-post').first()).body_markdown.length, body.length);
  const envelope = await f.at('/mcp', { method: 'POST', headers,
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} }) + ' '.repeat(MCP_LIMITS.blogBody * 4 + 1) });
  assert.equal(envelope.status, 413);
  const domain = await f.rpc(grant.access_token, 'tools/call', {
    name: 'blog_submit', arguments: { slug: 'too-long', title: 'Too long',
      summary: 'Too long summary', body_markdown: 'x'.repeat(96 * 1024 + 1) },
  });
  assert.equal(domain.status, 200);
  // A call that names no taxonomy field predates them: it is no longer held to
  // the cover it could never send, and the oversized body is what is named.
  assert.equal(domain.body?.result?.structuredContent?.error, 'invalid_arguments');
  assert.equal(domain.body?.result?.structuredContent?.field, '/body_markdown');
  assert.equal(domain.body?.result?.structuredContent?.reason, 'maxLength');
  const current = await f.rpc(grant.access_token, 'tools/call', {
    name: 'blog_submit', arguments: { slug: 'too-long', title: 'Too long',
      summary: 'Too long summary', body_markdown: 'x'.repeat(96 * 1024 + 1), category: 'tech', tags: ['合成'] },
  });
  assert.equal(current.body?.result?.structuredContent?.error, 'invalid_arguments');
  assert.equal(current.body?.result?.structuredContent?.field, '/cover_media_id');
  assert.equal(current.body?.result?.structuredContent?.reason, 'required');
});

test('a client on the first blog_submit schema reaches the real Blog worker', async t => {
  const f = await fixture(t), grant = await f.grant({ scope: 'blog.write' });
  const uploaded = await f.rpc(grant.access_token, 'tools/call', {
    name: 'blog_upload_image', arguments: { alt: '正文配图',
      data_base64: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+ip1sAAAAASUVORK5CYII=', 'base64').toString('base64') },
  });
  const image = uploaded.body?.result?.structuredContent;
  assert.ok(image?.id, JSON.stringify(uploaded.body));
  // The first schema: one free-text tag, no cover, no category, no tags.
  const submitted = await f.rpc(grant.access_token, 'tools/call', {
    name: 'blog_submit', arguments: { slug: 'legacy-post', title: '旧客户端稿件',
      summary: '旧客户端摘要', tag: '生活感悟', body_markdown: `${image.markdown}\n\n正文内容。`,
      request_id: 'legacy-request' },
  });
  assert.equal(submitted.status, 200);
  const data = submitted.body?.result?.structuredContent;
  assert.equal(data.status, 'pending');
  assert.ok(data.warnings.some(warning => /分类/.test(warning)), JSON.stringify(data.warnings));
  const row = await f.blogDb.prepare('SELECT cover_media_id,category,tags FROM blog_drafts WHERE slug=?').bind('legacy-post').first();
  assert.equal(row.cover_media_id, image.id);
  assert.equal(row.category, null);
  assert.deepEqual(JSON.parse(row.tags), ['生活感悟']);
  // The same client once it names a category but still the old single tag.
  const hybrid = await f.rpc(grant.access_token, 'tools/call', {
    name: 'blog_submit', arguments: { slug: 'hybrid-post', title: '旧客户端稿件',
      summary: '旧客户端摘要', tag: '生活感悟', body_markdown: `${image.markdown}\n\n正文内容。`,
      cover_media_id: image.id, category: 'tech', request_id: 'hybrid-request' },
  });
  assert.equal(hybrid.body?.result?.structuredContent?.status, 'pending', JSON.stringify(hybrid.body));
  const hybridRow = await f.blogDb.prepare('SELECT cover_media_id,category,tags FROM blog_drafts WHERE slug=?').bind('hybrid-post').first();
  assert.equal(hybridRow.cover_media_id, image.id);
  assert.equal(hybridRow.category, 'tech');
  assert.deepEqual(JSON.parse(hybridRow.tags), ['生活感悟']);
  // The same request over the official SDK transport, the way a connector
  // that cached the first schema talks to the server.
  const client = new Client({ name: 'codepi-legacy-test', version: '1.0.0' });
  t.after(() => client.close());
  await client.connect(new StreamableHTTPClientTransport(new URL(ORIGIN + '/mcp'), {
    fetch: f.fetch, requestInit: { headers: { Authorization: 'Bearer ' + grant.access_token } },
  }));
  const sdk = await client.callTool({ name: 'blog_submit', arguments: {
    slug: 'legacy-sdk-post', title: '旧客户端稿件', summary: '旧客户端摘要', tag: '生活感悟',
    body_markdown: `${image.markdown}\n\n正文内容。`, request_id: 'legacy-sdk-request' } });
  assert.equal(sdk.structuredContent.status, 'pending', JSON.stringify(sdk.structuredContent));
  const sdkRow = await f.blogDb.prepare('SELECT cover_media_id,category,tags FROM blog_drafts WHERE slug=?').bind('legacy-sdk-post').first();
  assert.equal(sdkRow.cover_media_id, image.id);
  assert.deepEqual(JSON.parse(sdkRow.tags), ['生活感悟']);
});

test('only unified MCP accepts grants while Health exposes data through RPC', async t => {
  const f = await fixture(t), grant = await f.grant();
  const legacyToken = 'synthetic-retired-health-token';
  await f.healthDb.prepare("INSERT INTO users(id) VALUES ('health-owner')").run();
  await f.healthDb.prepare(`INSERT INTO oauth_clients(client_id,client_name,redirect_uris)
    VALUES ('old-client','Old synthetic client','[]')`).run();
  await f.healthDb.prepare(`INSERT INTO mcp_tokens(token_hash,user_id,client_id,kind,expires_at)
    VALUES (?,'health-owner','old-client','access',?)`).bind(await hash(legacyToken), Date.now() + 3600000).run();
  assert.equal((await f.rpc(legacyToken, 'tools/list')).status, 401, 'Health grants cannot authorize unified MCP');
  for (const path of ['/mcp', '/.well-known/oauth-protected-resource/mcp', '/.well-known/oauth-authorization-server',
    '/oauth/register', '/oauth/authorize', '/oauth/token', '/oauth/revoke', '/api/me/connections']) {
    const response = await f.health.fetch('https://health.example' + path);
    assert.equal(response.status, 404);
    assert.match(response.headers.get('Content-Type'), /application\/json/);
    assert.deepEqual(await response.json(), { error: 'not found' });
  }
  assert.equal((await f.health.fetch('https://health.example/api/health')).status, 200);
  const catalog = await f.tool(grant.access_token, 'health_get_catalog');
  assert.equal(catalog.isError, undefined);
});
