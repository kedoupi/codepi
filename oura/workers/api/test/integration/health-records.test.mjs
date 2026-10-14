import assert from 'node:assert/strict';
import { before, after, test } from 'node:test';
import { createRuntime, login, migrate } from './runtime.mjs';

let runtime, cookie, db;
let handler = () => undefined;
let calls = [];
const origin = 'https://oura.example';
const today = new Date().toISOString().slice(0, 10);
before(async () => {
  runtime = createRuntime({
    providerResponse(url, request) {
      calls.push(url.href);
      return handler(url, request);
    },
  });
  await runtime.ready;
  await migrate(runtime);
  cookie = await login(runtime);
  db = await runtime.getD1Database('DB');
});
after(async () => { await runtime?.dispose(); });

function get(path, options = {}) {
  return runtime.dispatchFetch(`${origin}${path}`, { redirect: 'manual', headers: { Cookie: cookie }, ...options });
}
function records(collection, options = {}) {
  const { from = today, to = today, method = 'GET', ...query } = options;
  const params = new URLSearchParams({ collection, from, to, ...query });
  return get(`/api/me/health-records?${params}`, { method });
}
async function expire(collection) {
  await db.prepare("UPDATE health_sync_windows SET synced_at='2000-01-01T00:00:00Z', attempted_at='2000-01-01T00:00:00Z' WHERE collection=?")
    .bind(collection).run();
}
function response(data, next_token = null) { return Response.json({ data, next_token }); }

test('daily retries resolve an oversized parent only after its entire window is covered', async () => {
  const date = back => new Date(Date.parse(today) - back * 86400000).toISOString().slice(0, 10);
  handler = url => {
    if (!url.pathname.endsWith('/heartrate')) return undefined;
    const from = url.searchParams.get('start_datetime');
    const to = url.searchParams.get('end_datetime');
    return Date.parse(to) - Date.parse(from) > 86400000
      ? response(Array.from({ length: 5001 }, () => ({})))
      : response([{ timestamp: from, bpm: 60, source: 'rest' }]);
  };
  try {
    assert.equal((await records('heartrate', { from: date(6), method: 'POST' })).status, 422);
    for (let back = 0; back < 6; back++) {
      assert.equal((await records('heartrate', { from: date(back), to: date(back), method: 'POST' })).status, 200);
    }
    let parent = await (await records('heartrate', { from: date(6) })).json();
    assert.equal(parent.sync.error, 'sync_window_too_large', 'partial coverage must retain the failure');
    await db.prepare("UPDATE health_sync_windows SET synced_at='2000-01-01T00:00:00Z' WHERE collection='heartrate' AND window_from=? AND window_to=?")
      .bind(today, today).run();
    assert.equal((await records('heartrate', { from: date(6), to: date(6), method: 'POST' })).status, 200);
    parent = await (await records('heartrate', { from: date(6) })).json();
    assert.equal(parent.sync.error, 'sync_window_too_large', 'old child snapshots cannot resolve a newer failure');
    assert.equal((await records('heartrate', { method: 'POST' })).status, 200);
    parent = await (await records('heartrate', { from: date(6) })).json();
    assert.equal(parent.sync.error, null, 'complete daily retries clear the oversized parent');
    assert.equal(parent.sync.window_verified, true);
    const status = await (await get('/api/me/health-records/status')).json();
    assert.equal(status.collections.find(row => row.name === 'heartrate').failed_windows, 0);
  } finally {
    handler = () => undefined;
    await db.prepare("DELETE FROM health_records WHERE collection='heartrate'").run();
    await db.prepare("DELETE FROM health_sync_windows WHERE collection='heartrate'").run();
  }
});

test('expanded OAuth scopes and owner-only routes; malformed ranges cannot contact Oura', async () => {
  const start = await get('/api/auth/oura/start');
  const scopes = new URL(start.headers.get('location')).searchParams.get('scope').split(' ');
  for (const scope of ['daily', 'personal', 'email', 'heartrate', 'workout', 'tag', 'session', 'spo2', 'heart_health']) assert.ok(scopes.includes(scope));
  const unauth = await get('/api/me/health-records/status', { headers: {} });
  assert.equal(unauth.status, 401);
  const beforeCalls = calls.length;
  for (const options of [{ from: '2026-02-30' }, { to: 'bad-date' }, { from: '2000-01-01' }, { to: '2999-01-01' }]) {
    assert.equal((await records('sleep', { ...options, method: 'POST' })).status, 400);
  }
  assert.equal((await records('../personal_info', { method: 'POST' })).status, 400);
  assert.equal((await records('sleep', { offset: '-1' })).status, 400);
  assert.equal(calls.length, beforeCalls);
  await db.prepare("INSERT INTO users (id) VALUES ('other-owner')").run();
  await db.prepare("UPDATE sessions SET user_id='other-owner'").run();
  assert.equal((await get('/api/me/health-records/status')).status, 403);
  await db.prepare("UPDATE sessions SET user_id='test-user'").run();
});

