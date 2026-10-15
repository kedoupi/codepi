import assert from 'node:assert/strict';
import { test } from 'node:test';
import { calendarDay } from '../../../../shared/dates.ts';
import { createRuntime, login, migrate } from './runtime.mjs';
import builtWorker from './node-worker.mjs';

const origin = 'https://oura.example';
const today = calendarDay();
const denied = ['daily_resilience', 'ring_configuration', 'ring_battery_level'];
const task = collection => ({ collection, from: today, to: today, state: 'pending', attempts: 0, after: 0 });

test('resource access rejection pauses the entire collection across cron, manual updates and new days', async t => {
  const calls = new Map();
  const runtime = createRuntime({ autoSync: true, providerResponse(url) {
    const name = url.pathname.split('/').at(-1);
    if (denied.includes(name)) {
      calls.set(name, (calls.get(name) ?? 0) + 1);
      return Response.json({ detail: 'Access denied' }, { status: 401 });
    }
  } });
  t.after(() => runtime.dispose());
  await migrate(runtime);
  const cookie = await login(runtime);
  const db = await runtime.getD1Database('DB');
  const worker = await runtime.getWorker();
  await db.prepare(`INSERT INTO health_records(user_id,collection,record_id,day,payload,fetched_at)
    VALUES ('test-user','ring_battery_level','saved',?,?,?)`)
    .bind(today, JSON.stringify({ timestamp: `${today}T00:00:00Z`, battery_level: 80 }), `${today}T00:00:00Z`).run();
  const queue = [...denied.flatMap(name => [task(name), task(name)]), task('sleep')];
  await db.prepare(`INSERT INTO auto_sync_state(user_id,run_day,status,payload)
    VALUES ('test-user',?,'running',?)`).bind(today, JSON.stringify(queue)).run();
  const tick = (offset = 0) => worker.scheduled({
    scheduledTime: Date.parse(`${today}T01:00:00Z`) + offset, cron: '*/2 * * * *',
  });
  for (let i = 0; i < 4; i++) await tick();
  assert.deepEqual(Object.fromEntries(calls), Object.fromEntries(denied.map(name => [name, 2])),
    'one initial request plus one fresh-token check per denied collection; no next-window retry');
  const tasks = JSON.parse((await db.prepare('SELECT payload FROM auto_sync_state').first()).payload);
  assert.equal(tasks.find(row => row.collection === 'sleep').state, 'done',
    'accessible collections must progress without waiting behind inaccessible windows');
  assert.ok(tasks.filter(row => denied.includes(row.collection)).every(row => row.state === 'unavailable'));
  const status = await runtime.dispatchFetch(`${origin}/api/me/health-records/status`, { headers: { Cookie: cookie } });
  const body = await status.json();
  assert.equal(body.automatic.status, 'completed');
  assert.equal(body.automatic.completed, body.automatic.total);
  assert.equal(body.automatic.remaining, 0);
  assert.equal(body.automatic.failed, 0);
  assert.equal(body.automatic.unavailable.length, 3);
  assert.ok(body.collections.filter(row => denied.includes(row.name))
    .every(row => row.access.status === 'unavailable' && row.access.automatic_retry === false
      && row.failed_windows === 0 && row.failed_ranges.length === 0));
  const before = Object.fromEntries(calls);
  const manual = await runtime.dispatchFetch(
    `${origin}/api/me/health-records?collection=ring_battery_level&from=${today}&to=${today}`,
    { method: 'POST', headers: { Cookie: cookie } });
  assert.equal(manual.status, 403, 'direct imports also honor the collection pause');
  const archive = await runtime.dispatchFetch(
    `${origin}/api/me/health-records?collection=ring_battery_level&from=${today}&to=${today}`,
    { headers: { Cookie: cookie } });
  assert.equal(archive.status, 200, 'saved records stay readable during an access pause');
  const archived = await archive.json();
  assert.equal(archived.access.status, 'unavailable');
  assert.equal(archived.access.automatic_retry, false);
  assert.equal(archived.records[0].battery_level, 80, 'an upstream refusal cannot erase the last good data');
  assert.equal(archived.sync.window_verified, false, 'refusal is not successful empty coverage');
  assert.deepEqual(Object.fromEntries(calls), before);
  await db.prepare("UPDATE auto_sync_state SET finished_at='2000-01-01T00:00:00Z'").run();
  const accepted = await builtWorker.fetch(new Request(`${origin}/api/me/health-records/automatic`, {
    method: 'POST', headers: { Cookie: cookie },
  }), await runtime.getBindings());
  assert.equal(accepted.status, 202);
  await db.prepare("UPDATE auto_sync_state SET status='completed'").run();
  await tick(86400000);
  assert.deepEqual(Object.fromEntries(calls), before, 'manual and next-day planning must retain the access pause');
  const nextTasks = JSON.parse((await db.prepare('SELECT payload FROM auto_sync_state').first()).payload);
  assert.ok(nextTasks.every(row => !denied.includes(row.collection)));
});

