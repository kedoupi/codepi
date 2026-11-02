import assert from 'node:assert/strict';
import { test } from 'node:test';
import { setTimeout as sleep } from 'node:timers/promises';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js';
import { fixture, hash, ORIGIN } from './runtime.mjs';

const bearer = token => ({ Authorization: 'Bearer ' + token });
const csrf = html => html.match(/name="csrf_token" value="([^"]+)"/)[1];

/** Opens a raw stream and returns the announced endpoint plus a reader for later events. */
async function open(f, token) {
  const controller = new AbortController();
  const response = await f.fetch(ORIGIN + '/sse', { headers: { ...bearer(token), Accept: 'text/event-stream' }, signal: controller.signal });
  assert.equal(response.status, 200);
  assert.match(response.headers.get('Content-Type'), /^text\/event-stream/);
  const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = '';
  async function next() {
    for (;;) {
      const end = buffer.indexOf('\n\n');
      if (end >= 0) {
        const block = buffer.slice(0, end); buffer = buffer.slice(end + 2);
        if (block.startsWith(':')) continue;
        const event = block.match(/^event: (.*)$/m)?.[1], data = block.match(/^data: (.*)$/m)?.[1];
        return { event, data };
      }
      const { value, done } = await reader.read();
      if (done) return null;
      buffer += value;
    }
  }
  const first = await next();
  assert.equal(first.event, 'endpoint');
  return { endpoint: first.data, next, close: () => controller.abort() };
}

const post = (f, endpoint, token, body, headers = {}) => f.fetch(new URL(endpoint, ORIGIN), { method: 'POST',
  headers: { ...(token ? bearer(token) : {}), 'Content-Type': 'application/json', ...headers },
  body: typeof body === 'string' ? body : JSON.stringify(body) });

/**
 * Local workerd does not cancel a Durable Object body when the client aborts, so
 * the disconnect surfaces as unread backpressure: replies pile up until the
 * unread cap ends the session. Production cancellation takes the faster path.
 */
async function closed(f, endpoint, token) {
  for (let i = 0; i < 200; i++) {
    const response = await post(f, endpoint, token, { jsonrpc: '2.0', id: i, method: 'tools/list' });
    if (response.status === 404) return true;
    assert.equal(response.status, 202);
  }
  return false;
}

test('a personal access token opens SSE and stops working once revoked', async t => {
  const f = await fixture(t), cookie = await f.login(), headers = { Cookie: cookie, Origin: ORIGIN };
  const screen = await (await f.at('/connections/tokens', { headers })).text();
  const token = csrf(screen);
  const created = await f.post('/connections/tokens', { action: 'create', name: 'SSE agent', days: '7',
    scope: 'health.read', csrf_token: token }, headers);
  const pat = (await created.text()).match(/kdp_pat_[A-Za-z0-9_-]{43}/)[0];
  const stream = await open(f, pat);
  t.after(stream.close);
  const listed = await post(f, stream.endpoint, pat, { jsonrpc: '2.0', id: 1, method: 'tools/list' });
  assert.equal(listed.status, 202);
  const reply = JSON.parse((await stream.next()).data);
  assert.ok(reply.result.tools.some(tool => tool.name === 'health_get_catalog'));
  // A personal token carries the full scope set, so it reaches blog writes
  // whatever the old form recorded for it.
  assert.ok(reply.result.tools.some(tool => tool.name === 'blog_submit'));
  const query = await f.fetch(ORIGIN + '/sse?access_token=' + pat, { headers: { Accept: 'text/event-stream' } });
  assert.equal(query.status, 401, 'a query-string token is never accepted');
  const row = await f.db.prepare('SELECT token_id FROM mcp_personal_tokens').first();
  await f.post('/connections/tokens', { action: 'revoke', token_id: row.token_id, csrf_token: token }, headers);
  assert.equal((await post(f, stream.endpoint, pat, { jsonrpc: '2.0', id: 2, method: 'tools/list' })).status, 401);
});

test('SDK SSEClientTransport initializes, lists and calls tools across separate POSTs', async t => {
  const f = await fixture(t), grant = await f.grant({ scope: 'health.read' });
  const transport = new SSEClientTransport(new URL(ORIGIN + '/sse'), {
    fetch: (url, init) => f.fetch(url, init),
    requestInit: { headers: bearer(grant.access_token) },
  });
  const client = new Client({ name: 'legacy-sse-test', version: '1.0.0' });
  await client.connect(transport);
  assert.equal(client.getServerVersion().name, 'codepi');
  const { tools } = await client.listTools();
  assert.ok(tools.some(tool => tool.name === 'list_data_sources'));
  const called = await client.callTool({ name: 'list_data_sources', arguments: {} });
  assert.ok(!called.isError, JSON.stringify(called));
  assert.deepEqual(called.structuredContent.sources.map(s => s.id), ['health']);
  await client.close();
});

