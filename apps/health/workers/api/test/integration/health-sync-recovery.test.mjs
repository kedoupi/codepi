import assert from 'node:assert/strict';
import { after, afterEach, before, test } from 'node:test';
import { createRuntime, login, migrate } from './runtime.mjs';

let runtime, cookie, db;
let handler = () => undefined;
let providerCalls = 0;
const origin = 'https://oura.example';
const failedAt = '2000-02-01T00:00:00.000Z';
const recoveredAt = '2000-02-02T00:00:00.000Z';
const newerFailureAt = '2000-02-03T00:00:00.000Z';
const day = n => `2000-01-${String(n).padStart(2, '0')}`;
const datedCollections = [
  'sleep', 'daily_sleep', 'daily_readiness', 'daily_activity', 'daily_spo2',
  'daily_stress', 'daily_resilience', 'daily_cardiovascular_age', 'vO2_max',
  'workout', 'enhanced_tag', 'session', 'sleep_time', 'rest_mode_period',
];

before(async () => {
  runtime = createRuntime({
    providerResponse(url, request) {
      providerCalls++;
      return handler(url, request);
    },
  });
  await runtime.ready;
  await migrate(runtime);
  cookie = await login(runtime);
  db = await runtime.getD1Database('DB');
});
afterEach(async () => {
  handler = () => undefined;
  await db.prepare('DELETE FROM health_sync_windows').run();
  await db.prepare('DELETE FROM health_records').run();
});
after(async () => { await runtime?.dispose(); });

function failure(collection, from, to = from, options = {}) {
  return { collection, from, to, error: 'upstream_unavailable', attemptedAt: failedAt, ...options };
}
function success(collection, from, to = from, options = {}) {
  return { collection, from, to, syncedAt: recoveredAt, attemptedAt: recoveredAt, ...options };
}
async function seed(windows) {
  await db.batch(windows.map(row => db.prepare(`INSERT INTO health_sync_windows
    (user_id,collection,window_from,window_to,synced_at,attempted_at,last_error)
    VALUES (?,?,?,?,?,?,?)`).bind(row.userId ?? 'test-user', row.collection, row.from, row.to,
    row.syncedAt ?? null, row.attemptedAt, row.error ?? null)));
}
function get(path, options = {}) {
  return runtime.dispatchFetch(`${origin}${path}`, { headers: { Cookie: cookie }, ...options });
}
async function status() {
  const response = await get('/api/me/health-records/status');
  assert.equal(response.status, 200);
  return (await response.json()).collections;
}
async function records(collection, from, to = from, method = 'GET') {
  const response = await get(`/api/me/health-records?${new URLSearchParams({ collection, from, to })}`, { method });
  assert.equal(response.status, 200);
  return response.json();
}

test('all 16 recovered collections stop alerting immediately without another provider request', async () => {
  const snapshots = ['personal_info', 'ring_configuration'];
  await seed([
    ...datedCollections.flatMap(collection => [
      failure(collection, day(1), day(7)),
      failure(collection, day(2), day(8)),
      failure(collection, day(3), day(9)),
      success(collection, day(1), day(4)),
      success(collection, day(4), day(6)),
      success(collection, day(7), day(9)),
    ]),
    ...snapshots.flatMap(collection => [
      failure(collection, day(1)), failure(collection, day(2)), failure(collection, day(3)),
      success(collection, day(9)),
    ]),
  ]);
  const beforeCalls = providerCalls;
  const collections = await status();
  assert.equal(collections.filter(row => row.failed_windows).length, 0);
  for (const name of [...datedCollections, ...snapshots]) {
    assert.deepEqual(collections.find(row => row.name === name).failed_ranges, []);
  }
  const saved = await records('sleep', day(1), day(7));
  assert.equal(saved.sync.error, null);
  assert.equal(saved.sync.window_verified, true);
  assert.equal(saved.sync.synced_at, recoveredAt);
  assert.equal(providerCalls, beforeCalls, 'reading recovery must not trigger another sync');
  const history = await db.prepare('SELECT COUNT(*) AS n FROM health_sync_windows WHERE last_error IS NOT NULL').first();
  assert.equal(history.n, 48, 'diagnostic history is retained independently of active alerts');
});