test('fresh OAuth consent clears access evidence and resumes previously unavailable work', async t => {
  let reject = true, calls = 0;
  const runtime = createRuntime({ autoSync: true, providerResponse(url) {
    if (url.pathname.endsWith('/daily_resilience')) {
      calls++;
      return reject ? new Response('', { status: 403 }) : Response.json({ data: [], next_token: null });
    }
  } });
  t.after(() => runtime.dispose());
  await migrate(runtime);
  await login(runtime);
  const db = await runtime.getD1Database('DB');
  const worker = await runtime.getWorker();
  const tick = () => worker.scheduled({ scheduledTime: Date.parse(`${today}T01:00:00Z`), cron: '*/2 * * * *' });
  await db.prepare(`INSERT INTO auto_sync_state(user_id,run_day,status,payload)
    VALUES ('test-user',?,'running',?)`).bind(today, JSON.stringify([task('daily_resilience')])).run();
  await tick();
  assert.equal(calls, 1, '403 must not rotate a healthy token');
  assert.equal((await db.prepare('SELECT status FROM auto_sync_state').first()).status, 'completed');
  await tick();
  assert.equal(calls, 1);
  reject = false;
  await login(runtime);
  assert.equal((await db.prepare('SELECT status FROM auto_sync_state').first()).status, 'running');
  await tick();
  assert.equal(calls, 2);
  assert.equal(JSON.parse((await db.prepare('SELECT payload FROM auto_sync_state').first()).payload)[0].state, 'done');
  const state = await db.prepare("SELECT last_error,synced_at FROM health_sync_windows WHERE collection='daily_resilience'").first();
  assert.equal(state.last_error, null);
  assert.ok(state.synced_at, 'a real successful empty response proves coverage after consent');
});

test('deployment reconciles historical denials and finishes old partial queues without provider requests', async t => {
  let calls = 0;
  const runtime = createRuntime({ autoSync: true, providerResponse(url) {
    if (denied.some(name => url.pathname.endsWith(`/${name}`))) calls++;
  } });
  t.after(() => runtime.dispose());
  await migrate(runtime);
  const cookie = await login(runtime);
  const db = await runtime.getD1Database('DB');
  const worker = await runtime.getWorker();
  // Older than the 90-day repair horizon: resource access is not date-bound.
  await db.prepare(`INSERT INTO health_sync_windows
    (user_id,collection,window_from,window_to,attempted_at,last_error)
    VALUES ('test-user','ring_configuration','2000-01-01','2000-01-01','2000-01-01T00:00:00Z','upstream_access_denied')`).run();
  const queue = [{ ...task('ring_configuration'), state: 'failed', error: 'upstream_access_denied' }];
  await db.prepare(`INSERT INTO auto_sync_state(user_id,run_day,status,last_error,payload)
    VALUES ('test-user',?,'partial','upstream_access_denied',?)`).bind(today, JSON.stringify(queue)).run();
  await worker.scheduled({ scheduledTime: Date.parse(`${today}T00:00:00Z`), cron: '*/2 * * * *' });
  assert.equal(calls, 0);
  const row = await db.prepare('SELECT status,last_error,payload FROM auto_sync_state').first();
  assert.equal(row.status, 'completed');
  assert.equal(row.last_error, null);
  assert.equal(JSON.parse(row.payload)[0].state, 'unavailable');
  await db.prepare("UPDATE auto_sync_state SET finished_at='2000-01-01T00:00:00Z'").run();
  await builtWorker.fetch(new Request(`${origin}/api/me/health-records/automatic`, {
    method: 'POST', headers: { Cookie: cookie },
  }), await runtime.getBindings());
  assert.ok(JSON.parse((await db.prepare('SELECT payload FROM auto_sync_state').first()).payload)
    .every(row => row.collection !== 'ring_configuration'));
  assert.equal(calls, 0);
});

