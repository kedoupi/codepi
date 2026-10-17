import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { calendarDay } from '../../../../shared/dates.ts';
import { createRuntime, login, migrate } from './runtime.mjs';

for (const hold of ['rate_limited', 'daily_sync_budget_reached', 'storage_write_quota_exceeded']) {
test(`consent coverage repair preserves retries, valid empty coverage and ${hold} cooldown`, async t => {
  const runtime = createRuntime({ autoSync: true });
  t.after(() => runtime.dispose());
  await migrate(runtime);
  await login(runtime);
  const db = await runtime.getD1Database('DB');
  const today = calendarDay();
  const day = back => new Date(Date.parse(today) - back * 86400000).toISOString().slice(0, 10);
  const done = collection => ({ collection, from: today, to: today, state: 'done', attempts: 0, after: 0 });
  const waiting = { ...done('heartrate'), state: 'pending', attempts: 2,
    after: Date.now() + 900000, error: hold };
  const failed = { ...done('workout'), state: 'failed', attempts: 3, error: 'upstream_unavailable' };
  const paused = { ...done('ring_configuration'), state: 'unavailable', error: 'oura_scope_required' };
  const tasks = [done('__scores'), done('sleep'), done('session'), waiting, failed, paused];
  await db.prepare(`INSERT INTO auto_sync_state
    (user_id,run_day,status,payload,lease_id,lease_until) VALUES ('test-user',?,'completed',?,'old-writer',?)`)
    .bind(today, JSON.stringify(tasks), Date.now() + 120000).run();
  await db.prepare("INSERT INTO auto_sync_budget VALUES ('test-user',?,12345)").bind(today).run();
  for (const [collection, from, to, synced] of [
    ['sleep', today, today, null],
    ['session', today, today, `${today}T00:00:00Z`],
    ['daily_sleep', day(95), day(80), null],
    ['daily_readiness', day(100), day(95), null],
  ]) {
    await db.prepare(`INSERT INTO health_sync_windows
      (user_id,collection,window_from,window_to,synced_at,attempted_at)
      VALUES ('test-user',?,?,?,?,?)`).bind(collection, from, to, synced, `${today}T00:00:00Z`).run();
  }
  const migration = (await readFile(new URL('../../../../migrations/0011_repair_consent_coverage.sql', import.meta.url), 'utf8'))
    .replace(/--[^\n]*/g, '');
  await db.prepare(migration).run();
  const row = await db.prepare('SELECT * FROM auto_sync_state').first();
  const repaired = JSON.parse(row.payload);
  assert.equal(row.status, 'running');
  assert.equal(row.lease_until, 0);
  assert.notEqual(row.lease_id, 'old-writer', 'an old worker cannot overwrite the repaired queue');
  assert.deepEqual(repaired[0], tasks[0], 'score state is independent of detailed coverage');
  assert.equal(repaired[1].state, 'pending');
  assert.equal(repaired[1].after, waiting.after, 'rechecking a completed task cannot bypass the provider cooldown');
  assert.deepEqual(repaired.slice(2, 6), tasks.slice(2), 'valid empty coverage and unfinished work are unchanged');
  assert.deepEqual(repaired[6], {
    collection: 'daily_sleep', from: day(89), to: day(80), state: 'pending', attempts: 0, after: waiting.after,
  }, 'previously covered history absent from the queue is rechecked within the original 90 days');
  assert.equal(repaired.length, 7);
  assert.equal((await db.prepare('SELECT reserved_rows FROM auto_sync_budget').first()).reserved_rows, 12345);
  assert.equal((await db.prepare("SELECT synced_at FROM health_sync_windows WHERE collection='session'").first()).synced_at,
    `${today}T00:00:00Z`, 'repair does not invent or remove coverage evidence');
  await db.prepare(migration).run();
  assert.deepEqual(await db.prepare('SELECT * FROM auto_sync_state').first(), row, 'repair is idempotent');
  await db.prepare(`UPDATE auto_sync_state SET status='blocked',last_error='reconnect_required',payload=?`)
    .bind(JSON.stringify([...repaired, done('daily_readiness')])).run();
  await db.prepare(migration).run();
  const blocked = await db.prepare('SELECT status,last_error FROM auto_sync_state').first();
  assert.deepEqual(blocked, { status: 'blocked', last_error: 'reconnect_required' },
    'coverage repair cannot silently clear a genuine authorization block');
});
}
