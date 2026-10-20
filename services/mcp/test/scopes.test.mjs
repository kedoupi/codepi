import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fixture, ORIGIN } from './runtime.mjs';

test('chosen scope is persisted, empty selection preserves consent and expansion is rejected', async t => {
  const f = await fixture(t);
  const pending = await f.grant({ scope: 'context.read projects.read health.read', consentOnly: true });
  const { scope: _, ...empty } = pending.approval;
  const headers = { Origin: ORIGIN, Cookie: pending.cookie };
  const none = await f.post('/oauth/authorize', empty, headers);
  assert.equal(none.status, 200);
  assert.match(await none.text(), /至少选择一项/);
  const bad = await f.post('/oauth/authorize', { ...empty, scope: 'me.read' }, headers);
  assert.equal(bad.status, 403);
  assert.equal((await bad.json()).error, 'invalid_scope');
  assert.equal((await f.post('/oauth/authorize', { ...empty, scope: 'context.read' }, headers)).status, 302);
  const saved = await f.db.prepare('SELECT scope FROM oauth_auth_codes').first();
  assert.equal(saved.scope, 'context.read');
  assert.match(pending.html, /value="health.read">/);
  assert.match(pending.html, /value="projects.read" checked/);
});

test('refresh can shrink but cannot expand, and connection display unions live families', async t => {
  const f = await fixture(t), grant = await f.grant({ scope: 'context.read projects.read projects.write' });
  const request = { grant_type: 'refresh_token', client_id: grant.client.client_id, refresh_token: grant.refresh_token };
  const expanded = await f.post('/oauth/token', { ...request, scope: 'context.read me.read' });
  assert.equal((await expanded.json()).error, 'invalid_scope');
  const reduced = await f.post('/oauth/token', { ...request, scope: 'projects.read' });
  assert.equal(reduced.status, 200);
  const pair = await reduced.json();
  assert.equal(pair.scope, 'projects.read');
  const names = (await f.rpc(pair.access_token, 'tools/list')).body.result.tools.map(t => t.name);
  assert.deepEqual(names, ['list_data_sources', 'projects_list', 'project_get']);
  await f.grant({ scope: 'me.read', client: grant.client });
  const connections = await (await f.at('/connections', { headers: { Cookie: grant.cookie } })).text();
  assert.match(connections, /projects.read me.read/);
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

test('context-only clients see no domain data and legacy Health grants still work', async t => {
  const f = await fixture(t), context = await f.grant({ scope: 'context.read' });
  assert.deepEqual((await f.rpc(context.access_token, 'tools/list')).body.result.tools.map(t => t.name),
    ['list_data_sources', 'get_context']);
  assert.deepEqual((await f.tool(context.access_token, 'get_context')).structuredContent.sources, []);
  const legacy = await f.grant();
  assert.equal((await f.rpc(legacy.access_token, 'tools/list')).body.result.tools.length, 5);
  assert.equal((await f.tool(legacy.access_token, 'health_get_catalog')).isError, undefined);
});