test('a newer successful check supersedes historical access denials', async t => {
  const runtime = createRuntime();
  t.after(() => runtime.dispose());
  await migrate(runtime);
  const cookie = await login(runtime);
  const db = await runtime.getD1Database('DB');
  await db.prepare(`INSERT INTO health_sync_windows
    (user_id,collection,window_from,window_to,synced_at,attempted_at,last_error)
    VALUES ('test-user','daily_resilience','2000-01-01','2000-01-01',NULL,'2000-01-01T00:00:00Z','upstream_access_denied'),
      ('test-user','daily_resilience',?,?,'2001-01-01T00:00:00Z','2001-01-01T00:00:00Z',NULL)`).bind(today, today).run();
  const response = await runtime.dispatchFetch(`${origin}/api/me/health-records/status`, { headers: { Cookie: cookie } });
  const result = await response.json();
  assert.equal(result.automatic.unavailable.length, 0);
  assert.equal(result.collections.find(row => row.name === 'daily_resilience').access.status, 'available');
});

test('fresh-token score refusals stay visible, have bounded retries and never starve details', async t => {
  let calls = 0, reject = true;
  const runtime = createRuntime({ autoSync: true, providerResponse(url) {
    if (/\/daily_(sleep|readiness|activity)$/.test(url.pathname)) {
      calls++;
      if (reject) return new Response('', { status: 401 });
    }
  } });
  t.after(() => runtime.dispose());
  await migrate(runtime);
  await login(runtime);
  const db = await runtime.getD1Database('DB');
  const worker = await runtime.getWorker();
  const tick = () => worker.scheduled({ scheduledTime: Date.parse(`${today}T01:00:00Z`), cron: '*/2 * * * *' });
  await db.prepare(`INSERT INTO auto_sync_state(user_id,run_day,status,payload)
    VALUES ('test-user',?,'running',?)`).bind(today, JSON.stringify([task('__scores'), task('sleep')])).run();
  await tick();
  await tick();
  let queue = JSON.parse((await db.prepare('SELECT payload FROM auto_sync_state').first()).payload);
  assert.equal(queue[1].state, 'done', 'a rejected score refresh must not occupy the queue on every tick');
  for (let attempt = 2; attempt <= 3; attempt++) {
    queue[0].after = 0;
    await db.prepare("UPDATE auto_sync_state SET payload=?").bind(JSON.stringify(queue)).run();
    await tick();
    queue = JSON.parse((await db.prepare('SELECT payload FROM auto_sync_state').first()).payload);
  }
  assert.equal(queue[0].state, 'failed');
  assert.equal(queue[0].attempts, 3);
  const before = calls;
  await tick();
  assert.equal(calls, before, 'a finished score failure must not automatically resurrect');
  const row = await db.prepare('SELECT status,last_error FROM auto_sync_state').first();
  assert.equal(row.status, 'partial');
  assert.equal(row.last_error, 'upstream_access_denied');
  reject = false;
  await login(runtime);
  queue = JSON.parse((await db.prepare('SELECT payload FROM auto_sync_state').first()).payload);
  assert.equal(queue[0].state, 'pending', 'new consent must also restore an exhausted score refusal');
  assert.equal(queue[0].attempts, 0);
  await tick();
  assert.equal((await db.prepare('SELECT status FROM auto_sync_state').first()).status, 'completed');
});

test('a late refusal cannot overwrite fresh OAuth consent', { timeout: 15000 }, async t => {
  let release, notify;
  const started = new Promise(resolve => { notify = resolve; });
  const gate = new Promise(resolve => { release = resolve; });
  let held = true;
  const runtime = createRuntime({ providerResponse(url) {
    if (url.pathname.endsWith('/daily_resilience') && held) {
      notify();
      return gate.then(() => new Response('', { status: 403 }));
    }
  } });
  t.after(() => { release(); return runtime.dispose(); });
  await migrate(runtime);
  const cookie = await login(runtime);
  const db = await runtime.getD1Database('DB');
  const endpoint = `${origin}/api/me/health-records?collection=daily_resilience&from=${today}&to=${today}`;
  const pending = runtime.dispatchFetch(endpoint, { method: 'POST', headers: { Cookie: cookie } });
  await started;
  await login(runtime);
  held = false;
  release();
  assert.equal((await pending).status, 403);
  assert.equal((await db.prepare("SELECT COUNT(*) AS n FROM health_sync_windows WHERE last_error IS NOT NULL").first()).n, 0,
    'an old grant must not establish a permanent pause after new consent');
  assert.equal((await runtime.dispatchFetch(endpoint, { method: 'POST', headers: { Cookie: cookie } })).status, 200);
});

