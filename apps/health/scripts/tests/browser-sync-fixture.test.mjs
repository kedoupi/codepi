import assert from 'node:assert/strict';
import { test } from 'node:test';
import { shortAutomaticQueue } from '../browser-sync-fixture.mjs';

const task = (collection, extra = {}) => ({
  collection, from: '2026-10-09', to: '2026-10-15', state: 'pending', attempts: 0, after: 0, ...extra,
});

test('short browser queue preserves real score result, task order and existing retry backoff', () => {
  const scores = task('__scores', { state: 'done' });
  const retry = task('sleep', { attempts: 2, after: 123456, error: 'rate_limited' });
  const heart = task('heartrate');
  const tasks = [scores, retry, task('sleep'), task('daily_spo2'), heart, task('heartrate')];
  const before = structuredClone(tasks);
  const result = shortAutomaticQueue(tasks);
  assert.deepEqual(result, [scores, retry, heart]);
  assert.equal(result[1], retry, 'trimming must not reconstruct or reset a retrying task');
  assert.deepEqual(tasks, before, 'the real queue remains untouched until the fixture persists the selection');
});

test('short browser queue cannot manufacture POST admission or hide a missing requested collection', () => {
  assert.throws(() => shortAutomaticQueue([task('sleep'), task('heartrate')]), /real automatic POST/);
  assert.throws(() => shortAutomaticQueue([task('__scores'), task('__scores')]), /real automatic POST/);
  assert.throws(() => shortAutomaticQueue([task('__scores'), task('sleep')]), /heartrate/);
  assert.throws(() => shortAutomaticQueue([task('__scores'), task('sleep', { state: 'done' })], ['sleep']), /pending/);
  assert.throws(() => shortAutomaticQueue([task('__scores'), task('sleep')], ['sleep', 'sleep']), /distinct/);
});
