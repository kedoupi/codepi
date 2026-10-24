import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createRuntime, migrate } from './runtime.mjs';

test('sync window coverage lookups use the collection bounds index', async t => {
  const runtime = createRuntime();
  t.after(() => runtime.dispose());
  await migrate(runtime);
  const db = await runtime.getD1Database('DB');

  const indexes = await db.prepare(
    "SELECT name FROM sqlite_master WHERE type='index' AND name='health_sync_windows_user_collection_bounds'",
  ).all();
  assert.deepEqual(indexes.results, [{ name: 'health_sync_windows_user_collection_bounds' }]);

  const plan = await db.prepare(`EXPLAIN QUERY PLAN
    SELECT window_from, window_to, synced_at, attempted_at, last_error
    FROM health_sync_windows
    WHERE user_id=? AND collection=? AND window_from<=? AND window_to>=?`)
    .bind('test-user', 'sleep', '2026-10-25', '2026-10-01').all();
  assert.ok(plan.results.some(row => /health_sync_windows_user_collection_bounds/.test(String(row.detail))),
    `expected sync window query to use health_sync_windows_user_collection_bounds, got ${JSON.stringify(plan.results)}`);
});
