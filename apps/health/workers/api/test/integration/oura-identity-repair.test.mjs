import assert from 'node:assert/strict';
import { test } from 'node:test';
import { centralFixture, connectOura, createRuntime, loginSso, migrate } from './runtime.mjs';

const origin = 'https://oura.example';

async function fixture(t) {
  const provider = { id: 'test-user', email: 'owner@example.invalid' };
  const central = centralFixture();
  const runtime = createRuntime({
    sso: true, serviceBindings: { AUTH: central.fetch },
    providerResponse: url => url.pathname.endsWith('/personal_info') ? Response.json(provider) : undefined,
  });
  t.after(() => runtime.dispose());
  await migrate(runtime);
  const db = await runtime.getD1Database('DB');
  await db.prepare("INSERT INTO users(id,oura_user_id,email) VALUES ('test-user','test-user','owner@example.invalid')").run();
  const cookie = await loginSso(runtime);
  const request = (path, init = {}, session = cookie) => runtime.dispatchFetch(origin + path, {
    redirect: 'manual', ...init, headers: { Cookie: session, ...init.headers },
  });
  async function start(session = cookie) {
    const response = await request('/api/auth/oura/start', {
      method: 'POST', headers: { Origin: origin }, body: new URLSearchParams({ intent: 'repair_identity' }),
    }, session);
    assert.equal(response.status, 302);
    return {
      state: new URL(response.headers.get('Location')).searchParams.get('state'),
      cookie: response.headers.get('Set-Cookie').split(';')[0],
    };
  }
  const finish = (tx, session = cookie, query = '') =>
    request(`/api/auth/oura/callback?code=synthetic-code&state=${tx.state}${query}`, {
      headers: { Cookie: `${session}; ${tx.cookie}` },
    });
  return { runtime, db, cookie, provider, request, start, finish };
}

test('explicit same-email owner repair updates only provider binding and encrypted grant, retaining history and MCP', async t => {
  const f = await fixture(t);
  await connectOura(f.runtime, f.cookie);
  await f.request('/api/me/daily');
  await f.db.prepare("INSERT INTO health_records VALUES ('test-user','personal_info','old-profile','','{}','2000-01-01')").run();
  await f.db.prepare("INSERT INTO user_prefs(user_id,locale) VALUES ('test-user','zh')").run();
  await f.db.prepare("INSERT INTO oauth_clients(client_id,client_name,redirect_uris) VALUES ('existing-client','Existing app','[]')").run();
  await f.db.prepare(`INSERT INTO mcp_tokens(token_hash,user_id,client_id,kind,expires_at)
    VALUES ('synthetic-hash','test-user','existing-client','access',?)`).bind(Date.now() + 3600000).run();
  await f.db.prepare(`INSERT INTO auto_sync_state(user_id,status,last_error,payload,lease_id,lease_until)
    VALUES ('test-user','blocked','reconnect_required',?,'old-lease',?)`)
    .bind(JSON.stringify([{ collection: 'sleep', state: 'unavailable', error: 'upstream_access_denied' }]), Date.now() + 120000).run();
  await f.db.prepare("UPDATE sync_state SET last_error='reconnect_required' WHERE user_id='test-user'").run();
  const history = await f.db.prepare("SELECT * FROM daily_cache ORDER BY day").all();
  const tx = await f.start();
  const consent = await f.db.prepare("SELECT repair_from_provider_id,initiator_user_id FROM oauth_states").first();
  assert.deepEqual(consent, { repair_from_provider_id: 'test-user', initiator_user_id: 'test-user' });
  f.provider.id = 'new-provider-identifier';
  const callback = await f.finish(tx);
  assert.equal(callback.headers.get('Location'), '/settings');
  assert.deepEqual(await f.db.prepare('SELECT id,oura_user_id,email FROM users').first(), {
    id: 'test-user', oura_user_id: f.provider.id, email: f.provider.email,
  });
  assert.deepEqual((await f.db.prepare("SELECT * FROM daily_cache ORDER BY day").all()).results, history.results);
  for (const table of ['users', 'encrypted_tokens', 'health_records', 'user_prefs', 'oauth_clients', 'mcp_tokens']) {
    assert.equal((await f.db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).first()).n, 1, table);
  }
  const sync = await f.db.prepare('SELECT status,last_error,lease_id,payload FROM auto_sync_state').first();
  assert.equal(sync.status, 'running');
  assert.equal(sync.last_error, null);
  assert.notEqual(sync.lease_id, 'old-lease');
  assert.equal(JSON.parse(sync.payload)[0].state, 'pending');
  assert.equal((await f.db.prepare('SELECT last_error FROM sync_state').first()).last_error, null);
  assert.equal((await (await f.request('/api/me')).json()).ouraConnection.status, 'connected');
  // The grant is encrypted under the unchanged local owner ID/AAD.
  assert.equal((await f.request('/api/me/daily')).status, 200);
  assert.match((await f.finish(tx)).headers.get('Location'), /invalid_state/);
});

