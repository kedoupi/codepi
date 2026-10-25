import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fixture, ORIGIN } from './runtime.mjs';

const register = (f, body) => f.at('/oauth/register', { method: 'POST',
  headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

const list = (f, token, headers = {}, path = '/mcp') => f.at(path, { method: 'POST', headers: {
  Authorization: 'Bearer ' + token, 'Content-Type': 'application/json', ...headers,
}, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }) });

test('clients that only accept JSON, any type or nothing still get JSON-RPC replies', async t => {
  const f = await fixture(t), grant = await f.grant();
  for (const accept of [undefined, 'application/json', '*/*', 'text/event-stream']) {
    const response = await list(f, grant.access_token, accept ? { Accept: accept } : {});
    assert.equal(response.status, 200, String(accept));
    assert.match(response.headers.get('Content-Type'), /application\/json/);
    assert.ok((await response.json()).result.tools.length > 0);
  }
  const slash = await list(f, grant.access_token, {}, '/mcp/');
  assert.equal(slash.status, 200, 'a pasted trailing slash reaches the same endpoint');
  const anonymous = await f.at('/mcp/', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
  assert.equal(anonymous.status, 401);
  assert.match(anonymous.headers.get('WWW-Authenticate'), /resource_metadata=/);
});

test('resource indicators accept origin and trailing-slash forms but no other audience', async t => {
  const f = await fixture(t);
  for (const resource of [ORIGIN, ORIGIN + '/', ORIGIN + '/mcp/']) {
    const pending = await f.grant({ exchange: false });
    const exchanged = await f.post('/oauth/token', { ...pending.tokenForm, resource });
    assert.equal(exchanged.status, 200, resource);
  }
  const pending = await f.grant({ exchange: false });
  for (const resource of ['https://mcp.example.evil/mcp', ORIGIN + '/other', 'https://health.example/mcp']) {
    const denied = await f.post('/oauth/token', { ...pending.tokenForm, resource });
    assert.equal((await denied.json()).error, 'invalid_target', resource);
  }
});

test('confidential registrations authenticate with Basic or body secrets and keep PKCE', async t => {
  const f = await fixture(t);
  const metadata = await (await f.at('/.well-known/oauth-authorization-server')).json();
  assert.deepEqual(metadata.token_endpoint_auth_methods_supported, ['none', 'client_secret_post', 'client_secret_basic']);
  const registered = await register(f, { redirect_uris: ['https://agent.example/callback'], token_endpoint_auth_method: 'client_secret_basic' });
  assert.equal(registered.status, 201);
  const client = await registered.json();
  assert.equal(client.token_endpoint_auth_method, 'client_secret_basic');
  assert.ok(client.client_secret?.length >= 43);
  const stored = await f.db.prepare('SELECT client_secret_hash FROM oauth_clients WHERE client_id=?').bind(client.client_id).first();
  assert.notEqual(stored.client_secret_hash, client.client_secret, 'only the secret hash is stored');

  const pending = await f.grant({ exchange: false, client, registeredRedirect: client.redirect_uris[0], redirectUri: client.redirect_uris[0] });
  const { client_id, client_secret, ...form } = pending.tokenForm;
  const basic = secret => ({ Authorization: 'Basic ' + btoa(`${encodeURIComponent(client_id)}:${encodeURIComponent(secret)}`) });
  const wrong = await f.post('/oauth/token', form, basic('wrong-secret'));
  assert.equal(wrong.status, 401);
  assert.equal((await wrong.json()).error, 'invalid_client');
  assert.equal((await f.post('/oauth/token', { ...form, client_id })).status, 401, 'a confidential client cannot drop its secret');
  const exchanged = await f.post('/oauth/token', form, basic(client_secret));
  assert.equal(exchanged.status, 200, 'Basic credentials replace client_id in the body');
  const pair = await exchanged.json();
  const refreshed = await f.post('/oauth/token', { grant_type: 'refresh_token', refresh_token: pair.refresh_token,
    client_id, client_secret });
  assert.equal(refreshed.status, 200, 'client_secret_post also authenticates');
  const next = await refreshed.json();
  assert.equal((await f.post('/oauth/revoke', { token: next.access_token }, basic('wrong-secret'))).status, 401);
  assert.equal((await f.post('/oauth/revoke', { token: next.access_token }, basic(client_secret))).status, 200);
  assert.equal((await list(f, next.access_token)).status, 401);
  assert.equal((await register(f, { redirect_uris: ['https://agent.example/cb'], token_endpoint_auth_method: 'private_key_jwt' })).status, 400);
});

test('public clients may authenticate with a Basic header that carries only the client id', async t => {
  const f = await fixture(t), pending = await f.grant({ exchange: false });
  const { client_id, ...form } = pending.tokenForm;
  const exchanged = await f.post('/oauth/token', form, { Authorization: 'Basic ' + btoa(`${client_id}:`) });
  assert.equal(exchanged.status, 200);
});

test('IDE private-use scheme callbacks register while dangerous schemes stay rejected', async t => {
  const f = await fixture(t);
  for (const uri of ['cursor://anysphere.cursor-retrieval/oauth/callback', 'vscode://vscode.github-authentication/did-authenticate',
    'com.example.agent:/oauth2redirect']) {
    assert.equal((await register(f, { redirect_uris: [uri] })).status, 201, uri);
  }
  const custom = 'cursor://anysphere.cursor-retrieval/oauth/callback';
  const pending = await f.grant({ registeredRedirect: custom, redirectUri: custom });
  assert.ok(pending.access_token, 'the private-use scheme completes the full PKCE flow');
  for (const uri of ['javascript:alert(1)', 'data:text/html,x', 'file:///etc/passwd', 'http://outside.example/cb',
    'cursor://host/cb#fragment', 'ws://localhost/cb']) {
    assert.equal((await register(f, { redirect_uris: [uri] })).status, 400, uri);
  }
});
