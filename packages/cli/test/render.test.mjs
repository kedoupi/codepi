import test from "node:test";
import assert from "node:assert/strict";
import { renderOverview, renderProjectCard, renderProjectList, renderTasks } from "../dist/render.js";

const task = (overrides) => ({ project: "codepi", key: "k1", title: "示例", status: "doing", category: "流程",
  due: null, need_kind: "none", done_at: null, ...overrides });

test("project card shows the adapter section, counts and latest handoff per task", () => {
  const output = renderProjectCard({
    project: { id: "codepi", repo: "kedoupi/codepi", name: "codepi", status: "active", rules_path: "AGENTS.md",
      adapter: { isolation: "worktree", commit: "允许", acceptance: ["pnpm check", "pnpm test"], merge: "agent-team merge" },
      last_push_at: "2026-11-04T00:00:00Z", source_sha: "abbafdf" },
    counts: { by_status: { decide: 1, doing: 2, bug: 0, verify: 0, idea: 3 }, need_you: 1 },
    branches: [{ name: "team/x", ahead: 2 }],
    handoffs: [{ task: "task-a", status: "blocked", client: "Codex", next: "Resolve the blocker." }],
  });
  assert.match(output, /codepi \(kedoupi\/codepi\) \[active\]/);
  assert.match(output, /验收：pnpm check；pnpm test/);
  assert.match(output, /合并：agent-team merge/);
  assert.match(output, /待决定 1 · 执行 2 · 缺陷 0 · 待确认 0 · 想法 3 · 需要你 1/);
  assert.match(output, /team\/x \(\+2\)/);
  assert.match(output, /task-a \[blocked\] Codex/);
  assert.match(output, /next: Resolve the blocker\./);
});

test("project card without handoffs says so", () => {
  assert.match(renderProjectCard({ project: { id: "x", name: "x" } }), /还没有交接记录。/);
});

test("overview lists need-you tasks with their kind and due date and names truncated lists", () => {
  const output = renderOverview({
    today: "2026-11-04",
    counts: { open: 3, need_you: 1, overdue: 0, due_7d: 1, branches: 1 },
    need_you: [task({ title: "续费示例", need_kind: "attend", due: "2026-11-11" })],
    due_soon: [], recently_done: [task({ title: "做完了", done_at: "2026-11-03T00:00:00Z" })],
    branches: [{ project: "codepi", name: "team/x", ahead: 3 }],
    truncated: ["recently_done"],
  });
  assert.match(output, /需要你 1 · 逾期 0/);
  assert.match(output, /2026-11-11 \[到场\] 续费示例/);
  assert.match(output, /✓ 做完了/);
  assert.match(output, /codepi: team\/x \(\+3\)/);
  assert.match(output, /部分列表已截短：recently_done/);
});

test("project list and task list render one line per item", () => {
  assert.match(renderProjectList({ projects: [{ id: "codepi", name: "codepi", repo: "kedoupi/codepi", status: "active",
    open: 4, need_you: 2, branches: 1 }] }), /4 条未完成 · 2 条需要你 · 1 个分支/);
  const tasks = renderTasks({ tasks: [task({ title: "一" }), task({ key: "k2", title: "二", status: "bug" })] });
  assert.equal(tasks.split("\n").length, 2);
  assert.match(tasks, /二 {2}\(codepi\/k2, 缺陷\)/);
});
