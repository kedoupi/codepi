import { test } from 'node:test';
import assert from 'node:assert/strict';
import { planBackfill, runBackfill, windowDays } from '../src/lib/backfill.ts';

const window = { collection: 'heartrate', from: '2026-10-08', to: '2026-10-14' };
const fail = code => { throw { code }; };
test('dense time series are scheduled daily across all 90 days; snapshots once', () => {
  const plan = planBackfill([{ name: 'heartrate', mode: 'time' }, { name: 'personal_info', mode: 'profile' }], 90, '2026-10-14');
  assert.equal(plan.length, 91);
  assert.ok(plan.every(w => windowDays(w) === 1));
  assert.equal(plan[89].from, '2026-07-17');
});
test('oversized seven-day window splits until accepted, covers all days and continues next collection', async () => {
  const saved = [], progress = [];
  const result = await runBackfill([window, { ...window, collection: 'sleep' }], {
    request: async w => { if (w.collection === 'heartrate' && windowDays(w) > 1) fail('sync_window_too_large'); saved.push(w); },
    shouldStop: () => false, progress: state => progress.push(state.completed),
  });
  assert.equal(result.failed.length, 0);
  assert.equal(result.splits, 6);
  assert.equal(result.completed, 14);
  assert.equal(new Set(saved.filter(w => w.collection === 'heartrate').map(w => w.from)).size, 7);
  assert.equal(saved.at(-1).collection, 'sleep');
  assert.ok(progress.every((n, i) => i === 0 || n >= progress[i - 1]));
});
test('single-day limit does not recurse forever or skip later days', async () => {
  let attempts = 0;
  const result = await runBackfill([window], {
    request: async () => { attempts++; fail('sync_window_too_large'); },
    shouldStop: () => false, progress: () => {},
  });
  assert.equal(attempts, 13);
  assert.equal(result.failed.length, 7);
  assert.equal(result.completed, 0);
});
test('stopping waits for current batch and preserves pending work', async () => {
  let stop = false;
  const plan = planBackfill([{ name: 'heartrate', mode: 'time' }], 7, '2026-10-14');
  const result = await runBackfill(plan, { request: async () => { stop = true; }, shouldStop: () => stop, progress: () => {} });
  assert.equal(result.completed, 1);
  assert.equal(result.remaining.length, 6);
});
test('authorization and rate limits stop the run, retaining only unfinished work for retry', async () => {
  for (const code of ['reconnect_required', 'rate_limited', 'unauthorized', 'network_error']) {
    let attempts = 0;
    const plan = planBackfill([{ name: 'heartrate', mode: 'time' }], 7, '2026-10-14');
    const result = await runBackfill(plan, { request: async () => { attempts++; fail(code); }, shouldStop: () => false, progress: () => {} });
    assert.equal(attempts, 1);
    assert.equal(result.failed[0].code, code);
    assert.equal(result.remaining.length, 6);
  }
});
test('denied collection retains skipped windows while other collections proceed', async () => {
  const result = await runBackfill([window, { ...window, from: '2026-10-01', to: '2026-10-07' }, { ...window, collection: 'sleep' }], {
    request: async w => { if (w.collection === 'heartrate') fail('permission_or_membership_required'); },
    shouldStop: () => false, progress: () => {},
  });
  assert.equal(result.failed.length, 1);
  assert.equal(result.remaining.length, 1);
  assert.equal(result.completed, 7);
});
