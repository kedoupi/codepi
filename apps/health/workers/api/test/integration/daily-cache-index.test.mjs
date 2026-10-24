import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createRuntime, migrate } from './runtime.mjs';

test('daily cache user/day lookups use the dedicated composite index', async t => {
  const runtime = createRuntime();
  t.after(() => runtime.dispose());
  await migrate(runtime);
  const db = await runtime.getD1Database('DB');

  const indexes = await db.prepare(
    "SELECT name FROM sqlite_master WHERE type='index' AND name='idx_daily_cache_user_day'",
  ).all();
  assert.deepEqual(indexes.results, [{ name: 'idx_daily_cache_user_day' }]);

  const plan = await db.prepare(
    'EXPLAIN QUERY PLAN SELECT payload FROM daily_cache WHERE user_id=? AND day>=? AND day<=? ORDER BY day',
  ).bind('test-user', '2026-01-01', '2026-01-31').all();
  assert.ok(plan.results.some(row => /idx_daily_cache_user_day/.test(String(row.detail))),
    `expected daily cache query to use idx_daily_cache_user_day, got ${JSON.stringify(plan.results)}`);
});
