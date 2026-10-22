import { calendarDay } from "../../../../shared/dates.ts";
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createRuntime, login, migrate } from './runtime.mjs';

const origin = 'https://oura.example';
const today = calendarDay();

async function fixture(t, providerResponse) {
  const runtime = createRuntime({ autoSync: true, providerResponse });
  t.after(() => runtime.dispose());
  await migrate(runtime);
  const cookie = await login(runtime);
  const db = await runtime.getD1Database('DB');
  return {
    runtime, db,
    daily: () => runtime.dispatchFetch(`${origin}/api/me/daily`, { headers: { Cookie: cookie } }),
    health: () => runtime.dispatchFetch(`${origin}/api/me/health-records?collection=daily_resilience&from=${today}&to=${today}`, {
      method: 'POST', headers: { Cookie: cookie },
    }),
    me: () => runtime.dispatchFetch(`${origin}/api/me`, { headers: { Cookie: cookie } }),
  };
}

for (const route of ['daily', 'health']) {
  test(`${route}: rejected access token refreshes once without requiring a new login`, async t => {
    let exchanges = 0;
    const f = await fixture(t, (url, request) => {
      if (url.pathname === '/oauth/token') {
        exchanges++;
        return Response.json({
          access_token: exchanges === 1 ? 'old-access' : 'new-access',
          refresh_token: `refresh-${exchanges}`, expires_in: 86400,
        });
      }
      if (url.pathname.includes('/usercollection/') && !url.pathname.endsWith('/personal_info')
        && request.headers.get('Authorization') === 'Bearer old-access') {
        return new Response('', { status: 401 });
      }
    });
    const response = await f[route]();
    assert.equal(response.status, 200, await response.text());
    assert.equal(exchanges, 2, 'parallel daily requests must share one refresh');
    assert.equal((await (await f.me()).json()).authenticated, true);
  });
}

test('a bad collection request does not tell the user their authorization expired', async t => {
  const f = await fixture(t, url => {
    if (url.pathname.endsWith('/daily_sleep')) {
      return Response.json({ detail: 'invalid date range' }, { status: 400 });
    }
  });
  const response = await f.daily();
  assert.equal(response.status, 502);
  assert.equal((await response.json()).error, 'upstream_request_rejected');
});

test('a successful live sync releases an obsolete authorization block', async t => {
  const f = await fixture(t);
  await f.db.prepare(`INSERT INTO auto_sync_state
    (user_id,run_day,status,last_error,payload)
    VALUES ('test-user',?,'blocked','reconnect_required',?)`)
    .bind(today, JSON.stringify([{
      collection: 'daily_resilience', from: today, to: today,
      state: 'pending', attempts: 0, after: 0, error: 'reconnect_required',
    }])).run();
  assert.equal((await f.daily()).status, 200);
  const row = await f.db.prepare('SELECT status,last_error,payload FROM auto_sync_state').first();
  assert.equal(row.status, 'running');
  assert.equal(row.last_error, null);
  assert.equal(JSON.parse(row.payload).length, 1, 'resume must preserve unfinished work');
  const worker = await f.runtime.getWorker();
  await worker.scheduled({ scheduledTime: Date.parse(`${today}T01:00:00Z`), cron: '*/2 * * * *' });
  assert.equal((await f.db.prepare('SELECT status FROM auto_sync_state').first()).status, 'completed');
});

test('an individual endpoint rejecting a refreshed token does not block every collection', async t => {
  let exchanges = 0, rejectedCalls = 0;
  const f = await fixture(t, url => {
    if (url.pathname === '/oauth/token') exchanges++;
    if (url.pathname.endsWith('/daily_resilience')) {
      rejectedCalls++;
      return new Response('', { status: 401 });
    }
  });
  const tasks = ['daily_resilience', 'sleep'].map(collection => ({
    collection, from: today, to: today, state: 'pending', attempts: 0, after: 0,
  }));
  await f.db.prepare(`INSERT INTO auto_sync_state (user_id,run_day,status,payload)
    VALUES ('test-user',?,'running',?)`).bind(today, JSON.stringify(tasks)).run();
  const worker = await f.runtime.getWorker();
  const tick = () => worker.scheduled({ scheduledTime: Date.parse(`${today}T01:00:00Z`), cron: '*/2 * * * *' });
  await tick();
  const row = await f.db.prepare('SELECT status,last_error FROM auto_sync_state').first();
  assert.equal(row.status, 'completed');
  assert.equal(row.last_error, null, 'a paused resource must not masquerade as a retryable job failure');
  assert.equal(rejectedCalls, 2, 'retry the endpoint only once');
  assert.equal(exchanges, 2, 'login plus one refresh');
  await tick();
  const queue = JSON.parse((await f.db.prepare('SELECT payload FROM auto_sync_state').first()).payload);
  assert.equal(queue[0].state, 'unavailable');
  assert.equal(queue[0].error, 'upstream_access_denied', 'the original refusal remains inspectable');
  assert.equal(queue[1].state, 'done', 'unaffected data must continue syncing');
  assert.equal(rejectedCalls, 2, 'unavailable collection must not be retried');
  assert.equal((await (await f.me()).json()).authenticated, true);
});