test('repair requires same-origin POST and an authenticated SSO owner', async t => {
  const f = await fixture(t);
  const body = () => new URLSearchParams({ intent: 'repair_identity' });
  for (const headers of [{}, { Origin: 'https://evil.example' }]) {
    assert.equal((await f.request('/api/auth/oura/start', { method: 'POST', headers, body: body() })).status, 403);
  }
  assert.equal((await f.request('/api/auth/oura/start', {
    method: 'POST', headers: { Origin: origin }, body: body(),
  }, '')).status, 401);
  assert.equal((await f.request('/api/auth/oura/start', {
    method: 'POST', headers: { Origin: origin }, body: new URLSearchParams({ intent: 'unknown' }),
  })).status, 400);
  assert.equal((await f.db.prepare('SELECT COUNT(*) AS n FROM oauth_states').first()).n, 0);
});

for (const email of ['other@example.invalid', ' OWNER@example.invalid ', null, '']) {
  test(`explicit repair rejects nonmatching or unavailable provider email (${JSON.stringify(email)})`, async t => {
    const f = await fixture(t);
    await connectOura(f.runtime, f.cookie);
    const before = await f.db.prepare('SELECT ciphertext,iv FROM encrypted_tokens').first();
    const tx = await f.start();
    f.provider.id = 'new-provider-identifier';
    f.provider.email = email;
    assert.match((await f.finish(tx)).headers.get('Location'), /oura_account_mismatch/);
    assert.equal((await f.db.prepare('SELECT oura_user_id FROM users').first()).oura_user_id, 'test-user');
    assert.deepEqual(await f.db.prepare('SELECT ciphertext,iv FROM encrypted_tokens').first(), before);
  });
}

test('repair consent cannot move to another session or survive a changed provider binding', async t => {
  const f = await fixture(t);
  f.provider.id = 'new-provider-identifier';
  const other = await loginSso(f.runtime);
  const tx = await f.start();
  assert.match((await f.finish(tx, other)).headers.get('Location'), /invalid_state/);
  const next = await f.start();
  await f.db.prepare("UPDATE users SET oura_user_id='concurrent-provider'").run();
  assert.match((await f.finish(next)).headers.get('Location'), /oura_account_mismatch/);
  assert.equal((await f.db.prepare('SELECT oura_user_id FROM users').first()).oura_user_id, 'concurrent-provider');
  assert.equal((await f.db.prepare('SELECT COUNT(*) AS n FROM encrypted_tokens').first()).n, 0);
});

test('query parameters cannot upgrade ordinary consent to identity repair', async t => {
  const f = await fixture(t);
  f.provider.id = 'new-provider-identifier';
  const response = await f.request('/api/auth/oura/start?repair_identity=1');
  const state = new URL(response.headers.get('Location')).searchParams.get('state');
  assert.equal((await f.db.prepare('SELECT repair_from_provider_id FROM oauth_states').first()).repair_from_provider_id, null);
  const callback = await f.finish({ state, cookie: response.headers.get('Set-Cookie').split(';')[0] },
    f.cookie, '&repair_identity=1');
  assert.match(callback.headers.get('Location'), /oura_account_mismatch/);
  assert.equal((await f.db.prepare('SELECT COUNT(*) AS n FROM encrypted_tokens').first()).n, 0);
});

test('repair needs a stored original email and unexpired consent', async t => {
  const f = await fixture(t);
  const tx = await f.start();
  await f.db.prepare("UPDATE oauth_states SET expires_at='2000-01-01'").run();
  f.provider.id = 'new-provider-identifier';
  assert.match((await f.finish(tx)).headers.get('Location'), /invalid_state/);
  await f.db.prepare('UPDATE users SET email=NULL').run();
  assert.equal((await f.request('/api/auth/oura/start', {
    method: 'POST', headers: { Origin: origin }, body: new URLSearchParams({ intent: 'repair_identity' }),
  })).status, 409);
  assert.equal((await f.db.prepare('SELECT COUNT(*) AS n FROM encrypted_tokens').first()).n, 0);
});

test('failed provider-binding write rolls back replacement encrypted tokens', async t => {
  const f = await fixture(t);
  await connectOura(f.runtime, f.cookie);
  const before = await f.db.prepare('SELECT ciphertext,iv FROM encrypted_tokens').first();
  const tx = await f.start();
  f.provider.id = 'new-provider-identifier';
  await f.db.prepare(`CREATE TRIGGER reject_identity_update BEFORE UPDATE ON users
    BEGIN SELECT RAISE(ABORT,'synthetic_connection_write_failure'); END`).run();
  assert.match((await f.finish(tx)).headers.get('Location'), /token_exchange_failed/);
  assert.deepEqual(await f.db.prepare('SELECT ciphertext,iv FROM encrypted_tokens').first(), before);
  assert.equal((await f.db.prepare('SELECT oura_user_id FROM users').first()).oura_user_id, 'test-user');
});
