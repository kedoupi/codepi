import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
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
const REDIRECT = 'http://127.0.0.1:9999/callback';

function at(path, options = {}, instance = runtime) {
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

async function tokenHash(token) {
  return base64url(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token)));
}

async function registerClient(instance = runtime) {
  const res = await at('/oauth/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ client_name: 'Hardening test client', redirect_uris: [REDIRECT] }),
  }, instance);
  assert.equal(res.status, 201);
  return res.json();
}

/** Drives the consent screen and returns the issued authorization code. */
async function authorize({ cookie, client, challenge, state = 'xyz' }, instance = runtime) {
  const query = new URLSearchParams({
    client_id: client.client_id, redirect_uri: REDIRECT, response_type: 'code',
    code_challenge: challenge, code_challenge_method: 'S256', state, scope: 'oura.read',
  });
  const consent = await at(`/oauth/authorize?${query}`, { headers: { Cookie: cookie } }, instance);
  assert.equal(consent.status, 200);
  const html = await consent.text();
  const approve = await at('/oauth/authorize', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Cookie: cookie },
    body: new URLSearchParams({
      consent_id: html.match(/name="consent_id" value="([^"]+)"/)[1],
      csrf_token: html.match(/name="csrf_token" value="([^"]+)"/)[1],
      client_id: client.client_id, decision: 'approve', state,
    }).toString(),
  }, instance);
  assert.equal(approve.status, 302);
  const code = new URL(approve.headers.get('location')).searchParams.get('code');
  assert.ok(code);
  return code;
}

function exchange(body, instance = runtime) {
  return at('/oauth/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(body).toString(),
  }, instance);
}

async function issueTokensFor(cookie, client, instance = runtime) {
  const pair = await pkce();
  const code = await authorize({ cookie, client, challenge: pair.challenge }, instance);
  const response = await exchange({
    grant_type: 'authorization_code', code, client_id: client.client_id,
    redirect_uri: REDIRECT, code_verifier: pair.verifier,
  }, instance);
  assert.equal(response.status, 200);
  return { code, ...(await response.json()) };
}

function accessRequest(token, instance = runtime) {
  return at('/mcp', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json', Accept: 'application/json, text/event-stream',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
  }, instance);
}

function revoke(token, clientId, instance = runtime) {
  return at('/oauth/revoke', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ token, client_id: clientId }).toString(),
  }, instance);
}

test('a failed PKCE attempt does not burn the authorization code', async () => {
  const cookie = await login(runtime);
  const client = await registerClient();
  const good = await pkce();
  const code = await authorize({ cookie, client, challenge: good.challenge });

  const wrong = await exchange({
    grant_type: 'authorization_code', code, client_id: client.client_id,
    redirect_uri: REDIRECT, code_verifier: base64url(crypto.getRandomValues(new Uint8Array(32))),
  });
  assert.equal(wrong.status, 400);
  assert.equal((await wrong.json()).error, 'invalid_grant');

  // The same code must still be redeemable with the right verifier.
  const ok = await exchange({
    grant_type: 'authorization_code', code, client_id: client.client_id,
    redirect_uri: REDIRECT, code_verifier: good.verifier,
  });
  assert.equal(ok.status, 200, 'validated-after-consumption would have burned this code');
  const tokens = await ok.json();
  assert.ok(tokens.access_token && tokens.refresh_token);

  // A wrong redirect_uri must not burn it either, but a redeemed code stays dead.
  const replay = await exchange({
    grant_type: 'authorization_code', code, client_id: client.client_id,
    redirect_uri: REDIRECT, code_verifier: good.verifier,
  });
  assert.equal(replay.status, 400);
});

test('a wrong redirect_uri leaves the code usable for the correct one', async () => {
  const cookie = await login(runtime);
  const client = await registerClient();
  const pair = await pkce();
  const code = await authorize({ cookie, client, challenge: pair.challenge });

  const mismatch = await exchange({
    grant_type: 'authorization_code', code, client_id: client.client_id,
    redirect_uri: 'http://127.0.0.1:9999/other', code_verifier: pair.verifier,
  });
  assert.equal(mismatch.status, 400);
  const ok = await exchange({
    grant_type: 'authorization_code', code, client_id: client.client_id,
    redirect_uri: REDIRECT, code_verifier: pair.verifier,
  });
  assert.equal(ok.status, 200);
});