test('missing scopes pause all three resources without rotating a valid token and resume after consent', async t => {
  let exchanges = 0;
  let missing = true;
  const calls = new Map();
  const scopes = {
    daily_resilience: 'stress',
    ring_configuration: 'ring_configuration',
    ring_battery_level: 'ring_configuration',
  };
  const f = await fixture(t, url => {
    if (url.pathname === '/oauth/token') exchanges++;
    const name = url.pathname.split('/').at(-1);
    if (name in scopes) {
      calls.set(name, (calls.get(name) ?? 0) + 1);
      if (missing) return Response.json({
        detail: `Token is not authorized access ${scopes[name]} scope.`,
      }, { status: 401 });
    }
  });
  const tasks = [...Object.keys(scopes), 'sleep'].map(collection => ({
    collection, from: today, to: today, state: 'pending', attempts: 0, after: 0,
  }));
  await f.db.prepare(`INSERT INTO auto_sync_state (user_id,run_day,status,payload)
    VALUES ('test-user',?,'running',?)`).bind(today, JSON.stringify(tasks)).run();
  const worker = await f.runtime.getWorker();
  const tick = () => worker.scheduled({ scheduledTime: Date.parse(`${today}T01:00:00Z`), cron: '*/2 * * * *' });
  for (let i = 0; i < 5; i++) await tick();
  assert.equal(exchanges, 1, 'missing scopes cannot be repaired by rotating a healthy token');
  assert.deepEqual(Object.fromEntries(calls), Object.fromEntries(Object.keys(scopes).map(name => [name, 1])));
  const row = await f.db.prepare('SELECT status,last_error,payload FROM auto_sync_state').first();
  assert.equal(row.status, 'completed');
  assert.equal(row.last_error, null);
  assert.ok(JSON.parse(row.payload).filter(task => task.collection in scopes)
    .every(task => task.state === 'unavailable' && task.error === 'oura_scope_required'));
  const windows = await f.db.prepare("SELECT last_error FROM health_sync_windows WHERE collection IN ('daily_resilience','ring_configuration','ring_battery_level')").all();
  assert.ok(windows.results.every(window => window.last_error === 'oura_scope_required'));
  assert.equal((await (await f.me()).json()).authenticated, true);
  missing = false;
  await login(f.runtime);
  for (let i = 0; i < 3; i++) await tick();
  const resumed = await f.db.prepare('SELECT status,payload FROM auto_sync_state').first();
  assert.equal(resumed.status, 'completed');
  assert.ok(JSON.parse(resumed.payload).every(task => task.state === 'done'));
});

test('fresh consent preserves successful empty coverage and unrelated failures', async t => {
  const f = await fixture(t);
  const checked = '2026-07-01T01:00:00Z';
  for (const [collection, success, error] of [
    ['session', checked, null],
    ['daily_resilience', null, 'oura_scope_required'],
    ['ring_configuration', null, 'upstream_access_denied'],
    ['ring_battery_level', null, 'permission_or_membership_required'],
    ['daily_spo2', null, 'reconnect_required'],
    ['sleep', null, 'upstream_unavailable'],
  ]) {
    await f.db.prepare(`INSERT INTO health_sync_windows
      (user_id,collection,window_from,window_to,synced_at,attempted_at,last_error)
      VALUES ('test-user',?,?,?,?,?,?)`).bind(collection, today, today, success, checked, error).run();
  }
  await login(f.runtime);
  const rows = await f.db.prepare('SELECT collection,synced_at,attempted_at,last_error FROM health_sync_windows').all();
  const byName = Object.fromEntries(rows.results.map(row => [row.collection, row]));
  assert.equal(byName.session.synced_at, checked, 'an empty successful response remains valid coverage');
  assert.equal(byName.session.attempted_at, checked);
  assert.equal(byName.sleep.last_error, 'upstream_unavailable', 'consent does not resolve a provider outage');
  for (const name of ['daily_resilience', 'ring_configuration', 'ring_battery_level', 'daily_spo2']) {
    assert.equal(byName[name].last_error, null);
    assert.equal(byName[name].synced_at, null, 'an authorization failure still needs a real sync');
  }
});

test('revoked refresh credentials preserve the last snapshot and the website session', async t => {
  let revoked = false, refreshes = 0;
  const f = await fixture(t, url => {
    if (!revoked) return;
    if (url.pathname === '/oauth/token') {
      refreshes++;
      return Response.json({ error: 'invalid_grant' }, { status: 400 });
    }
    if (/\/daily_(sleep|readiness|activity)$/.test(url.pathname)) {
      return new Response('', { status: 401 });
    }
  });
  const before = await (await f.daily()).json();
  await f.db.prepare("UPDATE sync_state SET synced_at='2000-01-01T00:00:00Z'").run();
  revoked = true;
  const response = await f.daily();
  assert.equal(response.status, 200);
  const after = await response.json();
  assert.deepEqual(after.days, before.days);
  assert.equal(after.sync.error, 'reconnect_required');
  assert.equal(refreshes, 1);
  assert.equal((await (await f.me()).json()).authenticated, true);
});

test('cached data alone cannot release a real authorization block', async t => {
  const f = await fixture(t);
  assert.equal((await f.daily()).status, 200);
  await f.db.prepare(`INSERT INTO auto_sync_state(user_id,status,last_error)
    VALUES ('test-user','blocked','reconnect_required')`).run();
  assert.equal((await f.daily()).status, 200);
  assert.equal((await f.db.prepare('SELECT status FROM auto_sync_state').first()).status, 'blocked');
});
