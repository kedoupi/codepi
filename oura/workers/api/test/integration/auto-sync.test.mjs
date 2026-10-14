import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createRuntime, login, migrate } from './runtime.mjs';

const origin = 'https://oura.example';
const today = new Date().toISOString().slice(0, 10);
const day = back => new Date(Date.parse(today) - back * 86400000).toISOString().slice(0, 10);
const scheduledTime = Date.parse(`${today}T01:00:00Z`);
const pending = (collection, from = today, to = today) =>
  ({ collection, from, to, state: 'pending', attempts: 0, after: 0 });

async function fixture(t, providerResponse) {
  const runtime = createRuntime({ autoSync: true, providerResponse });
  t.after(() => runtime.dispose());
  await migrate(runtime);
  const cookie = await login(runtime);
  const db = await runtime.getD1Database('DB');
  const worker = await runtime.getWorker();
  return {
    runtime, db, cookie,
    async tick(time = scheduledTime) {
      const result = await worker.scheduled({ scheduledTime: time, cron: '*/2 * * * *' });
      assert.equal(result.outcome, 'ok');
    },
    async status() {
      const response = await runtime.dispatchFetch(`${origin}/api/me/health-records/status`, { headers: { Cookie: cookie } });
      assert.equal(response.status, 200);
      return (await response.json()).automatic;
    },
    async queue(tasks) {
      await db.prepare(`INSERT OR REPLACE INTO auto_sync_state(user_id,run_day,status,payload)
        VALUES ('test-user',?,'running',?)`).bind(today, JSON.stringify(tasks)).run();
    },
    async tasks() {
      return JSON.parse((await db.prepare("SELECT payload FROM auto_sync_state WHERE user_id='test-user'").first()).payload);
    },
  };
}

test('09:00 gate, durable batches, successful empty coverage, score refresh and once-a-day completion', async t => {
  let calls = 0;
  const f = await fixture(t, () => { calls++; });
  await f.tick(scheduledTime - 120000);
  assert.equal((await f.status()).status, 'idle');
  const localDay = new Date(Date.now() + 8 * 3600000).toISOString().slice(0, 10);
  if (Date.now() >= Date.parse(`${localDay}T01:00:00Z`)) {
    assert.ok(Date.parse((await f.status()).next_run_at) <= Date.now() + 120000,
      'a due first run should show the next tick, not tomorrow');
  }
  assert.equal(calls, 2, 'only OAuth login has called Oura before 09:00');
  const collections = ['sleep','daily_sleep','daily_readiness','daily_activity','heartrate','daily_spo2',
    'daily_stress','daily_resilience','daily_cardiovascular_age','vO2_max','workout','enhanced_tag',
    'session','sleep_time','rest_mode_period','ring_battery_level'];
  await f.db.batch(collections.map(name => f.db.prepare(`INSERT INTO health_sync_windows
    (user_id,collection,window_from,window_to,synced_at,attempted_at) VALUES ('test-user',?,?,?,?,?)`)
    .bind(name, day(89), day(7), `${today}T00:00:00Z`, `${today}T00:00:00Z`)));
  await f.tick();
  assert.equal((await f.status()).completed, 1, 'first tick refreshes homepage scores');
  assert.equal((await f.db.prepare("SELECT COUNT(*) AS n FROM daily_cache").first()).n, 90);
  assert.equal((await f.tasks()).filter(task => task.from < day(6)).length, 0, 'no repeat of successfully checked empty history');
  const total = (await f.status()).total;
  for (let i = 1; i < total; i++) await f.tick();
  const result = await f.status();
  assert.equal(result.status, 'completed');
  assert.equal(result.completed, result.total);
  assert.ok(result.last_success_at);
  const before = calls;
  await f.tick();
  assert.equal(calls, before, 'completed run must not restart on the same day');
});

test('unverified history is queued; a later failed subwindow overrides older successful coverage', async t => {
  const f = await fixture(t);
  await f.db.prepare(`INSERT INTO health_sync_windows
    (user_id,collection,window_from,window_to,synced_at,attempted_at) VALUES ('test-user','heartrate',?,?,?,?)`)
    .bind(day(89), day(7), '2000-01-01T00:00:00Z', '2000-01-01T00:00:00Z').run();
  await f.db.prepare(`INSERT INTO health_sync_windows
    (user_id,collection,window_from,window_to,attempted_at,last_error) VALUES ('test-user','heartrate',?,?,?,'upstream_unavailable')`)
    .bind(day(15), day(15), '2001-01-01T00:00:00Z').run();
  await f.tick();
  const tasks = await f.tasks();
  assert.equal(tasks.filter(t => t.collection === 'heartrate' && t.from < day(6)).length, 1);
  assert.ok(tasks.some(t => t.collection === 'heartrate' && t.from === day(15)));
  assert.equal(tasks.filter(t => t.collection === 'ring_battery_level').length, 90);
});