test('only one of two concurrent redemptions of the same code mints tokens', async () => {
  const cookie = await login(runtime);
  const client = await registerClient();
  const pair = await pkce();
  const code = await authorize({ cookie, client, challenge: pair.challenge });
  const body = {
    grant_type: 'authorization_code', code, client_id: client.client_id,
    redirect_uri: REDIRECT, code_verifier: pair.verifier,
  };
  const [first, second] = await Promise.all([exchange(body), exchange(body)]);
  const statuses = [first.status, second.status].sort();
  assert.deepEqual(statuses, [200, 400], 'exactly one redemption may win');
  const db = await runtime.getD1Database('DB');
  const rows = await db.prepare(
    'SELECT kind, family_id FROM mcp_tokens WHERE client_id = ? ORDER BY kind',
  ).bind(client.client_id).all();
  assert.deepEqual(rows.results.map(row => row.kind), ['access', 'refresh']);
  assert.ok(rows.results[0].family_id);
  assert.equal(rows.results[0].family_id, rows.results[1].family_id);
});

test('refresh rotation is atomic and a replayed token retires the whole family', async () => {
  const cookie = await login(runtime);
  const client = await registerClient();
  const issued = await issueTokensFor(cookie, client);

  const rotated = await exchange({
    grant_type: 'refresh_token', refresh_token: issued.refresh_token, client_id: client.client_id,
  });
  assert.equal(rotated.status, 200);
  const next = await rotated.json();
  assert.notEqual(next.refresh_token, issued.refresh_token);

  // The successor works: rotation issued a usable pair, not a broken one.
  const access = await at('/mcp', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json', Accept: 'application/json, text/event-stream',
      Authorization: `Bearer ${next.access_token}`,
    },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
  });
  assert.equal(access.status, 200);

  // Replaying the rotated-away token is treated as a leak: invalid_grant now,
  // and the live successor is retired with it.
  const replay = await exchange({
    grant_type: 'refresh_token', refresh_token: issued.refresh_token, client_id: client.client_id,
  });
  assert.equal(replay.status, 400);
  assert.equal((await replay.json()).error, 'invalid_grant');

  const afterReplay = await exchange({
    grant_type: 'refresh_token', refresh_token: next.refresh_token, client_id: client.client_id,
  });
  assert.equal(afterReplay.status, 400, 'the family must be revoked after a replay');
  const revokedAccess = await at('/mcp', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json', Accept: 'application/json, text/event-stream',
      Authorization: `Bearer ${next.access_token}`,
    },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
  });
  assert.equal(revokedAccess.status, 401, 'access tokens of the leaked family must stop working');
});

test('refresh tokens are bound to the client that owns them', async () => {
  const cookie = await login(runtime);
  const client = await registerClient();
  const other = await registerClient();
  const issued = await issueTokensFor(cookie, client);
  const stolen = await exchange({
    grant_type: 'refresh_token', refresh_token: issued.refresh_token, client_id: other.client_id,
  });
  assert.equal(stolen.status, 400);
  const legit = await exchange({
    grant_type: 'refresh_token', refresh_token: issued.refresh_token, client_id: client.client_id,
  });
  assert.equal(legit.status, 200, 'a rejected client must not invalidate the real one');
});

test('revocation retires the presented token and its family, and stays silent for unknown tokens', async () => {
  const cookie = await login(runtime);
  const client = await registerClient();
  const issued = await issueTokensFor(cookie, client);

  const revoke = await at('/oauth/revoke', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ token: issued.refresh_token, client_id: client.client_id }).toString(),
  });
  assert.equal(revoke.status, 200);
  const reuse = await exchange({
    grant_type: 'refresh_token', refresh_token: issued.refresh_token, client_id: client.client_id,
  });
  assert.equal(reuse.status, 400);

  const unknown = await at('/oauth/revoke', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ token: 'not-a-real-token', client_id: client.client_id }).toString(),
  });
  assert.equal(unknown.status, 200, 'RFC 7009 answers 200 for unknown tokens');
});

test('a wrong client cannot revoke a family by replaying its retired refresh token', async () => {
  const cookie = await login(runtime);
  const client = await registerClient();
  const other = await registerClient();
  const issued = await issueTokensFor(cookie, client);
  const rotated = await exchange({
    grant_type: 'refresh_token', refresh_token: issued.refresh_token, client_id: client.client_id,
  });
  assert.equal(rotated.status, 200);
  const next = await rotated.json();

  const replay = await exchange({
    grant_type: 'refresh_token', refresh_token: issued.refresh_token, client_id: other.client_id,
  });
  assert.equal(replay.status, 400);
  assert.equal((await replay.json()).error, 'invalid_grant');
  assert.equal((await accessRequest(issued.access_token)).status, 200);
  assert.equal((await accessRequest(next.access_token)).status, 200);
  const legit = await exchange({
    grant_type: 'refresh_token', refresh_token: next.refresh_token, client_id: client.client_id,
  });
  assert.equal(legit.status, 200);
});

