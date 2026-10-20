import { test } from 'node:test';
import assert from 'node:assert/strict';
import { seriesPoints, stagePoints } from '../src/lib/health.ts';
import {
  alignSeries, alignStages, buildTimeline, durationVsMedian, hrvHistoryRange,
  nightInterval, parseTimestamp, routineNights, stageDurations,
} from '../src/lib/sleep-model.ts';
import { compareSeries, daysOf, mainSleepSeries, nightlySeries, stressSeries } from '../src/lib/insights-model.ts';

const night = {
  id: 'main', day: '2026-10-20', type: 'long_sleep',
  bedtime_start: '2026-10-19T23:24:00+08:00', bedtime_end: '2026-10-20T07:18:00+08:00',
  total_sleep_duration: 26640, time_in_bed: 28440, latency: 720, awake_time: 1800, efficiency: 94,
  deep_sleep_duration: 5280, rem_sleep_duration: 6120, light_sleep_duration: 15240,
  average_hrv: 42, average_heart_rate: 56, lowest_heart_rate: 49, average_breath: 14.1,
  sleep_phase_5_min: '22222211111122222233332222221111222211',
  heart_rate: { interval: 300, items: Array.from({ length: 96 }, (_, index) => index === 30 ? null : 55 + Math.round(Math.sin(index / 5) * 5)) },
  hrv: { interval: 300, items: Array.from({ length: 96 }, (_, index) => index === 60 ? null : 42 + Math.round(Math.cos(index / 7) * 6)) },
};

test('timestamps keep the recorded local wall time and offset', () => {
  const parts = parseTimestamp('2026-10-19T23:24:00+08:00');
  assert.equal(parts.time, '23:24');
  assert.equal(parts.offsetMinutes, 480);
  assert.equal(parseTimestamp('not-a-time'), null);
});

test('bedtime bounds cross midnight into one night window', () => {
  const span = nightInterval(night);
  assert.equal(span.startLabel, '23:24');
  assert.equal(span.endLabel, '07:18');
  assert.equal(span.end - span.start, 474);
  assert.equal(nightInterval({ ...night, bedtime_end: 'bad' }), null);
});

test('stage string parses into typed 5-minute segments without inventing values', () => {
  const points = stagePoints(night);
  assert.equal(points.length, night.sleep_phase_5_min.length);
  assert.equal(points[0].stage, 'light');
  assert.equal(points[6].stage, 'deep');
  assert.equal(points[18].stage, 'rem');
  assert.equal(points.at(-1).offset, (night.sleep_phase_5_min.length - 1) * 300);
  assert.equal(stagePoints({ ...night, sleep_phase_5_min: '229' }).length, 0);
  assert.equal(stagePoints({ ...night, sleep_phase_5_min: null }).length, 0);
});

test('series keep missing samples missing and stamp them from the recorded midnight', () => {
  const points = seriesPoints(night, night.heart_rate);
  assert.equal(points.length, 95); // one null sample stays missing
  assert.equal(points[0].offset, 0);
  assert.equal(points[2].offset, 600);
  // Series anchor at the recorded bedtime and step by the interval.
  assert.equal(points[0].at, '2026-10-19T15:24:00.000Z');
});

test('timeline aligns stages, heart rate and HRV to the bedtime window', () => {
  const timeline = buildTimeline(night);
  assert.ok(timeline.stages.length > 0);
  assert.equal(timeline.stages[0].t0 >= timeline.night.start - 5, true);
  // Samples span midnight → 08:00; the 23:24–07:18 window keeps the in-range points.
  assert.equal(timeline.heartRate.length > 80, true);
  assert.equal(timeline.hrv.length > 80, true);
  assert.equal(timeline.hrIntervalMinutes, 5);
});

test('stage durations prefer duration columns and total stays separate from zero', () => {
  const rows = stageDurations(night, buildTimeline(night).stages);
  assert.equal(rows.find(row => row.key === 'deep').seconds, 5280);
  const fallback = stageDurations({ ...night, deep_sleep_duration: null }, buildTimeline(night).stages);
  assert.equal(fallback.find(row => row.key === 'deep').seconds > 0, true);
});

test('median comparison needs earlier saved nights and ignores invalid durations', () => {
  const earlier = Array.from({ length: 5 }, (_, index) => ({
    id: `old-${index}`, day: `2026-10-1${index}`, type: 'long_sleep', total_sleep_duration: 25200,
  }));
  const result = durationVsMedian([...earlier, night], night);
  assert.equal(result.delta, Math.round((26640 - 25200) / 60));
  assert.equal(durationVsMedian(earlier.slice(0, 3).concat(night), night), null);
  const naps = earlier.map(row => ({ ...row, id: `nap-${row.id}`, type: 'sleep', total_sleep_duration: 1800 }));
  assert.deepEqual(durationVsMedian([...earlier, ...naps, night], night), result);
  assert.equal(durationVsMedian([...earlier, ...naps], { ...night, type: 'sleep' }), null);
});

