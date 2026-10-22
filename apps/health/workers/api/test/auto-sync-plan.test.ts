import assert from "node:assert/strict";
import { test } from "node:test";
import { mergeRefreshTasks, normalizeTasks, planAutomaticSync, splitTask } from "../src/lib/auto-sync.ts";
import { calendarDay } from "../../../shared/dates.ts";

const today = calendarDay(new Date());

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
