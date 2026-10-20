import assert from "node:assert/strict";
import { test } from "node:test";
import { buildHealthSummary } from "../src/routes/desk-summary.ts";
import type { Env } from "../src/env.ts";

function today(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit",
  }).format(new Date());
}

function syntheticEnv() {
  const queries: string[] = [];
  const rows = [{
    day: today(),
    payload: JSON.stringify({ sleep: { score: 81 }, readiness: { score: 72 }, activity: { steps: 6543 } }),
  }];
  const env = {
    PERSONAL_OWNER_ID: "test-owner",
    DB: {
      prepare(sql: string) {
        queries.push(sql);
        return {
          bind() {
            return {
              all: async () => ({ results: rows }),
              first: async () => ({ synced_at: new Date().toISOString(), last_error: null }),
            };
          },
        };
      },
    },
  } as unknown as Env;
  return { env, queries };
}

test("buildHealthSummary reads saved daily rows for current and week ranges", async () => {
  const { env, queries } = syntheticEnv();
  const current = await buildHealthSummary(env);
  const week = await buildHealthSummary(env, "week");
  assert.equal(current.source, "health");
  assert.equal(current.status, "ok");
  assert.equal(current.asOf, today());
  assert.equal(week.metrics[0]?.label, "日均睡眠评分");
  assert.equal(week.facts.length >= current.facts.length, true);
  assert.equal(queries.some(sql => /INSERT|UPDATE|DELETE/i.test(sql)), false);
  assert.equal(queries.every(sql => /daily_cache|sync_state/.test(sql)), true);
});

test("buildHealthSummary never refreshes the provider", async () => {
  const { env } = syntheticEnv();
  const originalFetch = globalThis.fetch;
  let providerCalls = 0;
  globalThis.fetch = async () => {
    providerCalls++;
    throw new Error("provider must not be called");
  };
  try {
    await buildHealthSummary(env);
  } finally {
    globalThis.fetch = originalFetch;
  }
  assert.equal(providerCalls, 0);
});
