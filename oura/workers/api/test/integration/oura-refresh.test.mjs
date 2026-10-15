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
  assert.equal(row.status, 'running');
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