test('expired scheduler lease resumes; shared manual lease and duplicate events cannot duplicate a batch', async t => {
  let calls = 0;
  const f = await fixture(t, url => {
    if (url.pathname.endsWith('/heartrate')) { calls++; return Response.json({ data: [], next_token: null }); }
  });
  await f.queue([pending('heartrate')]);
  await f.db.prepare("INSERT INTO sync_state(user_id,lease_id,lease_until) VALUES ('test-user','manual',?)")
    .bind(Date.now() + 120000).run();
  await f.tick();
  assert.equal(calls, 0);
  assert.equal((await f.tasks())[0].attempts, 0);
  await f.db.prepare("UPDATE sync_state SET lease_until=0").run();
  await f.queue([pending('heartrate')]);
  await f.db.prepare("UPDATE auto_sync_state SET lease_id='interrupted',lease_until=1").run();
  await Promise.all([f.tick(), f.tick()]);
  assert.equal(calls, 1);
  assert.equal((await f.status()).status, 'completed');
});

test('rate limits delay the entire queue; retryable failures have a bounded retry budget', async t => {
  let calls = 0;
  const f = await fixture(t, url => {
    if (url.pathname.endsWith('/heartrate')) { calls++; return new Response('', { status: 429 }); }
  });
  await f.queue([pending('heartrate'), pending('sleep')]);
  await f.tick();
  await f.tick();
  assert.equal(calls, 1);
  assert.equal((await f.tasks()).every(t => t.after > Date.now()), true);
  for (let attempt = 2; attempt <= 3; attempt++) {
    const tasks = await f.tasks();
    tasks[0].after = 0;
    await f.queue(tasks);
    await f.db.prepare("UPDATE health_sync_windows SET attempted_at='2000-01-01T00:00:00Z'").run();
    await f.tick();
  }
  assert.equal((await f.tasks())[0].state, 'failed');
  assert.equal((await f.tasks())[0].attempts, 3);
});

test('authorization failure pauses without repeated requests; a real OAuth callback resumes the job', async t => {
  let reject = true, calls = 0;
  const f = await fixture(t, url => {
    if (url.pathname.endsWith('/heartrate')) {
      calls++;
      return reject ? new Response('', { status: 401 }) : Response.json({ data: [], next_token: null });
    }
  });
  await f.queue([pending('heartrate')]);
  await f.tick();
  assert.equal((await f.status()).status, 'blocked');
  await f.tick(scheduledTime + 86400000);
  assert.equal(calls, 1, 'a new day must not retry revoked credentials');
  reject = false;
  await login(f.runtime);
  await f.tick();
  assert.equal((await f.status()).status, 'completed');
});

test('large windows split durably; one failed permission collection does not stop other data', async t => {
  const f = await fixture(t, url => {
    if (url.pathname.endsWith('/sleep')) {
      const from = url.searchParams.get('start_date');
      const to = url.searchParams.get('end_date');
      return Response.json({ data: Date.parse(to) - Date.parse(from) > 86400000
        ? Array.from({ length: 5001 }, () => ({})) : [], next_token: null });
    }
    if (url.pathname.endsWith('/daily_spo2')) return new Response('', { status: 403 });
  });
  await f.queue([pending('sleep', day(1)), pending('daily_spo2'), pending('daily_spo2', day(1), day(1)), pending('heartrate')]);
  await f.tick();
  assert.equal((await f.tasks())[0].state, 'split');
  for (let i = 0; i < 4; i++) await f.tick();
  const status = await f.status();
  assert.equal(status.status, 'partial');
  assert.equal(status.failed, 2);
  assert.equal(status.completed, 3);
  assert.equal((await f.db.prepare("SELECT COUNT(*) AS n FROM health_sync_windows WHERE last_error='sync_window_too_large'").first()).n, 0);
});

test('daily cleanup removes only expired temporary state and old analysis cache', async t => {
  const f = await fixture(t);
  await f.db.batch([
    f.db.prepare("INSERT INTO sessions(id,user_id,expires_at) VALUES ('expired','test-user','2000-01-01')"),
    f.db.prepare("INSERT INTO oauth_states(state,expires_at) VALUES ('expired','2000-01-01'),('live','2999-01-01')"),
    f.db.prepare("INSERT INTO analysis_cache(user_id,fingerprint,payload,created_at) VALUES ('test-user','old','{}','2000-01-01')"),
    f.db.prepare("INSERT INTO health_records(user_id,collection,record_id,day,payload,fetched_at) VALUES ('test-user','sleep','old','1999-01-01','{}','2000-01-01')"),
    f.db.prepare("INSERT INTO mcp_tokens(token_hash,user_id,client_id,kind,expires_at,revoked_at) VALUES ('revoked','test-user','client','refresh',1,1)"),
  ]);
  await f.tick();
  assert.equal(await f.db.prepare("SELECT id FROM sessions WHERE id='expired'").first(), null);
  assert.equal((await f.db.prepare("SELECT COUNT(*) AS n FROM oauth_states").first()).n, 1);
  assert.equal((await f.db.prepare("SELECT COUNT(*) AS n FROM analysis_cache").first()).n, 0);
  assert.equal((await f.db.prepare("SELECT COUNT(*) AS n FROM health_records WHERE record_id='old'").first()).n, 1);
  assert.equal((await f.db.prepare("SELECT COUNT(*) AS n FROM mcp_tokens").first()).n, 1);
});

