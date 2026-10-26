import assert from 'node:assert/strict';
import { before, after, test } from 'node:test';
import { encryptJson, packEncryptedBlob } from '../../src/lib/crypto.ts';
import { tokenAad } from '../../src/lib/tokens.ts';
import { calendarDay } from '../../../../shared/dates.ts';
import { createRuntime, login, migrate } from './runtime.mjs';

const origin = 'https://oura.example';
const day = calendarDay();
const main = { id: 'night-private-id', day, type: 'long_sleep', total_sleep_duration: 25200, average_hrv: 42 };
const nap = {
  id: 'nap-private-id', day, type: 'sleep', total_sleep_duration: 1800,
  readiness: { score: null, contributors: { recovery: 1, balance: 2 } },
};
function reorderKeys(value) {
  if (Array.isArray(value)) return value.map(reorderKeys);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).reverse().map(([key, item]) => [key, reorderKeys(item)]));
  }
  return value;
}
let runtime, db, cookie;
let providerCalls = [];
let mode = 'complete';
let releaseRefresh = () => {};
let refreshGate = Promise.resolve();
before(async () => {
  runtime = createRuntime({ providerResponse(url) {
    if (url.pathname === '/oauth/token' && (mode === 'expired-token' || mode === 'rejected-401')) {
      providerCalls.push(url.href);
      return (async () => {
        if (providerCalls.filter(href => new URL(href).pathname === '/oauth/token').length === 1) releaseRefresh();
        await refreshGate;
        return Response.json({ access_token: 'refreshed-private-access', refresh_token: 'refreshed-private-refresh', expires_in: 3600 });
      })();
    }
    if (!url.pathname.endsWith('/sleep')) return undefined;
    if (mode === 'rejected-401' && !providerCalls.some(href => new URL(href).pathname === '/oauth/token')) {
      providerCalls.push(url.href);
      return new Response('', { status: 401 });
    }
    providerCalls.push(url.href);
    if (mode === 'failure') return Response.json({}, { status: 500 });
    if (mode === 'reordered') return Response.json({ data: [reorderKeys(nap)], next_token: null });
    if (mode === 'takeover-401' || mode === 'takeover-page') return (async () => {
      await db.prepare("UPDATE sync_state SET lease_id='successor',lease_until=? WHERE user_id='test-user'")
        .bind(Date.now() + 120000).run();
      return mode === 'takeover-401' ? new Response('', { status: 401 })
        : Response.json({ data: [nap], next_token: 'must-not-fetch' });
    })();
    if (mode === 'nap-only') return Response.json({ data: [nap], next_token: null });
    return url.searchParams.has('next_token')
      ? Response.json({ data: [nap], next_token: null })
      : Response.json({ data: [main], next_token: 'private-page-token' });
  } });
  await runtime.ready;
  await migrate(runtime);
  cookie = await login(runtime);
  db = await runtime.getD1Database('DB');
  await db.prepare(`INSERT INTO health_records (user_id,collection,record_id,day,payload,fetched_at)
    VALUES ('test-user','sleep',?,?,?,'2000-01-01T00:00:00Z')`)
    .bind(nap.id, day, JSON.stringify(nap)).run();
});
after(async () => { await runtime?.dispose(); });
const diagnose = (params = new URLSearchParams({ from: day, to: day }), options = {}) => runtime.dispatchFetch(
  `${origin}/api/me/health-records/sleep-diagnosis?${params}`,
  { method: 'POST', headers: { Cookie: cookie, Origin: origin }, ...options },
);

async function snapshot() {
  const result = {};
  for (const table of ['health_records', 'health_sync_windows', 'daily_cache']) {
    result[table] = (await db.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all()).results;
  }
  return result;
}

test('sleep diagnosis follows all provider pages and compares without changing saved health data', async () => {
  const before = await snapshot();
  providerCalls = [];
  const response = await diagnose();
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  const body = await response.json();
  assert.equal(body.from, day);
  assert.equal(body.to, day);
  assert.deepEqual(body.sleep.upstream.by_day, [{ day, types: { long_sleep: 1, sleep: 1 } }]);
  assert.deepEqual(body.sleep.saved.by_day, [{ day, types: { sleep: 1 } }]);
  assert.equal(body.sleep.difference.missing_from_saved, 1);
  assert.equal(body.sleep.difference.only_in_saved, 0);
  assert.equal(body.sleep.difference.changed, 0);
  assert.equal(body.sleep.upstream.records, 2);
  assert.deepEqual(body.scores.upstream.by_day, [{ day, types: { other: 1 } }]);
  assert.equal(body.scores.upstream.outside_window, 1, 'the provider fixture includes the exclusive end date');
  assert.equal(providerCalls.length, 2);
  const request = new URL(providerCalls[0]);
  assert.equal(request.searchParams.get('start_date'), day);
  assert.equal(request.searchParams.get('end_date'), new Date(Date.parse(day) + 86400000).toISOString().slice(0, 10));
  assert.deepEqual(await snapshot(), before);
  assert.doesNotMatch(JSON.stringify(body), /night-private-id|nap-private-id|private-page-token|test-access|test-refresh|average_hrv|25200/);
});

test('sleep diagnosis distinguishes provider main-sleep gaps from missing imports', async () => {
  mode = 'nap-only';
  try {
    const response = await diagnose();
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.deepEqual(body.sleep.upstream.by_day, [{ day, types: { sleep: 1 } }]);
    assert.equal(body.sleep.difference.missing_from_saved, 0);
    assert.equal(body.sleep.difference.only_in_saved, 0);
  } finally { mode = 'complete'; }
});

