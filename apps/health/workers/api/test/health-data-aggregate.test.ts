import assert from "node:assert/strict";
import { test } from "node:test";
import { aggregatePeriod } from "../src/lib/health-data.ts";
import type { Env } from "../src/env.ts";

test("aggregatePeriod batches all metric queries and preserves metric results", async () => {
  const prepared: { sql: string; bindings: unknown[] }[] = [];
  let allCalls = 0;
  let batchCalls = 0;
  const rows = [
    [{ bucket: "period", count: 2, sample_count: 3, mean: 80, min: 70, max: 90, sum: 160 }],
    [{ bucket: "period", count: 2, sample_count: 2, mean: 42, min: 40, max: 44, sum: 84 }],
  ];
  const DB = {
    prepare(sql: string) {
      const statement = {
        bind(...bindings: unknown[]) {
          prepared.push({ sql, bindings });
          return statement;
        },
        async all() {
          allCalls++;
          throw new Error("aggregatePeriod must use batch, not all");
        },
      };
      return statement;
    },
    async batch(statements: unknown[]) {
      batchCalls++;
      assert.equal(statements.length, 2);
      return rows.map(results => ({ results }));
    },
  };
  const result = await aggregatePeriod({ DB } as unknown as Env, "user-1", "sleep",
    { from: "2026-01-01", to: "2026-01-07" }, ["total_sleep_duration", "average_hrv"],
    ["count", "mean", "min", "max"], "period");

  assert.equal(batchCalls, 1);
  assert.equal(allCalls, 0);
  assert.equal(prepared.length, 2);
  assert.deepEqual(result.metrics, [
    {
      metric: "total_sleep_duration", unit: "seconds", daily_rule: "sum",
      buckets: [{ bucket: "period", valid_days: 2, valid_records: 3, count: 2, mean: 80, min: 70, max: 90 }],
    },
    {
      metric: "average_hrv", unit: "ms", daily_rule: "weighted_sleep_mean",
      buckets: [{ bucket: "period", valid_days: 2, valid_records: 2, count: 2, mean: 42, min: 40, max: 44 }],
    },
  ]);
  const empty = await aggregatePeriod({ DB } as unknown as Env, "user-1", "sleep",
    { from: "2026-01-01", to: "2026-01-07" }, [], ["count"], "period");
  assert.deepEqual(empty.metrics, []);
  assert.equal(batchCalls, 1, "empty metrics must not call batch");
});
