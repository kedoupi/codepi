import test from "node:test";
import assert from "node:assert/strict";
import { renderProjectCard, renderProjectList } from "../dist/render.js";

const baseA = "a".repeat(40);
const baseB = "b".repeat(40);

test("default project output preserves every task_progress entry", () => {
  const output = renderProjectCard({
    as_of: "2026-10-20T00:00:00Z",
    project: {
      id: "kedoupi-codepi",
      repo: "kedoupi/codepi",
      name: "codepi",
      status: "active",
    },
    task_progress: [
      {
        task_id: "task-done",
        status: "done",
        latest: {
          summary: "Finished the first task.",
          next: "Wait for review.",
          branch: "codex/task-done",
          base_sha: baseA,
        },
      },
      {
        task_id: "task-blocked",
        status: "blocked",
        latest: {
          summary: "Second task is still active.",
          next: "Resolve the blocker.",
          blockers: "Synthetic blocker.",
          branch: "codex/task-blocked",
          base_sha: baseB,
        },
      },
    ],
    progress: {
      summary: "Second task is still active.",
      next: "Resolve the blocker.",
    },
  });

  assert.match(output, /task-done \[done\]/);
  assert.match(output, /task-blocked \[blocked\]/);
  assert.match(output, /Finished the first task\./);
  assert.match(output, new RegExp(baseA));
  assert.match(output, /Second task is still active\./);
  assert.match(output, /Resolve the blocker\./);
  assert.match(output, /Synthetic blocker\./);
  assert.match(output, new RegExp(baseB));
  assert.ok(output.indexOf("task-done") < output.indexOf("task-blocked"));
});

test("legacy project cards still render the latest progress", () => {
  const output = renderProjectCard({
    as_of: "2026-10-20T00:00:00Z",
    project: {
      id: "kedoupi-codepi",
      repo: "kedoupi/codepi",
      name: "codepi",
      status: "active",
    },
    progress: {
      summary: "Legacy summary.",
      next: "Legacy next.",
      base_sha: baseA,
    },
  });

  assert.match(output, /Latest handoff:/);
  assert.match(output, /Legacy summary\./);
  assert.match(output, new RegExp(baseA));
});

test("project list renders the bounded latest handoff summary", () => {
  const output = renderProjectList({
    as_of: "2026-10-20T00:00:00Z",
    projects: [{
      id: "kedoupi-codepi",
      repo: "kedoupi/codepi",
      name: "codepi",
      status: "active",
      latest_handoff: {
        task_id: "task-bounded",
        status: "blocked",
        next: "Resolve the blocker.",
      },
    }],
  });

  assert.match(output, /codepi \(kedoupi\/codepi\) \[active\]/);
  assert.match(output, /latest: task-bounded \[blocked\]/);
  assert.match(output, /next: Resolve the blocker\./);
});
