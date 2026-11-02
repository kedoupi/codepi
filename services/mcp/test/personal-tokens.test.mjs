import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fixture, hash, ORIGIN } from './runtime.mjs';

const csrf = html => html.match(/name="csrf_token" value="([^"]+)"/)[1];
test('owner issues scoped PAT once, uses it without OAuth, then revokes or expires it', async t => {
  const f = await fixture(t);
  assert.equal((await f.at('/connections/tokens')).status, 302);
  const cookie = await f.login(), headers = { Cookie: cookie, Origin: ORIGIN };
  const screen = await (await f.at('/connections/tokens', { headers })).text();
  const fields = { action: 'create', name: '<script>agent</script>', days: '30', scope: 'projects.read', csrf_token: csrf(screen) };
  assert.equal((await f.post('/connections/tokens', { ...fields, csrf_token: 'wrong' }, headers)).status, 403);
  assert.equal((await f.post('/connections/tokens', fields, { ...headers, Origin: 'https://evil.example' })).status, 403);
  const created = await f.post('/connections/tokens', fields, headers);
  assert.equal(created.status, 200);
  const html = await created.text(), token = html.match(/kdp_pat_[A-Za-z0-9_-]{43}/)[0];
  assert.ok(!html.includes('<script>agent</script>'));
  const stored = await f.db.prepare('SELECT * FROM mcp_personal_tokens').first();
  assert.notEqual(stored.token_hash, token);
  // A personal token carries the full scope set, exactly like the OAuth
  // grant: the old per-scope checkboxes never narrowed it.
  assert.equal(stored.scope, f.allScopes);
  assert.equal((await f.rpc(token, 'tools/list')).status, 200);
  assert.ok((await f.rpc(token, 'tools/list')).body.result.tools.some(tool => tool.name === 'blog_submit'));
  assert.equal(Boolean((await f.tool(token, 'memory_search', { query: 'test' })).isError), false);
  assert.ok(!(await (await f.at('/connections/tokens', { headers })).text()).includes(token));
  await f.db.prepare('UPDATE mcp_personal_tokens SET expires_at=0').run();
  assert.equal((await f.rpc(token, 'tools/list')).status, 401);
  await f.db.prepare('UPDATE mcp_personal_tokens SET expires_at=?').bind(Date.now() + 60000).run();
  const revoked = await f.post('/connections/tokens', { action: 'revoke', token_id: stored.token_id, csrf_token: csrf(screen) }, headers);
  assert.equal(revoked.status, 303);
  assert.equal((await f.rpc(token, 'tools/list')).status, 401);
  const now = Date.now();
  for (let i = 0; i < 20; i++) await f.db.prepare(`INSERT INTO mcp_personal_tokens
    (token_id,token_hash,user_id,name,scope,expires_at) VALUES(?,?,?,?,?,?)`)
    .bind(`pat_limit_${i}`, `hash-${i}`, 'kdp-owner', `limit ${i}`, 'projects.read', now + 60000).run();
  const limited = await f.post('/connections/tokens', fields, headers);
  assert.equal(limited.status, 409);
  assert.equal((await limited.text()).includes('kdp_pat_'), false);
  assert.equal((await f.db.prepare('SELECT COUNT(*) n FROM mcp_personal_tokens WHERE revoked_at IS NULL').first()).n, 20);
});

test('a personal token issued before a scope existed still reaches the new tools', async t => {
  const f = await fixture(t);
  const token = `kdp_pat_${'A'.repeat(43)}`;
  await f.db.prepare(`INSERT INTO mcp_personal_tokens (token_id,token_hash,user_id,name,scope,expires_at)
    VALUES (?,?,?,?,?,?)`)
    .bind('pat_legacy', await hash(token), 'kdp-owner', 'Legacy token', 'projects.read', Date.now() + 60000).run();
  const listed = await f.rpc(token, 'tools/list');
  assert.equal(listed.status, 200);
  assert.ok(listed.body.result.tools.some(tool => tool.name === 'blog_submit'),
    'an old token keeps working on tools its stored scope never named');
});

test('manual client registration supplies credentials usable by the OAuth flow', async t => {
  const f = await fixture(t), cookie = await f.login(), headers = { Cookie: cookie, Origin: ORIGIN };
  const html = await (await f.at('/connections/clients', { headers })).text();
  const registered = await f.post('/connections/clients', { name: 'Manual agent', redirect_uris: 'https://agent.example/cb',
    method: 'client_secret_post', csrf_token: csrf(html) }, headers);
  assert.equal(registered.status, 200);
  const result = await registered.text();
  assert.match(result, /Client ID/);
  const row = await f.db.prepare("SELECT client_id FROM oauth_clients WHERE client_name='Manual agent'").first();
  assert.ok(result.includes(row.client_id));
  const secret = result.match(/aria-label="Client secret">([^<]+)/)[1];
  const grant = await f.grant({ client: { client_id: row.client_id, client_secret: secret },
    registeredRedirect: 'https://agent.example/cb', redirectUri: 'https://agent.example/cb' });
  assert.equal((await f.rpc(grant.access_token, 'tools/list')).status, 200);
});
