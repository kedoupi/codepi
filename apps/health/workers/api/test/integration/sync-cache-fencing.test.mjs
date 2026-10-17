import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createRuntime, login, migrate } from './runtime.mjs';

const origin = 'https://oura.example';
const DAILY = /\/v2\/usercollection\/daily_(sleep|readiness|activity)$/;

/**
 * The D1 lease in `cachedDaily` is a fence, not a hint: a sync whose lease has
 * already been taken over must not delete/insert cache rows any more. Both
 * writers are simulated against the real Worker and real D1.
 */
async function fixture(t, hooks = {}) {
  const state = { writer: 'a', fail: false };
  let releaseFirstCall;
  const firstCallGate = new Promise(resolve => { releaseFirstCall = resolve; });
  t.after(() => releaseFirstCall());
  let holdFirst = hooks.holdFirstUpstreamCall === true;

  async function respondToDaily(url) {
    // Capture the writer before awaiting, so a held request keeps its own tag.
    const tag = state.writer;
    if (holdFirst) { holdFirst = false; await firstCallGate; }
    if (state.fail) return new Response('{"error":"upstream"}', { status: 500 });
    const data = [];
    for (let day = url.searchParams.get('start_date'); day <= url.searchParams.get('end_date');) {
      data.push({
        id: `${url.pathname.split('/').at(-1)}-${day}`,
        day,
        score: tag === 'a' ? 42 : 90,
        steps: 8000,
        active_calories: 400,
        contributors: { deep_sleep: 80, hrv_balance: 80 },
      });
      day = new Date(Date.parse(day) + 86400000).toISOString().slice(0, 10);
    }
    return Response.json({ data, next_token: null });
  }

  const runtime = createRuntime({
    // Only the daily collection endpoints are stubbed; everything else (OAuth
    // token exchange, personal_info) must fall through to the default stub, so
    // this function stays synchronous and returns a promise for daily only.
    providerResponse: (url) => {
      if (!DAILY.test(url.pathname)) return undefined;
      return respondToDaily(url);
    },
  });
  t.after(() => runtime.dispose());
  await migrate(runtime);
  const cookie = await login(runtime);
  const db = await runtime.getD1Database('DB');
  return {
    state,
    releaseFirstCall,
    db,
    dailyResponse() {
      return runtime.dispatchFetch(`${origin}/api/me/daily?days=30`, { headers: { Cookie: cookie } });
    },
    async daily(init = {}) {
      const response = await runtime.dispatchFetch(`${origin}/api/me/daily?days=30`, {
        headers: { Cookie: cookie }, ...init,
      });
      assert.equal(response.status, 200);
      return response.json();
    },
    async forceSync() {
      return runtime.dispatchFetch(`${origin}/api/me/sync`, {
        method: 'POST', headers: { Cookie: cookie },
      });
    },
    async scores() {
      const rows = await db.prepare(
        "SELECT day, payload FROM daily_cache WHERE user_id = 'test-user' ORDER BY day",
      ).all();
      return rows.results.map(row => ({ day: row.day, score: JSON.parse(row.payload).sleep?.score ?? null }));
    },
    async waitForLease() {
      for (let attempt = 0; attempt < 200; attempt++) {
        const row = await db.prepare(
          "SELECT lease_id, lease_until FROM sync_state WHERE user_id = 'test-user'",
        ).first();
        if (row?.lease_id && row.lease_until > 0) return row;
        await new Promise(resolve => setTimeout(resolve, 25));
      }
      throw new Error('the first sync never claimed its lease');
    },
  };
}

test('a sync whose lease was taken over cannot clobber the newer snapshot', async t => {
  const f = await fixture(t, { holdFirstUpstreamCall: true });

  // Writer A claims the lease, then stalls upstream (long upstream call).
  const first = f.daily();
  await f.waitForLease();
  // The lease expires while A is still waiting on Oura, so B may take over.
  await f.db.prepare("UPDATE sync_state SET lease_until = 0 WHERE user_id = 'test-user'").run();

  f.state.writer = 'b';
  const second = await f.daily();
  assert.equal(second.days.at(-1).sleep.score, 90);

  // A finishes late and would previously DELETE + INSERT its own older rows.
  f.state.writer = 'a';
  f.releaseFirstCall();
  const late = await first;

  assert.equal(late.days.at(-1).sleep.score, 90, 'late writer must return the snapshot it lost the lease to');
  const rows = await f.scores();
  assert.ok(rows.length > 0);
  assert.deepEqual(
    [...new Set(rows.map(row => row.score))],
    [90],
    'the fenced writer must not overwrite a single cache row',
  );
  assert.equal(
    new Set(rows.map(row => row.day)).size,
    rows.length,
    'a fenced write must not duplicate days',
  );
});

test('a fenced-out first sync reports in progress until a successor saves a snapshot', async t => {
  const f = await fixture(t, { holdFirstUpstreamCall: true });
  const first = f.dailyResponse();
  await f.waitForLease();
  await f.db.prepare(
    "UPDATE sync_state SET lease_id = 'new-writer', lease_until = ? WHERE user_id = 'test-user'",
  ).bind(Date.now() + 120_000).run();

  f.releaseFirstCall();
  const response = await first;
  assert.equal(response.status, 409, 'an empty cache must not masquerade as a successful first sync');
  assert.equal((await response.json()).error, 'sync_in_progress');
  assert.deepEqual(await f.scores(), []);
  const state = await f.db.prepare(
    "SELECT lease_id, synced_at, last_error FROM sync_state WHERE user_id = 'test-user'",
  ).first();
  assert.deepEqual(state, { lease_id: 'new-writer', synced_at: null, last_error: null });
  assert.equal((await f.dailyResponse()).status, 409, 'a retry must preserve the successor lease');
});

test('a failed sync keeps the last good snapshot instead of half-replacing it', async t => {
  const f = await fixture(t);
  f.state.writer = 'b';
  assert.equal((await f.daily()).days.at(-1).sleep.score, 90);
  const before = await f.scores();

  // Age the snapshot past the 30s cooldown so the forced sync really runs.
  await f.db.prepare("UPDATE sync_state SET synced_at = '2020-01-01T00:00:00Z' WHERE user_id = 'test-user'").run();
  f.state.fail = true;
  const forced = await f.forceSync();
  assert.equal(forced.status, 200);
  const payload = await forced.json();
  assert.equal(typeof payload.sync.error, 'string');
  assert.equal(payload.days.at(-1).sleep.score, 90, 'failed sync must still serve the last good snapshot');

  assert.deepEqual(await f.scores(), before, 'a failed sync must not touch cached rows');
});
