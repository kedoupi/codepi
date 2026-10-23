import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fixture, ORIGIN } from './runtime.mjs';

test('one owner login grants every supported scope without per-scope selection', async t => {
  const f = await fixture(t);
  const pending = await f.grant({ scope: 'context.read projects.read health.read', consentOnly: true });
  const headers = { Origin: ORIGIN, Cookie: pending.cookie };
  assert.doesNotMatch(pending.html, /<input[^>]+name="scope"/);
  for (const scope of f.allScopes.split(' ')) assert.ok(pending.html.includes(scope), scope);
  const approved = await f.post('/oauth/authorize', pending.approval, headers);
  assert.equal(approved.status, 200, 'approval returns a same-origin handoff page instead of a form redirect');
  assert.match(await approved.text(), /meta http-equiv="refresh"/);
  const consent = await f.db.prepare('SELECT scope FROM oauth_consent_requests').first();
  assert.equal(consent.scope, f.allScopes);
  const saved = await f.db.prepare('SELECT scope FROM oauth_auth_codes').first();
  assert.equal(saved.scope, f.allScopes);
});

test('refresh upgrades legacy partial grants and connection display unions live families', async t => {
  const f = await fixture(t), grant = await f.grant({ scope: 'context.read projects.read projects.write' });
  const request = { grant_type: 'refresh_token', client_id: grant.client.client_id, refresh_token: grant.refresh_token };
  const unknown = await f.post('/oauth/token', { ...request, scope: 'unknown.scope' });
  assert.equal((await unknown.json()).error, 'invalid_scope');
  const upgraded = await f.post('/oauth/token', { ...request, scope: 'projects.read' });
  assert.equal(upgraded.status, 200);
  const pair = await upgraded.json();
  assert.equal(pair.scope, f.allScopes);
  const names = (await f.rpc(pair.access_token, 'tools/list')).body.result.tools.map(t => t.name);
  for (const name of ['project_handoff_save', 'health_get_sync_status', 'memory_save', 'invest_get_portfolio', 'blog_list']) {
    assert.ok(names.includes(name), name);
  }
  await f.grant({ scope: 'me.read', client: grant.client });
  const connections = await (await f.at('/connections', { headers: { Cookie: grant.cookie } })).text();
  assert.ok(connections.includes(f.allScopes));
});

test('loopback port variation is allowed but authorization code binds the actual callback', async t => {
  const f = await fixture(t);
  const pending = await f.grant({ exchange: false, registeredRedirect: 'http://127.0.0.1/callback',
    redirectUri: 'http://127.0.0.1:49152/callback' });
  assert.equal((await f.post('/oauth/token', { ...pending.tokenForm, redirect_uri: 'http://127.0.0.1:49153/callback' })).status, 400);
  assert.equal((await f.post('/oauth/token', pending.tokenForm)).status, 200);
  for (const candidate of ['http://127.0.0.1:49153/other', 'http://127.0.0.1:49153/callback?other=1',
    'http://localhost:49153/callback', 'https://127.0.0.1:49153/callback', 'http://[::1]:49153/callback']) {
    const response = await f.at('/oauth/authorize?' + new URLSearchParams({
      client_id: pending.client.client_id, redirect_uri: candidate,
    }));
    assert.equal(response.status, 400, candidate);
    assert.equal((await response.json()).error, 'invalid_redirect_uri');
  }
});

test('normalizeScope accepts blog scopes and still rejects unknown scopes', async t => {
  const f = await fixture(t);
  const grant = await f.grant({ scope: 'blog.read' });
  assert.equal((await f.rpc(grant.access_token, 'tools/list')).body.result.tools.map(t => t.name).includes('blog_list'), true);
  const denied = await f.post('/oauth/token', { grant_type: 'refresh_token', client_id: grant.client.client_id,
    refresh_token: grant.refresh_token, scope: 'blog.read unknown.scope' });
  assert.equal((await denied.json()).error, 'invalid_scope');
});

test('context-only clients see no domain data and legacy Health grants still work', async t => {
  const f = await fixture(t), context = await f.grant({ scope: 'context.read' });
  assert.deepEqual((await f.rpc(context.access_token, 'tools/list')).body.result.tools.map(t => t.name),
    ['list_data_sources', 'get_context']);
  assert.deepEqual((await f.tool(context.access_token, 'get_context')).structuredContent.sources, []);
  const legacy = await f.grant();
  assert.equal((await f.rpc(legacy.access_token, 'tools/list')).body.result.tools.length, 5);
  assert.equal((await f.tool(legacy.access_token, 'health_get_catalog')).isError, undefined);
});