test('a revoked access token cannot trigger refresh-token reuse detection', async () => {
  const cookie = await login(runtime);
  const client = await registerClient();
  const issued = await issueTokensFor(cookie, client);
  const db = await runtime.getD1Database('DB');
  await db.prepare('UPDATE mcp_tokens SET revoked_at = ? WHERE token_hash = ?')
    .bind(Date.now(), await tokenHash(issued.access_token)).run();

  const misuse = await exchange({
    grant_type: 'refresh_token', refresh_token: issued.access_token, client_id: client.client_id,
  });
  assert.equal(misuse.status, 400);
  const legit = await exchange({
    grant_type: 'refresh_token', refresh_token: issued.refresh_token, client_id: client.client_id,
  });
  assert.equal(legit.status, 200, 'only a retired refresh token may retire its family on reuse');
});

test('revocation with the wrong client leaves live and rotated credentials usable', async () => {
  const cookie = await login(runtime);
  const client = await registerClient();
  const other = await registerClient();
  const issued = await issueTokensFor(cookie, client);
  const rotated = await exchange({
    grant_type: 'refresh_token', refresh_token: issued.refresh_token, client_id: client.client_id,
  });
  assert.equal(rotated.status, 200);
  const next = await rotated.json();

  for (const token of [issued.refresh_token, next.refresh_token, next.access_token]) {
    assert.equal((await revoke(token, other.client_id)).status, 200);
    assert.equal((await accessRequest(next.access_token)).status, 200);
  }
  const legit = await exchange({
    grant_type: 'refresh_token', refresh_token: next.refresh_token, client_id: client.client_id,
  });
  assert.equal(legit.status, 200);
  const latest = await legit.json();
  assert.equal((await revoke(issued.refresh_token, client.client_id)).status, 200);
  assert.equal((await accessRequest(latest.access_token)).status, 401);
});

for (const kind of ['refresh', 'access']) {
  test(`authorization code remains redeemable after a failed ${kind} insert`, async () => {
    const cookie = await login(runtime);
    const client = await registerClient();
    const pair = await pkce();
    const code = await authorize({ cookie, client, challenge: pair.challenge });
    const body = {
      grant_type: 'authorization_code', code, client_id: client.client_id,
      redirect_uri: REDIRECT, code_verifier: pair.verifier,
    };
    const db = await runtime.getD1Database('DB');
    await db.prepare(`CREATE TRIGGER fail_mcp_insert BEFORE INSERT ON mcp_tokens
      WHEN NEW.kind = '${kind}'
      BEGIN SELECT RAISE(ABORT, 'injected token insert failure'); END`).run();
    try {
      const failed = await exchange(body);
      assert.equal(failed.status, 500);
      assert.equal((await db.prepare(
        'SELECT consumed_at FROM oauth_auth_codes WHERE code_hash = ?',
      ).bind(await tokenHash(code)).first()).consumed_at, null, 'a failed batch must not consume the code');
      assert.equal((await db.prepare(
        'SELECT COUNT(*) AS n FROM mcp_tokens WHERE client_id = ?',
      ).bind(client.client_id).first()).n, 0, 'a failed batch must not leave a partial pair');
    } finally {
      await db.prepare('DROP TRIGGER fail_mcp_insert').run();
    }
    const retry = await exchange(body);
    assert.equal(retry.status, 200);
    const tokens = await retry.json();
    assert.equal((await accessRequest(tokens.access_token)).status, 200);
    assert.equal((await exchange(body)).status, 400);
    assert.equal((await db.prepare(
      'SELECT COUNT(*) AS n FROM mcp_tokens WHERE client_id = ?',
    ).bind(client.client_id).first()).n, 2);
  });

  test(`refresh token remains redeemable after a failed ${kind} insert`, async () => {
    const cookie = await login(runtime);
    const client = await registerClient();
    const issued = await issueTokensFor(cookie, client);
    const body = {
      grant_type: 'refresh_token', refresh_token: issued.refresh_token, client_id: client.client_id,
    };
    const db = await runtime.getD1Database('DB');
    await db.prepare(`CREATE TRIGGER fail_mcp_insert BEFORE INSERT ON mcp_tokens
      WHEN NEW.kind = '${kind}'
      BEGIN SELECT RAISE(ABORT, 'injected token insert failure'); END`).run();
    try {
      const failed = await exchange(body);
      assert.equal(failed.status, 500);
      assert.equal((await db.prepare(
        'SELECT revoked_at FROM mcp_tokens WHERE token_hash = ?',
      ).bind(await tokenHash(issued.refresh_token)).first()).revoked_at, null);
      assert.equal((await db.prepare(
        'SELECT COUNT(*) AS n FROM mcp_tokens WHERE client_id = ?',
      ).bind(client.client_id).first()).n, 2, 'rotation must roll back both the successor and revocation');
      assert.equal((await accessRequest(issued.access_token)).status, 200);
    } finally {
      await db.prepare('DROP TRIGGER fail_mcp_insert').run();
    }
    const retry = await exchange(body);
    assert.equal(retry.status, 200);
    const next = await retry.json();
    assert.equal((await accessRequest(next.access_token)).status, 200);
    assert.equal((await db.prepare(
      'SELECT COUNT(*) AS n FROM mcp_tokens WHERE client_id = ?',
    ).bind(client.client_id).first()).n, 4);
    assert.equal((await exchange(body)).status, 400);
    assert.equal((await accessRequest(next.access_token)).status, 401);
  });
}

