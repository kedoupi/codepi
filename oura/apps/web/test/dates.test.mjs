import { test } from 'node:test';
import assert from 'node:assert/strict';
import { calendarDay, calendarWindow, shiftDay } from '../../../shared/dates.ts';
import { dateWindow as frontendWindow } from '../src/lib/health.ts';
import { dateWindow as apiWindow } from '../../../workers/api/src/lib/daily.ts';
import { planBackfill } from '../src/lib/backfill.ts';
import { watchCalendarDay } from '../src/lib/calendar.ts';

test('Beijing midnight is consistent across frontend, API and manual backfill', t => {
  t.mock.timers.enable({ apis: ['Date'], now: Date.parse('2026-10-14T16:30:00Z') });
  assert.equal(calendarDay(), '2026-10-15');
  assert.equal(frontendWindow(7).to, '2026-10-15');
  assert.equal(apiWindow(7).endDate, '2026-10-15');
  assert.equal(apiWindow(7).startDate, frontendWindow(7).from);
  assert.equal(apiWindow(7).dates.length, 7);
  assert.equal(planBackfill([{ name: 'sleep', mode: 'date' }], 7)[0].to, '2026-10-15');
  assert.equal(calendarDay(new Date('2026-10-14T15:59:59Z')), '2026-10-14');
  assert.equal(calendarDay(new Date('2026-10-14T16:00:00Z')), '2026-10-15');
});

test('calendar arithmetic preserves leap days, month/year boundaries and official day strings', () => {
  assert.deepEqual(calendarWindow(7, '2024-03-01'), { from: '2024-02-24', to: '2024-03-01' });
  assert.equal(shiftDay('2024-03-01', -1), '2024-02-29');
  assert.equal(shiftDay('2026-01-01', -1), '2025-12-31');
  assert.deepEqual(calendarWindow(1, '2026-10-01'), { from: '2026-10-01', to: '2026-10-01' });
  // DST changes in the viewer's timezone must not change a date-only window.
  assert.deepEqual(calendarWindow(7, '2026-03-10'), { from: '2026-03-04', to: '2026-03-10' });
});

test('open pages detect rollover on timer/focus/resume and remove listeners on unmount', t => {
  t.mock.timers.enable({ apis: ['Date'], now: Date.parse('2026-10-14T15:59:59Z') });
  const oldWindow = globalThis.window;
  const oldDocument = globalThis.document;
  const target = new EventTarget();
  let timer;
  let cleared = false;
  globalThis.window = Object.assign(target, {
    setInterval(fn, delay) { assert.equal(delay, 30000); timer = fn; return 7; },
    clearInterval(id) { assert.equal(id, 7); cleared = true; },
  });
  globalThis.document = new EventTarget();
  const seen = [];
  const stop = watchCalendarDay(day => seen.push(day));
  try {
    timer();
    assert.deepEqual(seen, []);
    t.mock.timers.setTime(Date.parse('2026-10-14T16:00:01Z'));
    window.dispatchEvent(new Event('focus'));
    timer();
    assert.deepEqual(seen, ['2026-10-15']);
    t.mock.timers.setTime(Date.parse('2026-10-15T16:00:01Z'));
    document.dispatchEvent(new Event('visibilitychange'));
    assert.deepEqual(seen, ['2026-10-15', '2026-10-16']);
    t.mock.timers.setTime(Date.parse('2026-10-16T16:00:01Z'));
    timer();
    assert.equal(seen.at(-1), '2026-10-17');
    stop();
    assert.equal(cleared, true);
    t.mock.timers.setTime(Date.parse('2026-10-17T16:00:01Z'));
    window.dispatchEvent(new Event('focus'));
    document.dispatchEvent(new Event('visibilitychange'));
    assert.equal(seen.length, 3);
  } finally {
    stop();
    if (oldWindow === undefined) delete globalThis.window; else globalThis.window = oldWindow;
    if (oldDocument === undefined) delete globalThis.document; else globalThis.document = oldDocument;
  }
});