test('stage alignment preserves full-night duration and fallback stage totals', () => {
  const record = { ...night, sleep_phase_5_min: '2'.repeat(72) + '1'.repeat(12) + '3'.repeat(10) };
  const timeline = buildTimeline(record);
  assert.equal(timeline.stages.at(-1).t1 - timeline.stages[0].t0, 470);
  const totals = stageDurations({ ...record, deep_sleep_duration: null }, timeline.stages);
  assert.equal(totals.find(row => row.key === 'deep').seconds, 3600);
});

test('HRV history band only uses explicit earlier main sleep', () => {
  const earlier = Array.from({ length: 14 }, (_, index) => ({
    id: `h-${index}`, day: `2026-09-${String(index + 1).padStart(2, '0')}`, type: 'long_sleep', average_hrv: 30 + index,
  }));
  const band = hrvHistoryRange([...earlier, { id: 'nap', day: '2026-10-19', type: 'sleep', average_hrv: 99 }, night], night);
  assert.equal(band.count, 14);
  assert.equal(hrvHistoryRange(earlier.slice(0, 10).concat(night), night), null);
});

test('routine nights keep main sleep first and preserve wall-clock labels', () => {
  const nap = { ...night, id: 'nap', type: 'sleep', bedtime_start: '2026-10-19T14:00:00+08:00', bedtime_end: '2026-10-19T14:30:00+08:00' };
  const nights = routineNights([nap, night], 7, '2026-10-20');
  assert.equal(nights.length, 1);
  assert.equal(nights[0].startLabel, '23:24');
});

test('nightly series keeps naps separate and never treats missing as zero', () => {
  const range = { from: '2026-10-14', to: '2026-10-20' };
  const records = [night, { ...night, id: 'nap', type: 'sleep', total_sleep_duration: 1800, day: '2026-10-20' },
    { ...night, id: 'nap-only', type: 'sleep', total_sleep_duration: 1800, day: '2026-10-19' }];
  const series = nightlySeries(records, range, record => record.total_sleep_duration);
  assert.equal(series.length, 7);
  assert.equal(series.at(-1).value, 26640);
  assert.equal(series.at(-2).value, null);
  assert.equal(series[0].value, null);
});

test('calendar series covers selected custom and 30-day windows without inventing dates', () => {
  const month = daysOf({ from: '2026-09-21', to: '2026-10-20' });
  assert.equal(month.length, 30);
  assert.equal(month.at(-1), '2026-10-20');
  assert.deepEqual(daysOf({ from: '2026-10-19', to: '2026-10-20' }), ['2026-10-19', '2026-10-20']);
  assert.deepEqual(daysOf({ from: '', to: '2026-10-20' }), []);
  assert.deepEqual(daysOf({ from: '2026-10-20', to: '2026-10-19' }), []);
});

test('strict main-sleep series rejects unmarked records for HRV', () => {
  const range = { from: '2026-10-14', to: '2026-10-20' };
  const unmarked = { ...night, id: 'old', type: undefined, day: '2026-10-19' };
  const series = mainSleepSeries([unmarked, night], range, record => record.average_hrv);
  assert.equal(series.at(-1).value, 42);
  assert.equal(series.at(-2).value, null);
});

test('comparison needs three valid samples in both windows', () => {
  const current = [10, 12, 11, null, null, null, null].map((value, index) => ({ date: `2026-10-1${index + 4}`, value }));
  const previous = [9, 9, null, null, null, null, null].map((value, index) => ({ date: `2026-10-0${index + 7}`, value }));
  assert.equal(compareSeries(current, previous), null);
  const richerPrevious = [9, 9, 10, null, null, null, null].map((value, index) => ({ date: `2026-10-0${index + 7}`, value }));
  const result = compareSeries(current, richerPrevious);
  assert.equal(Math.round(result.delta * 10) / 10, 1.7);
});

test('stress series converts seconds to minutes and keeps gaps empty', () => {
  const range = { from: '2026-10-14', to: '2026-10-20' };
  const series = stressSeries([{ day: '2026-10-14', stress_high: 3600, recovery_high: 1800 }], range, 'recovery_high');
  assert.equal(series[0].value, 30);
  assert.equal(series[1].value, null);
});