test('legacy migration groups historical credentials, preserves usability and isolates new grants', async t => {
  const legacy = createRuntime();
  t.after(() => legacy.dispose());
  await legacy.ready;
  const db = await legacy.getD1Database('DB');
  const directory = new URL('../../../../migrations/', import.meta.url);
  const migrationName = '0009_mcp_token_family.sql';
  // Apply real SQL with the same batching as migrate(), stopping before 0009.
  async function applyMigration(name) {
    const sql = (await readFile(new URL(name, directory), 'utf8')).replace(/--[^\n]*/g, '');
    await db.batch(sql.split(';').filter(s => s.trim()).map(s => db.prepare(s)));
  }
  for (const name of (await readdir(directory)).filter(n => n.endsWith('.sql') && n < migrationName).sort()) {
    await applyMigration(name);
  }
  // Current auth code needs its additive state columns; keep the MCP tables
  // pre-0009 so this test still exercises the historical family migration.
  await applyMigration('0010_shared_sso.sql');
  await applyMigration('0012_oura_identity_repair.sql');
  const cookie = await login(legacy);
  const client = { client_id: 'legacy:client' };
  await db.prepare('INSERT INTO oauth_clients (client_id, redirect_uris) VALUES (?, ?)')
    .bind(client.client_id, JSON.stringify([REDIRECT])).run();
  const credentials = [
    ['legacy-access', 'test-user', client.client_id, 'access', null],
    ['legacy-retired-refresh', 'test-user', client.client_id, 'refresh', Date.now() - 1000],
    ['legacy-live-refresh', 'test-user', client.client_id, 'refresh', null],
    ['legacy-other-access', 'test-user', client.client_id, 'access', null],
    ['legacy-other-refresh', 'test-user', client.client_id, 'refresh', null],
    ['separate-client', 'test-user', 'other-client', 'refresh', null],
    ['separate-user', 'other-user', client.client_id, 'refresh', null],
    ['ambiguous-colons', 'test-user:legacy', 'client', 'refresh', null],
  ];
  for (const [token, user, clientId, kind, revokedAt] of credentials) {
    await db.prepare(`INSERT INTO mcp_tokens
      (token_hash, user_id, client_id, kind, scope, expires_at, revoked_at)
      VALUES (?, ?, ?, ?, 'oura.read', ?, ?)`)
      .bind(await tokenHash(token), user, clientId, kind, Date.now() + 3600000, revokedAt).run();
  }
  await applyMigration(migrationName);
  const familyId = `legacy:${Buffer.from('test-user').toString('hex').toUpperCase()}:${Buffer.from(client.client_id).toString('hex').toUpperCase()}`;
  const migrated = (await db.prepare(
    'SELECT family_id FROM mcp_tokens WHERE user_id = ? AND client_id = ?',
  ).bind('test-user', client.client_id).all()).results;
  assert.equal(migrated.length, 5);
  assert.ok(migrated.every(row => row.family_id === familyId), 'all old tokens, including retired ones, share the legacy family');
  const separate = (await db.prepare(
    'SELECT family_id FROM mcp_tokens WHERE NOT (user_id = ? AND client_id = ?)',
  ).bind('test-user', client.client_id).all()).results;
  assert.equal(new Set([familyId, ...separate.map(row => row.family_id)]).size, 4);
  assert.equal((await accessRequest('legacy-access', legacy)).status, 200);

  const fresh = await issueTokensFor(cookie, client, legacy);
  assert.notEqual((await db.prepare('SELECT family_id FROM mcp_tokens WHERE token_hash = ?')
    .bind(await tokenHash(fresh.refresh_token)).first()).family_id, familyId);
  const rotated = await exchange({
    grant_type: 'refresh_token', refresh_token: 'legacy-live-refresh', client_id: client.client_id,
  }, legacy);
  assert.equal(rotated.status, 200, 'old refresh credentials survive migration');
  const next = await rotated.json();
  const rotatedAgain = await exchange({
    grant_type: 'refresh_token', refresh_token: next.refresh_token, client_id: client.client_id,
  }, legacy);
  assert.equal(rotatedAgain.status, 200);
  const latest = await rotatedAgain.json();
  assert.equal((await accessRequest(latest.access_token, legacy)).status, 200);

  const replay = await exchange({
    grant_type: 'refresh_token', refresh_token: 'legacy-retired-refresh', client_id: client.client_id,
  }, legacy);
  assert.equal(replay.status, 400);
  for (const token of ['legacy-access', 'legacy-other-access', next.access_token, latest.access_token]) {
    assert.equal((await accessRequest(token, legacy)).status, 401, 'old access and the full rotation chain must be retired');
  }
  for (const token of ['legacy-other-refresh', latest.refresh_token]) {
    assert.equal((await exchange({
      grant_type: 'refresh_token', refresh_token: token, client_id: client.client_id,
    }, legacy)).status, 400);
  }
  assert.equal((await accessRequest(fresh.access_token, legacy)).status, 200);
  assert.equal((await exchange({
    grant_type: 'refresh_token', refresh_token: fresh.refresh_token, client_id: client.client_id,
  }, legacy)).status, 200, 'new authorizations remain independent of the legacy family');
  assert.equal((await db.prepare(
    'SELECT COUNT(*) AS n FROM mcp_tokens WHERE family_id = ? AND revoked_at IS NULL',
  ).bind(familyId).first()).n, 0);
  assert.equal((await db.prepare(
    'SELECT COUNT(*) AS n FROM mcp_tokens WHERE user_id != ? OR client_id != ?',
  ).bind('test-user', client.client_id).first()).n, 3);
  assert.equal((await db.prepare(
    'SELECT COUNT(*) AS n FROM mcp_tokens WHERE (user_id != ? OR client_id != ?) AND revoked_at IS NOT NULL',
  ).bind('test-user', client.client_id).first()).n, 0);
});

