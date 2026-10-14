import { test } from 'node:test';
import assert from 'node:assert/strict';
import { journalData, historicalHrvRange, latestPoint, mean, scorePoints } from '../src/lib/journal.ts';

const end = '2026-10-14';
test('journal keeps calendar gaps, valid zero steps, and rejects invalid scores', () => {
  const model = journalData([
    { date: end, sleep: { score: 101 }, readiness: { score: 0 }, activity: { steps: 0 } },
    { date: '2026-10-12', sleep: { score: 80 }, activity: { steps: -10 } },
  ], [], end);
  assert.equal(model.calendar.length, 90);
  assert.equal(model.steps.length, 30);
  assert.equal(model.steps.at(-1).value, 0);
  assert.equal(model.steps.at(-2).value, null);
  assert.equal(model.steps.at(-3).value, null);
  assert.equal(model.latest.date, end);
  assert.equal(model.latest.sleep.score, null);
  assert.equal(mean(model.steps), 0);
  assert.equal(scorePoints(model.recent, 'readiness').at(-1).value, 0);
});

test('main-sleep duration and HRV never combine naps; unmarked periods do not claim main-sleep HRV', () => {
  const model = journalData([], [
    { id: 'nap', day: end, type: 'sleep', total_sleep_duration: 3600, average_hrv: 99 },
    { id: 'main', day: end, type: 'long_sleep', total_sleep_duration: 25200, average_hrv: 42 },
    { id: 'old', day: '2026-10-13', total_sleep_duration: 28000, average_hrv: 51 },
  ], end);
  assert.equal(model.sleep.at(-1).value, 7);
  assert.equal(model.hrv.at(-1).value, 42);
  assert.equal(model.hrv.at(-2).value, null);
  assert.equal(model.sleep.at(-2).value, 28000 / 3600);
});

test('HRV range uses earlier dates, minimum 14 valid days, excludes selected date and outliers by quartiles', () => {
  const points = Array.from({ length: 14 }, (_, i) => ({ date: `2026-09-${String(i + 20).padStart(2, '0')}`, value: 40 + i }));
  // Use actual ISO dates spanning September and October.
  points.forEach((p, i) => { p.date = new Date(Date.parse('2026-09-30') + i * 86400000).toISOString().slice(0, 10); });
  assert.equal(historicalHrvRange(points.slice(1), end), null);
  const result = historicalHrvRange([...points, { date: end, value: 999 }, { date: '2026-01-01', value: 1 }], end);
  assert.deepEqual(result, { low: 43.25, high: 49.75, count: 14 });
  assert.equal(historicalHrvRange(points.map(p => ({ ...p, value: 0 })), end), null);
});

test('stale samples retain actual dates instead of being relabeled today', () => {
  const model = journalData([{ date: '2026-10-10', sleep: { score: 80 }, activity: { steps: 123 } }],
    [{ id: 'old', day: '2026-10-09', type: 'long_sleep', total_sleep_duration: 24000, average_hrv: 45 }], end);
  assert.equal(model.latest.date, '2026-10-10');
  assert.equal(latestPoint(model.hrv).date, '2026-10-09');
  assert.equal(latestPoint(model.steps).date, '2026-10-10');
  assert.equal(model.hrv.at(-1).value, null);
});

test('summary comparison uses available prior calendar week and does not infer from missing records', () => {
  const days = Array.from({ length: 8 }, (_, i) => ({ date: `2026-10-${String(i + 7).padStart(2, '0')}`, sleep: { score: i === 7 ? 85 : 75 }, readiness: { score: 80 } }));
  assert.deepEqual(journalData(days, [], end).comparison, { key: 'sleep', delta: { value: 10, count: 7 } });
  assert.equal(journalData(days.slice(-3), [], end).comparison, null);
});