test('a new daily refresh prioritizes fresh data while re-planning unverified history', async t => {
  const f = await fixture(t);
  await f.queue([pending('heartrate', day(1), day(1))]);
  await f.db.prepare("UPDATE auto_sync_state SET run_day=?,last_success_at='2000-01-01T00:00:00Z'").bind(day(1)).run();
  await f.tick(scheduledTime - 120000);
  assert.equal((await f.status()).completed, 0, 'old backlog must not consume the new daily budget before the morning refresh');
  await f.tick();
  assert.equal((await f.status()).run_day, today);
  assert.equal((await f.status()).status, 'running');
  assert.equal((await f.status()).completed, 1);
  assert.equal((await f.status()).last_success_at, '2000-01-01T00:00:00Z');
  assert.ok((await f.tasks()).some(t => t.collection === 'heartrate' && t.from === day(1) && t.state === 'pending'));
});

test('disabled schedules and accounts with no stored authorization do not start a job', async t => {
  const runtime = createRuntime();
  t.after(() => runtime.dispose());
  await migrate(runtime);
  await login(runtime);
  const worker = await runtime.getWorker();
  await worker.scheduled({ scheduledTime, cron: '*/2 * * * *' });
  const db = await runtime.getD1Database('DB');
  assert.equal((await db.prepare("SELECT COUNT(*) AS n FROM auto_sync_state").first()).n, 0);
  const f = await fixture(t);
  await f.db.prepare("DELETE FROM encrypted_tokens").run();
  await f.tick();
  assert.equal((await f.status()).status, 'idle');
});

test('automatic write budget defers work without damaging saved data; a new UTC day resets it', async t => {
  let calls = 0;
  const f = await fixture(t, url => {
    if (url.pathname.endsWith('/heartrate')) {
      calls++;
      return Response.json({ data: [{ timestamp: `${today}T01:00:00Z`, bpm: 60 }], next_token: null });
    }
  });
  await f.queue([pending('heartrate'), pending('sleep')]);
  await f.db.prepare("INSERT INTO auto_sync_budget(user_id,utc_day,reserved_rows) VALUES ('test-user',?,400000)").bind(today).run();
  await f.tick();
  assert.equal((await f.status()).error, 'daily_sync_budget_reached');
  assert.equal((await f.tasks())[0].attempts, 0);
  assert.equal((await f.db.prepare("SELECT COUNT(*) AS n FROM health_records").first()).n, 0);
  assert.equal((await f.db.prepare("SELECT COUNT(*) AS n FROM health_sync_windows").first()).n, 0);
  await f.tick();
  assert.equal(calls, 1, 'waiting for budget must not poll Oura every two minutes');
  await f.db.prepare("UPDATE auto_sync_budget SET utc_day=?").bind(day(1)).run();
  const tasks = await f.tasks();
  tasks.forEach(t => t.after = 0);
  await f.queue(tasks);
  await f.tick();
  assert.equal((await f.status()).completed, 1);
  assert.equal((await f.status()).error, null);
  const budget = await f.db.prepare("SELECT * FROM auto_sync_budget").first();
  assert.equal(budget.utc_day, today);
  assert.ok(budget.reserved_rows > 0 && budget.reserved_rows < 400000);
});

test('lightweight progress polling is owner-only and does not expose archived records', async t => {
  const f = await fixture(t);
  assert.equal((await f.runtime.dispatchFetch(`${origin}/api/me/health-records/automatic`)).status, 401);
  const response = await f.runtime.dispatchFetch(`${origin}/api/me/health-records/automatic`, { headers: { Cookie: f.cookie } });
  assert.equal(response.status, 200);
  const status = await response.json();
  assert.equal(status.enabled, true);
  assert.equal(status.status, 'idle');
  assert.equal(status.collections, undefined);
  assert.equal((await f.runtime.dispatchFetch(`${origin}/api/me/health-records/automatic`, {
    method: 'POST', headers: { Cookie: f.cookie },
  })).status, 405);
});

test('every scheduled invocation leaves one structured line, including wrong-cron skips', async t => {
  const f = await fixture(t);
  const logs = [];
  t.mock.method(console, 'log', line => logs.push(JSON.parse(line)));
  const worker = await f.runtime.getWorker();
  await worker.scheduled({ scheduledTime, cron: '0 1 * * *' });
  assert.deepEqual(logs, [{ event: 'auto_sync', action: 'skip', reason: 'disabled_or_wrong_cron',
    cron: '0 1 * * *', enabled: true, ownerConfigured: true }], 'a wrong cron must say so instead of failing silently');
  logs.length = 0;
  await f.tick();
  assert.equal(logs.filter(entry => entry.event === 'auto_sync').length >= 2, true,
    'a real run reports its plan and processed batch');
  assert.equal(logs[0].action, 'plan');
  assert.equal(logs[1].action, 'task');
});
