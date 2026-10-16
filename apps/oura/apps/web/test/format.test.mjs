import assert from 'node:assert/strict';
import { test } from 'node:test';
import { avg, sparkPaths } from '../src/lib/format.ts';

test('averages exclude missing and non-finite values while preserving valid zero', () => {
  assert.equal(avg([0, 80, null, NaN, Infinity, -Infinity, '90']), 40);
  assert.equal(avg([null, NaN, Infinity]), null);
});

test('sparkline samples keep their calendar positions when dates have no data', () => {
  const path = sparkPaths([null, 60, null, 80, undefined]);
  const coordinates = [...path.line.matchAll(/[ML]([\d.]+) ([\d.]+)/g)].map(match => Number(match[1]));
  assert.deepEqual(coordinates, [31, 89], 'missing dates must not be squeezed out of the time axis');
  assert.doesNotMatch(path.line + path.area, /NaN|Infinity/);
  assert.equal(sparkPaths([NaN, 60, null, Infinity]), null, 'one valid sample is not a trend');
  assert.doesNotMatch(sparkPaths([60, 60]).line, /NaN|Infinity/);
});
