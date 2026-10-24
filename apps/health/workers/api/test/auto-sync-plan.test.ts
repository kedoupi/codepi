import assert from "node:assert/strict";
import { test } from "node:test";
import { mergeRefreshTasks, normalizeTasks, planAutomaticSync, runAutomaticSync, splitTask } from "../src/lib/auto-sync.ts";
import { calendarDay } from "../../../shared/dates.ts";

const today = calendarDay(new Date());

function leaseFixture({ releaseError, deniedError }: {
  releaseError?: Error | ((attempt: number) => Error | undefined);
  deniedError?: Error;
} = {}) {
  let releaseAttempts = 0;
  const db = {
    prepare(sql: string) {
      const statement = {
        bind() { return statement; },
        async first() {
          if (sql.includes("FROM encrypted_tokens")) return { user_id: "test-user" };
          if (sql.startsWith("INSERT INTO auto_sync_state")) {
            return { status: "idle", payload: "[]", run_day: today };
          }
          return null;
        },
        async all() {
          if (deniedError) throw deniedError;
          return { results: [] };
        },
        async run() {
          if (sql.startsWith("UPDATE auto_sync_state SET lease_until=0")) {
            releaseAttempts++;
            const failure = typeof releaseError === "function" ? releaseError(releaseAttempts) : releaseError;
            if (failure) throw failure;
          }
        },
      };
      return statement;
    },
  };
  return {
    releaseAttempts: () => releaseAttempts,
    env: {
      AUTO_SYNC_ENABLED: "1",
      PERSONAL_OWNER_ID: "test-user",
      TOKEN_ENCRYPTION_KEY: "test-key",
      OURA_CLIENT_ID: "test-client",
      OURA_CLIENT_SECRET: "test-secret",
      DB: db,
    } as unknown as Parameters<typeof runAutomaticSync>[0],
  };
}

test("automatic sync retries a transient lease-release failure", async () => {
  const fixture = leaseFixture({ releaseError: attempt => attempt === 1 ? new Error("D1_ERROR: internal error") : undefined });
  await runAutomaticSync(fixture.env, Date.parse(`${today}T00:00:00Z`), "*/2 * * * *");
  assert.equal(fixture.releaseAttempts(), 2);
});

test("automatic sync lease cleanup warns without masking the main failure", async () => {
  const fixture = leaseFixture({
    releaseError: new Error("permanent D1 failure"),
    deniedError: new Error("main sync failure"),
  });
  const warnings: unknown[][] = [];
  const originalWarn = console.warn;
  console.warn = (...args) => warnings.push(args);
  try {
    await assert.rejects(
      runAutomaticSync(fixture.env, Date.parse(`${today}T00:00:00Z`), "*/2 * * * *"),
      /main sync failure/,
    );
  } finally {
    console.warn = originalWarn;
  }
  assert.equal(fixture.releaseAttempts(), 1);
  assert.match(String(warnings[0]?.[0]), /Failed to release automatic sync lease/);
});

test("requested windows are interactive; containment dedupe keeps the scheduled task", () => {
  const previous = normalizeTasks(JSON.stringify([
    { collection: "sleep", from: today, to: today, state: "pending", attempts: 0, after: 0 },
  ]));
  const deduped = mergeRefreshTasks(previous, [{ collection: "sleep", from: today, to: today }]);
  assert.equal(deduped.length, 1, "a covering scheduled task already serves the window");
  assert.equal(deduped[0].priority, "scheduled");
  const merged = mergeRefreshTasks(previous, [{ collection: "heartrate", from: today, to: today }]);
  assert.equal(merged.length, 2);
  assert.equal(merged[0].priority, "scheduled", "existing work keeps its priority");
  assert.deepEqual(merged[1], { collection: "heartrate", from: today, to: today,
    state: "pending", attempts: 0, after: 0, priority: "interactive" });
});

test("daily and manual plans stay scheduled", () => {
  const planned = planAutomaticSync(today, []);
  assert.ok(planned.length > 0);
  assert.ok(planned.every(item => item.priority === "scheduled"));
});

test("legacy payloads without a priority normalize to scheduled and keep every field", () => {
  const legacy = { collection: "sleep", from: "2026-01-01", to: "2026-01-02",
    state: "failed", attempts: 2, after: 123, error: "rate_limited" };
  const interactive = { ...legacy, collection: "heartrate", priority: "interactive" };
  const tasks = normalizeTasks(JSON.stringify([legacy, interactive]));
  assert.deepEqual(tasks[0], { ...legacy, priority: "scheduled" });
  assert.deepEqual(tasks[1], interactive);
});

test("split children inherit the parent priority and cover both halves", () => {
  const parent = { collection: "heartrate", from: "2026-01-01", to: "2026-01-07",
    state: "pending" as const, attempts: 0, after: 0, priority: "interactive" as const };
  const children = splitTask(parent);
  assert.deepEqual(children.map(item => [item.from, item.to]),
    [["2026-01-05", "2026-01-07"], ["2026-01-01", "2026-01-04"]]);
  assert.ok(children.every(item => item.priority === "interactive"
    && item.state === "pending" && item.attempts === 0 && item.after === 0));
  const scheduled = splitTask({ ...parent, priority: "scheduled" });
  assert.ok(scheduled.every(item => item.priority === "scheduled"));
});