test('explicit expanded authorization returns to a fixed auto-backfill page and cannot redirect externally', async () => {
  const start = await get('/api/auth/oura/start?sync_health=1&return=https://evil.example/settings');
  const state = new URL(start.headers.get('location')).searchParams.get('state');
  const stateCookie = start.headers.get('set-cookie').split(';')[0];
  const callback = await get(`/api/auth/oura/callback?code=test-code&state=${encodeURIComponent(state)}`,
    { headers: { Cookie: stateCookie } });
  assert.equal(callback.status, 302);
  assert.equal(callback.headers.get('location'), '/settings?sync=90');
});

test('complete paginated sleep data is retained, multi-period days are not collapsed, series are opt-in', async () => {
  handler = url => url.pathname.endsWith('/sleep')
    ? response([{
      id: url.searchParams.has('next_token') ? 'nap' : 'night', day: today,
      total_sleep_duration: 28800, average_hrv: 42, lowest_heart_rate: 49,
      hrv: { interval: 300, items: [42, null, 43] }, sleep_phase_5_min: '1234',
    }], url.searchParams.has('next_token') ? null : 'page2')
    : undefined;
  const res = await records('sleep', { method: 'POST' });
  assert.equal(res.status, 200);
  const payload = await res.json();
  assert.equal(payload.total, 2);
  assert.equal(payload.records[0].average_hrv, 42);
  assert.equal(payload.records[0].total_sleep_duration, 28800);
  assert.equal(payload.records[0].hrv, undefined);
  const series = await (await records('sleep', { include_series: 'true' })).json();
  assert.deepEqual(series.records[0].hrv.items, [42, null, 43]);
  assert.equal(series.records[0].sleep_phase_5_min, '1234');
  const count = calls.length;
  await records('sleep', { method: 'POST' });
  assert.equal(calls.length, count, 'force refresh honors successful-sync cooldown');
  handler = () => undefined;
});

test('failed or malformed later pages never replace the last successful snapshot', async () => {
  for (const failure of ['http', 'loop', 'schema']) {
    await expire('sleep');
    handler = url => {
      if (!url.pathname.endsWith('/sleep')) return undefined;
      if (!url.searchParams.has('next_token')) return response([{ id: 'incomplete', day: today }], 'next');
      return failure === 'http' ? Response.json({}, { status: 500 })
        : failure === 'loop' ? response([], 'next') : Response.json({ data: {} });
    };
    assert.equal((await records('sleep', { method: 'POST' })).status, 502);
    const saved = await (await records('sleep')).json();
    assert.equal(saved.total, 2);
    assert.equal(saved.sync.stale, true);
    assert.ok(saved.sync.error);
    assert.ok(saved.records.every(row => row.id !== 'incomplete'));
  }
  assert.equal((await db.prepare("SELECT lease_until FROM sync_state WHERE user_id='test-user'").first()).lease_until, 0);
  handler = () => undefined;
});

test('permission failures remain distinct from an empty successful collection and other collections still work', async () => {
  handler = url => url.pathname.endsWith('/daily_spo2') ? Response.json({}, { status: 403 })
    : url.pathname.endsWith('/workout') ? response([]) : undefined;
  assert.equal((await records('daily_spo2', { method: 'POST' })).status, 403);
  const denied = await (await records('daily_spo2')).json();
  assert.equal(denied.sync.error, 'permission_or_membership_required');
  assert.equal(denied.sync.window_verified, false);
  assert.equal((await records('workout', { method: 'POST' })).status, 200);
  const empty = await (await records('workout')).json();
  assert.equal(empty.total, 0);
  assert.equal(empty.sync.window_verified, true);
  assert.equal(empty.sync.stale, false);
  assert.equal((await get('/api/me/daily?days=7')).status, 200);
  handler = () => undefined;
});

test('archive keeps old windows and raw activity fields; refreshed windows remove deleted records', async () => {
  handler = url => url.pathname.endsWith('/daily_activity')
    ? response([{ id: `activity-${url.searchParams.get('start_date')}`, day: url.searchParams.get('start_date'),
      total_calories: 2200, sedentary_time: 15000, met: { items: [1, 2] } }]) : undefined;
  assert.equal((await records('daily_activity', { from: '2025-01-01', to: '2025-01-01', method: 'POST' })).status, 200);
  assert.equal((await records('daily_activity', { method: 'POST' })).status, 200);
  let old = await (await records('daily_activity', { from: '2025-01-01', to: '2025-01-01' })).json();
  assert.equal(old.records[0].total_calories, 2200);
  await expire('daily_activity');
  handler = url => url.pathname.endsWith('/daily_activity') ? response([]) : undefined;
  await records('daily_activity', { method: 'POST' });
  assert.equal((await (await records('daily_activity')).json()).total, 0);
  old = await (await records('daily_activity', { from: '2025-01-01', to: '2025-01-01' })).json();
  assert.equal(old.total, 1, 'refreshing today must retain old history');
  handler = () => undefined;
});

