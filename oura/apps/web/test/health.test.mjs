import { test } from 'node:test';
import assert from 'node:assert/strict';
import { calendarDays, dateWindow, duration, latestDay, scoreDelta, sleepForDay, readSleep } from '../src/lib/health.ts';

test('duration distinguishes missing from zero and rounds seconds once', () => {
  assert.equal(duration(null, 'zh'), '—');
  assert.equal(duration(NaN, 'en'), '—');
  assert.equal(duration(-1, 'en'), '—');
  assert.equal(duration(0, 'en'), '0h 0m');
  assert.equal(duration(28799, 'en'), '8h 0m');
});
test('calendar gaps stay missing and latest day ignores empty trailing dates', () => {
  const days = calendarDays([{ date: '2026-10-12', sleep: { score: 0 } }], 3, '2026-10-14');
  assert.equal(days.length, 3);
  assert.equal(days[1].sleep, undefined);
  assert.equal(latestDay(days)?.date, '2026-10-12');
  assert.equal(dateWindow(7, '2026-10-14').from, '2026-10-08');
});
test('baseline uses preceding calendar week, excluding today and sparse values', () => {
  const latest = { date: '2026-10-14', sleep: { score: 80 } };
  const records = [latest, { date: '2026-10-01', sleep: { score: 0 } },
    ...['07', '08', '13'].map(day => ({ date: `2026-10-${day}`, sleep: { score: 70 } }))];
  assert.deepEqual(scoreDelta(records, latest, 'sleep'), { value: 10, count: 3 });
  assert.equal(scoreDelta(records.slice(0, 3), latest, 'sleep'), null);
});
test('sleep periods preserve naps and select explicitly marked main sleep first', () => {
  const records = [
    { id: 'nap', day: '2026-10-14', type: 'sleep', total_sleep_duration: 3600 },
    { id: 'main', day: '2026-10-14', type: 'long_sleep', total_sleep_duration: 28800 },
    { id: 'other', day: '2026-10-13', total_sleep_duration: 30000 },
  ];
  assert.deepEqual(sleepForDay(records, '2026-10-14').map(r => r.id), ['main', 'nap']);
});
test('sleep archive follows byte/row pagination and rejects repeated offsets', async () => {
  const original = globalThis.fetch;
  const offsets = [];
  try {
    globalThis.fetch = async path => {
      const offset = Number(new URL(path, 'https://local.test').searchParams.get('offset'));
      offsets.push(offset);
      return Response.json({ records: [{ id: String(offset), day: '2026-10-14' }], next_offset: offset === 0 ? 1 : null, sync: {} });
    };
    const result = await readSleep('2026-10-08', '2026-10-14');
    assert.equal(result.records.length, 2);
    assert.deepEqual(offsets, [0, 1]);
    globalThis.fetch = async () => Response.json({ records: [], next_offset: 0, sync: {} });
    await assert.rejects(readSleep('2026-10-08', '2026-10-14'), /invalid_response/);
  } finally { globalThis.fetch = original; }
});
