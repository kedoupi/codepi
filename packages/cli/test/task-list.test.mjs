import test from "node:test";
import assert from "node:assert/strict";
import { expandTaskPages } from "../dist/task-list.js";

const revision = "c".repeat(64);
const page = (keys, next, rev = revision) => ({
  structured: { revision: rev, next_offset: next, tasks: keys.map(key => ({ project: "p", key, title: key })) },
  text: null,
});

test("task pages are followed to completion with the first revision", async () => {
  const calls = [];
  const result = await expandTaskPages(page(["a", "b"], 2), async (offset, rev) => {
    calls.push([offset, rev]);
    return offset === 2 ? page(["c"], 3) : page(["d"], null);
  });
  assert.deepEqual(calls, [[2, revision], [3, revision]]);
  assert.deepEqual(result.structured.tasks.map(task => task.key), ["a", "b", "c", "d"]);
  assert.equal(result.structured.next_offset, null);
});

test("a changed revision, duplicate task or non-advancing offset fails instead of returning a partial list", async () => {
  await assert.rejects(expandTaskPages(page(["a"], 1), async () => page(["b"], null, "d".repeat(64))),
    error => error.code === "task_list_cursor_stale");
  await assert.rejects(expandTaskPages(page(["a"], 1), async () => page(["a"], null)),
    error => error.code === "task_list_pagination_invalid");
  await assert.rejects(expandTaskPages(page(["a"], 1), async () => page(["b"], 1)),
    error => error.code === "task_list_pagination_invalid");
  await assert.rejects(expandTaskPages({ structured: { tasks: [] }, text: null }, async () => page([], null)),
    error => error.code === "task_list_pagination_invalid");
});

test("a cursor_stale tool error maps to the stale-list error", async () => {
  await assert.rejects(expandTaskPages(page(["a"], 1), async () => { throw new Error("remote error: cursor_stale"); }),
    error => error.code === "task_list_cursor_stale");
});