test('a late token refresh cannot replace a newly authorized grant or its queue', { timeout: 15000 }, async t => {
  let release, notify;
  const refreshing = new Promise(resolve => { notify = resolve; });
  const gate = new Promise(resolve => { release = resolve; });
  let consenting = 0;
  const runtime = createRuntime({ autoSync: true, providerResponse(url, request) {
    if (url.pathname === '/oauth/token') {
      return request.text().then(body => {
        if (new URLSearchParams(body).get('grant_type') === 'refresh_token') {
          notify();
          return gate.then(() => Response.json({ access_token: 'late-refresh', refresh_token: 'late-refresh', expires_in: 86400 }));
        }
        consenting++;
        return Response.json({ access_token: `consent-${consenting}`, refresh_token: 'consent-refresh', expires_in: 86400 });
      });
    }
    if (url.pathname.endsWith('/daily_resilience') && request.headers.get('Authorization') === 'Bearer consent-1') {
      return new Response('', { status: 401 });
    }
  } });
  t.after(() => { release(); return runtime.dispose(); });
  await migrate(runtime);
  await login(runtime);
  const db = await runtime.getD1Database('DB');
  const worker = await runtime.getWorker();
  await db.prepare(`INSERT INTO auto_sync_state(user_id,run_day,status,payload)
    VALUES ('test-user',?,'running',?)`).bind(today, JSON.stringify([task('daily_resilience')])).run();
  const tick = () => worker.scheduled({ scheduledTime: Date.parse(`${today}T01:00:00Z`), cron: '*/2 * * * *' });
  const pending = tick();
  await refreshing;
  await login(runtime);
  const consentRecord = await db.prepare('SELECT ciphertext,iv FROM encrypted_tokens').first();
  const consentQueue = await db.prepare('SELECT payload,lease_id FROM auto_sync_state').first();
  release();
  await pending;
  const after = await db.prepare('SELECT ciphertext,iv FROM encrypted_tokens').first();
  assert.ok(after.ciphertext === consentRecord.ciphertext && after.iv === consentRecord.iv,
    'compare-and-swap must reject the stale refresh write');
  assert.deepEqual(await db.prepare('SELECT payload,lease_id FROM auto_sync_state').first(), consentQueue,
    'an old executor must not replace the resumed queue');
  await tick();
  assert.equal((await db.prepare('SELECT status FROM auto_sync_state').first()).status, 'completed');
});

test('imports recheck refusals established between the fast check and lease acquisition', async t => {
  let calls = 0;
  const runtime = createRuntime({ providerResponse(url) {
    if (url.pathname.endsWith('/daily_resilience')) calls++;
  } });
  t.after(() => runtime.dispose());
  await migrate(runtime);
  const cookie = await login(runtime);
  const bindings = await runtime.getBindings();
  const db = bindings.DB;
  t.mock.method(globalThis, 'fetch', async url => {
    assert.equal(new URL(url).pathname, '/v2/usercollection/daily_resilience');
    calls++;
    return Response.json({ data: [], next_token: null });
  });
  let injected = false;
  const dbWithInterleaving = new Proxy(db, { get(target, key) {
    if (key !== 'prepare') return typeof target[key] === 'function' ? target[key].bind(target) : target[key];
    return sql => {
      const statement = target.prepare(sql);
      if (!sql.startsWith('INSERT INTO sync_state')) return statement;
      return { bind(...args) {
        const bound = statement.bind(...args);
        return { async first() {
          // A concurrent writer has just saved its refusal and released the
          // lease. Reproduce that exact boundary without timing-dependent sleeps.
          if (!injected) {
            injected = true;
            await db.prepare(`INSERT INTO health_sync_windows
              (user_id,collection,window_from,window_to,attempted_at,last_error)
              VALUES ('test-user','daily_resilience',?,?,'2000-01-01T00:00:00Z','upstream_access_denied')`)
              .bind(today, today).run();
          }
          return bound.first();
        } };
      } };
    };
  } });
  const response = await builtWorker.fetch(new Request(
    `${origin}/api/me/health-records?collection=daily_resilience&from=${today}&to=${today}`,
    { method: 'POST', headers: { Cookie: cookie } }), { ...bindings, DB: dbWithInterleaving });
  assert.equal(injected, true);
  assert.equal(response.status, 403);
  assert.equal(calls, 0, 'the second guard must prevent even one redundant provider call');
  assert.equal((await db.prepare('SELECT attempted_at FROM health_sync_windows').first()).attempted_at,
    '2000-01-01T00:00:00Z', 'a local pause check is not a fresh upstream attempt');
});