test('time series have UTC boundaries, stable identities and response pagination', async () => {
  handler = url => {
    if (!url.pathname.endsWith('/heartrate')) return undefined;
    assert.equal(url.searchParams.get('start_datetime'), `${today}T00:00:00Z`);
    return response(Array.from({ length: 25 }, (_, i) => ({
      timestamp: new Date(Date.parse(today) + i * 300000).toISOString(), bpm: 60 + i, source: 'rest',
    })));
  };
  const first = await (await records('heartrate', { method: 'POST' })).json();
  assert.equal(first.total, 25);
  assert.equal(first.date_basis, 'UTC');
  assert.equal(first.records.length, 20);
  assert.equal(first.next_offset, 20);
  const count = calls.length;
  const last = await (await records('heartrate', { offset: '20' })).json();
  assert.equal(last.records.length, 5);
  assert.equal(last.next_offset, null);
  assert.equal(calls.length, count);
  await expire('heartrate');
  await records('heartrate', { method: 'POST' });
  assert.equal((await (await records('heartrate')).json()).total, 25);
  handler = () => undefined;
});

test('snapshots save profile fields and device configuration without requiring day fields', async () => {
  handler = url => url.pathname.endsWith('/personal_info')
    ? Response.json({ id: 'test-user', age: 30, height: 1.8, weight: 75, biological_sex: 'male' })
    : url.pathname.endsWith('/ring_configuration') ? response([{ id: 'ring1', firmware_version: 'test', size: 10 }]) : undefined;
  assert.equal((await records('personal_info', { method: 'POST' })).status, 200);
  const profile = await (await records('personal_info')).json();
  assert.equal(profile.records[0].height, 1.8);
  assert.equal(profile.date_basis, 'current_snapshot');
  assert.equal((await records('ring_configuration', { method: 'POST' })).status, 200);
  handler = () => undefined;
});

test('large records use a byte-bounded page without losing the continuation offset', async () => {
  handler = url => url.pathname.endsWith('/enhanced_tag') ? response(
    Array.from({ length: 3 }, (_, i) => ({ id: `tag-${i}`, start_day: today, comment: 'x'.repeat(35000) })),
  ) : undefined;
  const first = await (await records('enhanced_tag', { method: 'POST' })).json();
  assert.equal(first.total, 3);
  assert.equal(first.records.length, 1);
  assert.equal(first.next_offset, 1);
  const next = await (await records('enhanced_tag', { offset: String(first.next_offset) })).json();
  assert.equal(next.records[0].id, 'tag-1');
  assert.equal(next.next_offset, 2);
  const last = await (await records('enhanced_tag', { offset: String(next.next_offset) })).json();
  assert.equal(last.records[0].id, 'tag-2');
  assert.equal(last.next_offset, null);
  handler = () => undefined;
});

test('shared lease prevents racing token refreshes and rate limits do not become empty data', async () => {
  await db.prepare("UPDATE sync_state SET lease_until=? WHERE user_id='test-user'").bind(Date.now() + 60000).run();
  const count = calls.length;
  assert.equal((await records('daily_stress', { method: 'POST' })).status, 409);
  assert.equal(calls.length, count);
  await db.prepare("UPDATE sync_state SET lease_until=0 WHERE user_id='test-user'").run();
  handler = url => url.pathname.endsWith('/daily_stress') ? Response.json({}, { status: 429 }) : undefined;
  assert.equal((await records('daily_stress', { method: 'POST' })).status, 429);
  assert.equal((await (await records('daily_stress')).json()).sync.error, 'rate_limited');
  handler = () => undefined;
});

test('compact daily history survives the rolling 90-day refresh', async () => {
  const day = '2025-01-01';
  await db.prepare("INSERT INTO daily_cache (user_id, day, payload) VALUES (?, ?, ?)")
    .bind('test-user', day, JSON.stringify({ date: day, sleep: { score: 70 } })).run();
  await db.prepare("UPDATE sync_state SET synced_at='2000-01-01' WHERE user_id='test-user'").run();
  assert.equal((await get('/api/me/sync?days=90', { method: 'POST' })).status, 200);
  assert.ok(await db.prepare("SELECT day FROM daily_cache WHERE user_id=? AND day=?").bind('test-user', day).first());
});