test('a missing day or a success older than the failure keeps the alert', async () => {
  await seed([
    failure('sleep', day(1), day(7)),
    success('sleep', day(1), day(3)),
    success('sleep', day(5), day(7)),
    failure('daily_sleep', day(1), day(7)),
    success('daily_sleep', day(1), day(3)),
    success('daily_sleep', day(4), day(7), {
      syncedAt: '2000-01-31T00:00:00.000Z', attemptedAt: '2000-01-31T00:00:00.000Z',
    }),
  ]);
  const collections = await status();
  for (const name of ['sleep', 'daily_sleep']) {
    assert.equal(collections.find(row => row.name === name).failed_windows, 1);
    assert.equal((await records(name, day(1), day(7))).sync.error, 'upstream_unavailable');
  }
});

test('success in another collection or for another owner cannot resolve a failure', async () => {
  await db.prepare("INSERT INTO users (id) VALUES ('other-owner')").run();
  await seed([
    failure('sleep', day(1), day(7)),
    success('workout', day(1), day(7)),
    success('sleep', day(1), day(7), { userId: 'other-owner' }),
  ]);
  assert.equal((await status()).find(row => row.name === 'sleep').failed_windows, 1);
  assert.equal((await records('sleep', day(1), day(7))).sync.error, 'upstream_unavailable');
});

test('a new failed subwindow remains visible after an older failure has been recovered', async () => {
  await seed([
    failure('sleep', day(1), day(7)),
    success('sleep', day(1), day(3)),
    success('sleep', day(4), day(7)),
    failure('sleep', day(5), day(5), { attemptedAt: newerFailureAt }),
  ]);
  const collection = (await status()).find(row => row.name === 'sleep');
  assert.equal(collection.failed_windows, 1);
  assert.deepEqual(collection.failed_ranges, [{
    collection: 'sleep', from: day(5), to: day(5), code: 'upstream_unavailable',
  }]);
  assert.equal((await records('sleep', day(5))).sync.error, 'upstream_unavailable');
});

test('a failed retry retaining an old successful timestamp is still a failure', async () => {
  await seed([
    failure('sleep', day(1), day(7), { syncedAt: '2000-01-31T00:00:00.000Z' }),
    success('sleep', day(1), day(3)),
    failure('sleep', day(4), day(7), { syncedAt: recoveredAt, attemptedAt: newerFailureAt }),
  ]);
  const collection = (await status()).find(row => row.name === 'sleep');
  assert.ok(collection.failed_ranges.some(row => row.from === day(4) && row.to === day(7)));
  assert.equal((await records('sleep', day(4), day(7))).sync.error, 'upstream_unavailable');
});

test('new profile and device snapshots replace older failures while newer failures remain visible', async () => {
  for (const name of ['personal_info', 'ring_configuration']) {
    await seed([
      failure(name, day(1)), failure(name, day(2)), success(name, day(3)),
    ]);
    assert.equal((await status()).find(row => row.name === name).failed_windows, 0);
    const old = await records(name, day(1));
    assert.equal(old.sync.error, null);
    assert.equal(old.sync.window_verified, true);
    await seed([failure(name, day(4), day(4), { attemptedAt: newerFailureAt })]);
    assert.equal((await status()).find(row => row.name === name).failed_windows, 1);
    assert.equal((await records(name, day(4))).sync.error, 'upstream_unavailable');
  }
});

test('successful empty daily retries resolve a failed time-series range only when complete', async () => {
  await seed([failure('heartrate', day(1), day(3))]);
  handler = url => url.pathname.endsWith('/heartrate')
    ? Response.json({ data: [], next_token: null }) : undefined;
  for (const n of [1, 3]) {
    const saved = await records('heartrate', day(n), day(n), 'POST');
    assert.equal(saved.total, 0);
    assert.equal(saved.sync.window_verified, true);
    assert.equal((await status()).find(row => row.name === 'heartrate').failed_windows, 1);
  }
  await records('heartrate', day(2), day(2), 'POST');
  assert.equal((await status()).find(row => row.name === 'heartrate').failed_windows, 0);
  assert.equal((await records('heartrate', day(1), day(3))).sync.error, null);
});