test('a late successful import cannot replace the history saved after new consent', { timeout: 15000 }, async t => {
  let release, notify, held = true;
  const started = new Promise(resolve => { notify = resolve; });
  const gate = new Promise(resolve => { release = resolve; });
  const record = id => Response.json({ data: [{ id, day: today, level: id }], next_token: null });
  const runtime = createRuntime({ providerResponse(url) {
    if (url.pathname.endsWith('/daily_resilience')) {
      if (!held) return record('new');
      notify();
      return gate.then(() => record('old'));
    }
  } });
  t.after(() => { release(); return runtime.dispose(); });
  await migrate(runtime);
  const cookie = await login(runtime);
  const db = await runtime.getD1Database('DB');
  const endpoint = `${origin}/api/me/health-records?collection=daily_resilience&from=${today}&to=${today}`;
  const request = () => runtime.dispatchFetch(endpoint, { method: 'POST', headers: { Cookie: cookie } });
  const pending = request();
  await started;
  await login(runtime);
  held = false;
  assert.equal((await request()).status, 200);
  release();
  assert.equal((await pending).status, 409);
  const rows = await db.prepare("SELECT record_id FROM health_records WHERE collection='daily_resilience'").all();
  assert.deepEqual(rows.results, [{ record_id: 'new' }], 'fenced writers cannot delete or reinsert a previous snapshot');
  assert.equal((await db.prepare('SELECT last_error FROM health_sync_windows').first()).last_error, null);
});

test('a late success cannot unlock a newer revoked grant', { timeout: 15000 }, async t => {
  let release, notify, revoked = false, refreshes = 0;
  const started = new Promise(resolve => { notify = resolve; });
  const gate = new Promise(resolve => { release = resolve; });
  const runtime = createRuntime({ autoSync: true, providerResponse(url) {
    if (url.pathname.endsWith('/daily_resilience')) {
      notify();
      return gate.then(() => Response.json({ data: [], next_token: null }));
    }
    if (revoked && url.pathname === '/oauth/token') {
      refreshes++;
      return Response.json({ error: 'invalid_grant' }, { status: 400 });
    }
    if (revoked && /\/daily_(sleep|readiness|activity)$/.test(url.pathname)) return new Response('', { status: 401 });
  } });
  t.after(() => { release(); return runtime.dispose(); });
  await migrate(runtime);
  const cookie = await login(runtime);
  const db = await runtime.getD1Database('DB');
  const worker = await runtime.getWorker();
  const pending = runtime.dispatchFetch(
    `${origin}/api/me/health-records?collection=daily_resilience&from=${today}&to=${today}`,
    { method: 'POST', headers: { Cookie: cookie } });
  await started;
  await login(runtime);
  await db.prepare(`INSERT INTO auto_sync_state(user_id,run_day,status,payload)
    VALUES ('test-user',?,'running',?)`).bind(today, JSON.stringify([task('__scores')])).run();
  revoked = true;
  const tick = () => worker.scheduled({ scheduledTime: Date.parse(`${today}T01:00:00Z`), cron: '*/2 * * * *' });
  await tick();
  assert.equal((await db.prepare('SELECT status FROM auto_sync_state').first()).status, 'blocked');
  release();
  assert.equal((await pending).status, 409);
  const row = await db.prepare('SELECT status,last_error FROM auto_sync_state').first();
  assert.equal(row.status, 'blocked', 'a fenced request cannot clear a subsequent authorization failure');
  assert.equal(row.last_error, 'reconnect_required');
  await tick();
  assert.equal(refreshes, 1, 'revoked authorization must stay blocked without another token refresh');
});