test('endpoint is the Durable Object id, replies arrive on the stream and notifications pass through', async t => {
  const f = await fixture(t), grant = await f.grant();
  const stream = await open(f, grant.access_token);
  t.after(stream.close);
  assert.match(stream.endpoint, /^\/messages\?sessionId=[0-9a-f]{64}$/);
  const init = await post(f, stream.endpoint, grant.access_token, { jsonrpc: '2.0', id: 1, method: 'initialize',
    params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'raw', version: '1' } } });
  assert.equal(init.status, 202);
  const reply = await stream.next();
  assert.equal(reply.event, 'message');
  assert.equal(JSON.parse(reply.data).id, 1);
  assert.equal(JSON.parse(reply.data).result.serverInfo.name, 'codepi');
  const notification = await post(f, stream.endpoint, grant.access_token, { jsonrpc: '2.0', method: 'notifications/initialized' });
  assert.equal(notification.status, 202, 'the stateless handler answers notifications with 202');
  const wrongType = await post(f, stream.endpoint, grant.access_token, 'x', { 'Content-Type': 'text/plain' });
  assert.equal(wrongType.status, 415);
  const huge = await post(f, stream.endpoint, grant.access_token, 'x'.repeat(1 << 20));
  assert.equal(huge.status, 413, 'the mcp() body limit applies');
});

test('streams and messages require the same live grant; a session id alone is not enough', async t => {
  const f = await fixture(t);
  const anonymous = await f.fetch(ORIGIN + '/sse', { headers: { Accept: 'text/event-stream' } });
  assert.equal(anonymous.status, 401);
  assert.match(anonymous.headers.get('WWW-Authenticate'), /resource_metadata=/);
  assert.equal((await f.fetch(ORIGIN + '/sse', { headers: bearer('A'.repeat(43)) })).status, 401);

  const owner = await f.grant(), other = await f.grant();
  const stream = await open(f, owner.access_token);
  t.after(stream.close);
  const ping = { jsonrpc: '2.0', id: 2, method: 'ping' };
  assert.equal((await post(f, stream.endpoint, null, ping)).status, 401);
  assert.equal((await post(f, stream.endpoint, 'A'.repeat(43), ping)).status, 401);
  const mismatch = await post(f, stream.endpoint, other.access_token, ping);
  assert.equal(mismatch.status, 403, 'a different client cannot use another session');
  assert.equal((await mismatch.json()).error, 'session_grant_mismatch');

  await f.db.prepare('UPDATE mcp_tokens SET revoked_at=? WHERE token_hash=?')
    .bind(Date.now(), await hash(owner.access_token)).run();
  assert.equal((await post(f, stream.endpoint, owner.access_token, ping)).status, 401, 'revocation applies to an open stream');

  for (const sessionId of ['', 'nope', '0'.repeat(64)]) {
    const response = await post(f, '/messages?sessionId=' + sessionId, other.access_token, ping);
    assert.equal(response.status, 404, sessionId);
  }
});

test('disconnect and the session lifetime destroy the session; reconnect gets a new id', async t => {
  const f = await fixture(t), grant = await f.grant({ scope: f.allScopes });
  const first = await open(f, grant.access_token);
  first.close();
  await sleep(50);
  assert.ok(await closed(f, first.endpoint, grant.access_token), 'a cancelled stream releases its session');

  const second = await open(f, grant.access_token);
  t.after(second.close);
  assert.notEqual(second.endpoint, first.endpoint, 'reconnecting creates a fresh session');

  // The lifetime never outlives the access token; a near-expiry grant shows the timer firing.
  await f.db.prepare('UPDATE mcp_tokens SET expires_at=? WHERE token_hash=?')
    .bind(Date.now() + 1500, await hash(grant.access_token)).run();
  const short = await open(f, grant.access_token);
  t.after(short.close);
  assert.equal(await short.next(), null, 'the stream ends when its lifetime elapses');
});

test('an open session survives a scope upgrade and refuses a narrowed grant', async t => {
  const f = await fixture(t);
  const ping = { jsonrpc: '2.0', id: 1, method: 'ping' };
  // A grant authorized before the full scope set existed keeps its stream
  // when the refresh path upgrades it to every scope.
  const legacy = await f.grant({ scope: 'health.read' });
  const upgraded = await open(f, legacy.access_token);
  t.after(upgraded.close);
  await f.db.prepare('UPDATE mcp_tokens SET scope=? WHERE token_hash=?')
    .bind(f.allScopes, await hash(legacy.access_token)).run();
  assert.equal((await post(f, upgraded.endpoint, legacy.access_token, ping)).status, 202,
    'a wider grant still covers the scope the session opened with');
  // A grant that no longer holds every bound scope cannot use the session.
  const full = await f.grant({ scope: f.allScopes });
  const narrowed = await open(f, full.access_token);
  t.after(narrowed.close);
  await f.db.prepare('UPDATE mcp_tokens SET scope=? WHERE token_hash=?')
    .bind('health.read', await hash(full.access_token)).run();
  const refused = await post(f, narrowed.endpoint, full.access_token, ping);
  assert.equal(refused.status, 403);
  assert.equal((await refused.json()).error, 'session_grant_mismatch');
});