for (const action of ['replay', 'revoke']) {
  test(`NULL rows written during rollout join the migrated legacy family on ${action}`, async () => {
    await login(runtime);
    const client = await registerClient();
    const db = await runtime.getD1Database('DB');
    const familyId = `legacy:${Buffer.from('test-user').toString('hex').toUpperCase()}:${Buffer.from(client.client_id).toString('hex').toUpperCase()}`;
    const token = kind => `${client.client_id}-${kind}`;
    for (const [name, kind, family, revokedAt] of [
      ['access', 'access', null, null],
      ['refresh', 'refresh', null, null],
      ['retired', 'refresh', null, Date.now() - 1000],
      ['migrated-access', 'access', familyId, null],
    ]) {
      await db.prepare(`INSERT INTO mcp_tokens
        (token_hash, user_id, client_id, kind, scope, expires_at, family_id, revoked_at)
        VALUES (?, 'test-user', ?, ?, 'oura.read', ?, ?, ?)`)
        .bind(await tokenHash(token(name)), client.client_id, kind, Date.now() + 3600000, family, revokedAt).run();
    }
    assert.equal((await accessRequest(token('access'))).status, 200);
    const rotated = await exchange({
      grant_type: 'refresh_token', refresh_token: token('refresh'), client_id: client.client_id,
    });
    assert.equal(rotated.status, 200);
    const next = await rotated.json();
    if (action === 'replay') {
      const replay = await exchange({
        grant_type: 'refresh_token', refresh_token: token('retired'), client_id: client.client_id,
      });
      assert.equal(replay.status, 400);
    } else {
      assert.equal((await revoke(token('refresh'), client.client_id)).status, 200);
    }
    for (const access of [token('access'), token('migrated-access'), next.access_token]) {
      assert.equal((await accessRequest(access)).status, 401);
    }
    assert.equal((await exchange({
      grant_type: 'refresh_token', refresh_token: next.refresh_token, client_id: client.client_id,
    })).status, 400);
    assert.equal((await db.prepare(
      'SELECT COUNT(*) AS n FROM mcp_tokens WHERE client_id = ? AND revoked_at IS NULL',
    ).bind(client.client_id).first()).n, 0);
  });
}
