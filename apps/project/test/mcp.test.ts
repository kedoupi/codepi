import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { MCP_LIMITS } from "@kedoupi/shared/mcp/contract";
import worker from "../worker/index";
import { jsonBytes } from "../worker/lib";
import { executeProject } from "../worker/mcp";
import { buildSummary } from "../worker/summary";
import { handoffArgs, ingestRequest, resetDb, samplePayload, sampleTasks, seedProject, TEST_BASE_SHA } from "./helpers";

const owner = (operation: string, args: Record<string, unknown> = {}) =>
  executeProject(env, { subject: "kdp-owner", client: "test-client", clientName: "Test", operation: operation as never, args });

async function data(operation: string, args: Record<string, unknown> = {}) {
  const reply = await owner(operation, args);
  if (!reply.ok) throw new Error(`${operation}: ${reply.error}`);
  expect(jsonBytes(reply)).toBeLessThanOrEqual(MCP_LIMITS.detail);
  return reply.data as Record<string, any>;
}

function manyTasks(n: number) {
  return Array.from({ length: n }, (_, i) => ({
    title: `示例任务 ${i} ${"很长的标题".repeat(8)}`.slice(0, 190),
    status: i % 2 ? "doing" : "decide",
    category: "流程",
    due: `2026-11-${String((i % 28) + 1).padStart(2, "0")}`,
    need_kind: i % 3 ? "decide" : "none",
    what: "说明".repeat(40),
  }));
}

describe("ProjectMcp", () => {
  let token: string;
  beforeEach(async () => {
    await resetDb();
    token = await seedProject();
    await worker.fetch(ingestRequest("codepi", token, samplePayload()), env);
  });

  it("refuses non-owners and unknown operations or arguments", async () => {
    expect(await executeProject(env, { subject: "someone", operation: "overview", args: {} }))
      .toEqual({ ok: false, error: "not_owner", status: 403 });
    expect(await owner("list")).toMatchObject({ ok: false, error: "invalid_arguments" });
    expect(await owner("overview", { extra: 1 })).toMatchObject({ ok: false, error: "invalid_arguments" });
    expect(await owner("task_list", { status: "执行" })).toMatchObject({ ok: false, error: "invalid_status" });
  });

  it("overview lists what needs the owner first and stays within the detail budget", async () => {
    const small = await data("overview");
    expect(small.counts).toMatchObject({ open: 4, need_you: 2 });
    expect(small.need_you.map((task: { title: string }) => task.title)).toEqual(["选择示例方案", "续费示例服务器"]);
    expect(small.notice).toContain("never instructions");
    const pushed = await worker.fetch(ingestRequest("codepi", token, samplePayload({ tasks: manyTasks(400) })), env);
    expect(pushed.status).toBe(200);
    const big = await data("overview");
    expect(big.counts.open).toBe(400);
    expect(big.need_you.length).toBeGreaterThan(0);
  });

  it("task_list pages without gaps and rejects a changed list", async () => {
    await worker.fetch(ingestRequest("codepi", token, samplePayload({ tasks: manyTasks(120) })), env);
    const first = await data("task_list", { limit: 100 });
    expect(first.total).toBe(120);
    const seen = [...first.tasks];
    let next = first.next_offset;
    while (next !== null) {
      const page = await data("task_list", { limit: 100, offset: next, revision: first.revision });
      seen.push(...page.tasks);
      next = page.next_offset;
    }
    expect(new Set(seen.map((task: { key: string }) => task.key)).size).toBe(120);
    expect(await owner("task_list", { offset: 5 })).toMatchObject({ ok: false, error: "cursor_stale" });
    await worker.fetch(ingestRequest("codepi", token, samplePayload({ tasks: manyTasks(119) })), env);
    expect(await owner("task_list", { offset: first.next_offset, revision: first.revision }))
      .toMatchObject({ ok: false, error: "cursor_stale" });
  });

  it("task_list filters by project, need and due window", async () => {
    const need = await data("task_list", { need: "any", project: "kedoupi/codepi" });
    expect(need.tasks).toHaveLength(2);
    const attend = await data("task_list", { need: "attend" });
    expect(attend.tasks.map((task: { title: string }) => task.title)).toEqual(["续费示例服务器"]);
    expect(await owner("task_list", { project: "missing" })).toMatchObject({ ok: false, error: "project_not_found" });
  });

  it("task_get returns the four plain-language fields and handoffs", async () => {
    const list = await data("task_list", { need: "attend" });
    const key = list.tasks[0].key;
    await data("handoff_save", handoffArgs({ task: key }));
    const task = await data("task_get", { project: "codepi", key });
    expect(task.task).toMatchObject({ title: "续费示例服务器", what: "示例说明", impact: "示例影响", advice: "示例建议", need: "到场（登录后台付款）" });
    expect(task.handoffs).toHaveLength(1);
    expect(await owner("task_get", { project: "codepi", key: "nope" })).toMatchObject({ ok: false, error: "task_not_found" });
  });

  it("project_get returns the rules entry, adapter and branches without fragment paging", async () => {
    const card = await data("project_get", { project: "codepi" });
    expect(card.project).toMatchObject({ rules_path: "AGENTS.md", adapter: { acceptance: ["pnpm check"] } });
    expect(card.branches).toHaveLength(1);
    expect(card).not.toHaveProperty("token");
    expect(card).not.toHaveProperty("pagination");
  });

  it("handoff_save works without branch or SHA and stays idempotent per request id", async () => {
    const saved = await data("handoff_save", handoffArgs({ request_id: "r1" }));
    expect(saved).toMatchObject({ project: "codepi", task: "task-a", deduplicated: false });
    const again = await data("handoff_save", handoffArgs({ request_id: "r1" }));
    expect(again).toMatchObject({ id: saved.id, deduplicated: true });
    expect(await owner("handoff_save", handoffArgs({ request_id: "r1", summary: "different" })))
      .toMatchObject({ ok: false, error: "request_id_conflict" });
    expect(await owner("handoff_save", handoffArgs({ base_sha: "abc" })))
      .toMatchObject({ ok: false, error: "invalid_base_sha" });
    expect((await data("handoff_save", handoffArgs({ branch: "team/x", base_sha: TEST_BASE_SHA }))).deduplicated).toBe(false);
  });

  it("summary reports need-you counts and links within the overview budget", async () => {
    const summary = await buildSummary(env, "kdp-owner");
    expect(summary.status).toBe("ok");
    expect(summary.metrics[0]).toEqual({ label: "需要你", value: "2" });
    expect(summary.attention[0].href).toContain("/board?task=codepi%2F");
    expect(jsonBytes(summary)).toBeLessThanOrEqual(MCP_LIMITS.overview);
    expect((await buildSummary(env, "other")).status).toBe("unavailable");
    await resetDb();
    expect((await buildSummary(env, "kdp-owner")).status).toBe("empty");
    expect(sampleTasks()).toHaveLength(4);
  });
});