test('sleep diagnosis ignores JSON object field order', async () => {
  mode = 'reordered';
  try {
    const response = await diagnose();
    assert.equal(response.status, 200);
    assert.equal((await response.json()).sleep.difference.changed, 0);
  } finally { mode = 'complete'; }
});

for (const refreshCase of ['expired-token', 'rejected-401']) {
  test(`sleep diagnosis keeps its lease through ${refreshCase} refresh`, async () => {
    const tokensBefore = await db.prepare("SELECT ciphertext,iv FROM encrypted_tokens WHERE user_id='test-user'").first();
    if (refreshCase === 'expired-token') {
      const expired = packEncryptedBlob(await encryptJson('integration-encryption-secret', {
        refresh_token: 'stored-private-refresh', access_token: 'stored-private-access', expires_at: Date.now() - 60_000,
      }, tokenAad('test-user')));
      await db.prepare("UPDATE encrypted_tokens SET ciphertext=?,iv=? WHERE user_id='test-user'")
        .bind(expired.ciphertext, expired.iv).run();
    }
    const before = await snapshot();
    providerCalls = [];
    mode = refreshCase;
    let openGate;
    const refreshStarted = new Promise(resolve => { releaseRefresh = resolve; });
    refreshGate = new Promise(resolve => { openGate = resolve; });
    try {
      const pending = diagnose();
      await refreshStarted;
      const competing = await db.prepare(`INSERT INTO sync_state (user_id,lease_id,lease_until) VALUES ('test-user','competing',?)
        ON CONFLICT(user_id) DO UPDATE SET lease_id='competing',lease_until=excluded.lease_until
        WHERE sync_state.lease_until < ? RETURNING lease_id`).bind(Date.now() + 120000, Date.now()).first();
      assert.equal(competing, null, 'a concurrent sync acquired the diagnosis lease');
      openGate();
      const response = await pending;
      assert.equal(response.status, 200);
      assert.equal(providerCalls.filter(href => new URL(href).pathname === '/oauth/token').length, 1);
      assert.notDeepEqual(await db.prepare("SELECT ciphertext,iv FROM encrypted_tokens WHERE user_id='test-user'").first(), tokensBefore);
      assert.deepEqual(await snapshot(), before);
      assert.equal((await db.prepare("SELECT lease_until FROM sync_state WHERE user_id='test-user'").first()).lease_until, 0);
    } finally {
      openGate?.();
      mode = 'complete';
      refreshGate = Promise.resolve();
      await db.prepare('UPDATE encrypted_tokens SET ciphertext=?,iv=? WHERE user_id=?')
        .bind(tokensBefore.ciphertext, tokensBefore.iv, 'test-user').run();
      await db.prepare("UPDATE sync_state SET lease_until=0 WHERE user_id='test-user'").run();
    }
  });
}

for (const takeover of ['takeover-401', 'takeover-page']) {
  test(`sleep diagnosis stops before token retry or pagination after ${takeover}`, async () => {
    const tokensBefore = await db.prepare("SELECT ciphertext,iv FROM encrypted_tokens WHERE user_id='test-user'").first();
    const before = await snapshot();
    providerCalls = [];
    mode = takeover;
    try {
      const response = await diagnose();
      assert.equal(response.status, 409);
      assert.equal(providerCalls.length, 1);
      assert.deepEqual(await db.prepare("SELECT ciphertext,iv FROM encrypted_tokens WHERE user_id='test-user'").first(), tokensBefore);
      assert.deepEqual(await snapshot(), before);
      assert.equal((await db.prepare("SELECT lease_id FROM sync_state WHERE user_id='test-user'").first()).lease_id, 'successor');
    } finally {
      mode = 'complete';
      await db.prepare("UPDATE sync_state SET lease_until=0 WHERE user_id='test-user'").run();
    }
  });
}

test('sleep diagnosis rejects unauthenticated, non-owner, invalid ranges and methods before provider calls', async () => {
  const count = providerCalls.length;
  assert.equal((await diagnose(undefined, { headers: {} })).status, 401);
  assert.equal((await diagnose(undefined, { method: 'GET' })).status, 405);
  assert.equal((await diagnose(undefined, { headers: { Cookie: cookie, Origin: 'https://other.example' } })).status, 403);
  assert.equal((await diagnose(new URLSearchParams())).status, 400);
  assert.equal((await diagnose(new URLSearchParams({ from: '2026-02-30', to: day }))).status, 400);
  assert.equal((await diagnose(new URLSearchParams({ from: new Date(Date.parse(day) - 7 * 86400000).toISOString().slice(0, 10), to: day }))).status, 400);
  await db.prepare("INSERT INTO users (id) VALUES ('other-user')").run();
  await db.prepare("UPDATE sessions SET user_id='other-user'").run();
  try { assert.equal((await diagnose()).status, 403); }
  finally { await db.prepare("UPDATE sessions SET user_id='test-user'").run(); }
  assert.equal(providerCalls.length, count);
});

test('sleep diagnosis respects the sync lease and preserves health records on provider failure', async () => {
  await db.prepare('UPDATE sync_state SET lease_until=?').bind(Date.now() + 120000).run();
  const count = providerCalls.length;
  assert.equal((await diagnose()).status, 409);
  assert.equal(providerCalls.length, count);
  await db.prepare('UPDATE sync_state SET lease_until=0').run();
  const before = await snapshot();
  mode = 'failure';
  try {
    assert.equal((await diagnose()).status, 502);
    assert.deepEqual(await snapshot(), before);
    assert.equal((await db.prepare("SELECT lease_until FROM sync_state WHERE user_id='test-user'").first()).lease_until, 0);
  } finally { mode = 'complete'; }
});
