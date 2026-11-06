import { env } from "cloudflare:test";
import { MCP_LIMITS } from "@kedoupi/shared/mcp/contract";
import { beforeEach, describe, expect, it } from "vitest";
import worker from "../worker/index";
import { executeProject } from "../worker/mcp";
import { jsonBytes } from "../worker/lib";
import { checkAgentToday, deleteToday, markOwnerDone, pickToday, pickAgentToday, todayView, unpickToday } from "../worker/today";
import { ingestRequest, resetDb, samplePayload, seedProject } from "./helpers";

const day = new Date("2026-11-05T00:30:00+08:00");
const owner = (operation: string, args: Record<string, unknown> = {}) =>
  executeProject(env, { subject: "kdp-owner", client: "today-test", operation: operation as never, args });

async function data(operation: string, args: Record<string, unknown> = {}) {
  const reply = await owner(operation, args);
  if (!reply.ok) throw new Error(`${operation}: ${reply.error}`);
  return reply.data as Record<string, any>;
}

async function seedToday(tasks: Array<Record<string, unknown>> = [
  { key: "you", title: "需要主人", status: "decide", category: "流程", due: "2026-11-05", need_kind: "decide" },
  { key: "agent", title: "助手可做", status: "doing", category: "流程", due: "2026-11-05", need_kind: "none" },
  { key: "confirm", title: "需要确认", status: "verify", category: "流程", due: "2026-11-06", need_kind: "confirm" },
  { key: "late", title: "无截止", status: "idea", category: "流程", due: null, need_kind: "authorize" },
]) {
  const token = await seedProject();
  await worker.fetch(ingestRequest("codepi", token, samplePayload({ tasks })), env);
  return token;
}

describe("today board", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("maps who, carries picks, sorts by due then position, and merges only today's done", async () => {
    await seedToday();
    await pickToday(env, "codepi", "you", "owner", new Date("2026-11-04T23:00:00+08:00"));
    await pickToday(env, "codepi", "agent", "agent", new Date("2026-11-04T23:00:00+08:00"));
    await markOwnerDone(env, "codepi", "confirm", day);
    await env.DB.prepare("UPDATE tasks SET done_at=? WHERE key='late'").bind("2026-11-04T16:30:00Z").run();
    const result = await todayView(env, day);
    expect(result.date).toBe("2026-11-05");
    expect(result.today.map(task => [task.key, task.carried, task.who])).toEqual([
      ["you", true, "you"], ["agent", true, "agent"],
    ]);
    expect(result.pool.map(task => task.key)).toEqual([]);
    expect(result.done.map(task => task.key)).toEqual(["confirm", "late"]);
    expect(result.counts).toEqual({ today: 2, pool: 0, done: 2, deleted: 0, checked: 0 });
  });

  it("keeps owner_done hidden on later days and rejects agent-owned completion", async () => {
    await seedToday();
    await expect(markOwnerDone(env, "codepi", "agent", day)).rejects.toMatchObject({ code: "owner_only", status: 422 });
    await markOwnerDone(env, "codepi", "you", day);
    const nextDay = await todayView(env, new Date("2026-11-06T00:00:00+08:00"));
    expect(nextDay.today).toEqual([]);
    expect(nextDay.pool.map(task => task.key)).toEqual(["agent", "confirm", "late"]);
    expect(nextDay.done).toEqual([]);
  });

  it("records same-day agent unpick as a skip, then lets owner override", async () => {
    await seedToday();
    await pickToday(env, "codepi", "agent", "agent", day);
    await unpickToday(env, "codepi", "agent", day);
    expect((await todayView(env, day)).pool.map(task => task.key)).toContain("agent");
    expect((await pickToday(env, "codepi", "agent", "agent", day)).written).toBe(0);
    const nextDay = await todayView(env, new Date("2026-11-06T01:00:00+08:00"));
    expect(nextDay.today.map(task => task.key)).not.toContain("agent");
    expect(nextDay.pool.map(task => task.key)).toContain("agent");
    expect((await pickToday(env, "codepi", "agent", "owner", day)).written).toBe(1);
    expect((await todayView(env, day)).today.map(task => task.key)).toContain("agent");
  });

  it("does not let the assistant re-pick after the owner returns and checks it", async () => {
    await seedToday([{ key: "returned", title: "主人退回", status: "doing", category: "流程", need_kind: "none" }]);
    await pickToday(env, "codepi", "returned", "agent", day);
    await unpickToday(env, "codepi", "returned", day);
    expect(await checkAgentToday(env, [{ project: "codepi", key: "returned", note: "已检查但未完成" }], day))
      .toEqual({ written: 1, skipped: 0 });
    expect(await pickAgentToday(env, [{ project: "codepi", key: "returned" }], day)).toEqual({ written: 0 });
  });

  it("uses the Beijing date boundary for owner completion", async () => {
    await seedToday();
    await markOwnerDone(env, "codepi", "you", new Date("2026-11-04T16:30:00Z"));
    await markOwnerDone(env, "codepi", "confirm", new Date("2026-11-04T15:59:00Z"));
    const result = await todayView(env, day);
    expect(result.done.map(task => task.key)).toEqual(["you"]);
  });

  it("clears today state when a repository removes and later recreates a task", async () => {
    const token = await seedToday([{ title: "可重建事项", status: "decide", category: "流程", need_kind: "decide" }]);
    const task = await env.DB.prepare("SELECT key FROM tasks WHERE project_id='codepi'").first<{ key: string }>();
    await pickToday(env, "codepi", task!.key, "owner", day);
    await markOwnerDone(env, "codepi", task!.key, day);
    await worker.fetch(ingestRequest("codepi", token, samplePayload({ tasks: [] })), env);
    await worker.fetch(ingestRequest("codepi", token, samplePayload({
      tasks: [{ title: "可重建事项", status: "decide", category: "流程", need_kind: "decide" }],
    })), env);
    const result = await todayView(env, day);
    const recreated = result.pool.find(item => item.title === "可重建事项");
    expect(recreated).toBeDefined();
    expect(recreated).not.toHaveProperty("carried");
    expect(result.today.map(item => item.title)).not.toContain("可重建事项");
  });

  it("moves a picked old key to today's done and puts the renamed key in pool", async () => {
    const token = await seedToday([{ key: "old", title: "旧标题", status: "doing", category: "流程", need_kind: "none" }]);
    await pickToday(env, "codepi", "old", "owner", day);
    await worker.fetch(ingestRequest("codepi", token, samplePayload({
      tasks: [{ title: "新标题", status: "doing", category: "新分类", need_kind: "none" }],
    })), env);
    await env.DB.prepare("UPDATE tasks SET done_at=? WHERE project_id='codepi' AND key='old'")
      .bind("2026-11-04T16:30:00Z").run();
    const result = await todayView(env, day);
    expect(result.done).toContainEqual(expect.objectContaining({ project: "codepi", key: "old" }));
    expect(result.today.map(task => task.key)).not.toContain("old");
    expect(result.pool).toContainEqual(expect.objectContaining({ project: "codepi", title: "新标题" }));
    expect((await env.DB.prepare("SELECT COUNT(*) AS n FROM today_picks WHERE project_id='codepi'").first<{ n: number }>())?.n).toBe(0);
  });

  it("clips today_get within budget while retaining full counts", async () => {
    await seedToday(Array.from({ length: 300 }, (_, index) => ({
      key: `pool-${index}`, title: `合成池任务 ${index} ${"长标题".repeat(8)}`,
      status: "doing", category: "流程", need_kind: "none",
    })));
    const board = await data("today_get");
    expect(jsonBytes(board)).toBeLessThanOrEqual(MCP_LIMITS.detail);
    expect(board.truncated).toContain("pool");
    expect(board.counts).toEqual({ today: 0, pool: 300, done: 0, deleted: 0, checked: 0 });
    expect(board.pool.length).toBeLessThan(300);
  });

  it("keeps MCP today picks from replacing an owner pick and keeps counts after clipping", async () => {
    await seedToday();
    await pickToday(env, "codepi", "you", "owner", day);
    const picked = await data("today_pick", { items: [
      { project: "codepi", key: "you" }, { project: "codepi", key: "agent" },
    ] });
    expect(picked.written).toBe(1);
    const board = await data("today_get");
    expect(board.today.some((task: { key: string; who: string }) => task.key === "you" && task.who === "you")).toBe(true);
    expect(board.counts.today).toBe(2);
  });
  it("validates every MCP today pick before writing any row", async () => {
    await seedToday();
    const reply = await owner("today_pick", { items: [
      { project: "codepi", key: "agent" }, { project: "codepi", key: "missing" },
    ] });
    expect(reply).toMatchObject({ ok: false, error: "task_not_found", status: 404 });
    expect((await env.DB.prepare("SELECT COUNT(*) AS n FROM today_picks").first<{ n: number }>())?.n).toBe(0);
  });

  it("deletes only pool tasks, reports deleted rows, and is idempotent", async () => {
    await seedToday();
    await expect(deleteToday(env, "codepi", "missing", day)).rejects.toMatchObject({ code: "task_not_found", status: 404 });
    await pickToday(env, "codepi", "agent", "owner", day);
    await expect(deleteToday(env, "codepi", "agent", day)).rejects.toMatchObject({ code: "task_in_today", status: 422 });
    await markOwnerDone(env, "codepi", "you", day);
    await expect(deleteToday(env, "codepi", "you", day)).rejects.toMatchObject({ code: "task_done", status: 422 });
    await env.DB.prepare("UPDATE tasks SET done_at=? WHERE project_id='codepi' AND key='late'")
      .bind("2026-11-04T16:30:00Z").run();
    await expect(deleteToday(env, "codepi", "late", day)).rejects.toMatchObject({ code: "task_done", status: 422 });
    expect(await deleteToday(env, "codepi", "confirm", day)).toEqual({ written: 1 });
    expect(await deleteToday(env, "codepi", "confirm", day)).toEqual({ written: 0 });
    const result = await todayView(env, day);
    expect(result.pool).toEqual([]);
    expect(result.today.map(task => task.key)).toEqual(["agent"]);
    expect(result.done.map(task => task.key)).toEqual(["you", "late"]);
    expect(result.deleted).toEqual([{ project: "codepi", key: "confirm", title: "需要确认", deleted_at: "2026-11-04T16:30:00Z" }]);
    expect(result.counts).toEqual({ today: 1, pool: 0, done: 2, deleted: 1, checked: 0 });
  });

  it("keeps owner_deleted after removal and clears it when the key is recreated", async () => {
    const token = await seedToday([{ key: "recreated", title: "可重建事项", status: "doing", category: "流程", need_kind: "none" }]);
    await deleteToday(env, "codepi", "recreated", day);
    expect((await todayView(env, day)).deleted.map(task => task.key)).toEqual(["recreated"]);
    await worker.fetch(ingestRequest("codepi", token, samplePayload({ tasks: [] })), env);
    expect((await env.DB.prepare("SELECT COUNT(*) AS n FROM owner_deleted WHERE project_id='codepi'").first<{ n: number }>())?.n).toBe(1);
    const removed = await todayView(env, day);
    expect(removed.today.map(task => task.key)).not.toContain("recreated");
    expect(removed.pool.map(task => task.key)).not.toContain("recreated");
    expect(removed.done.map(task => task.key)).not.toContain("recreated");
    expect(removed.deleted.map(task => task.key)).not.toContain("recreated");
    await worker.fetch(ingestRequest("codepi", token, samplePayload({
      tasks: [{ key: "recreated", title: "可重建事项", status: "doing", category: "流程", need_kind: "none" }],
    })), env);
    expect((await env.DB.prepare("SELECT COUNT(*) AS n FROM owner_deleted WHERE project_id='codepi' AND task_key='recreated'").first<{ n: number }>())?.n).toBe(0);
    const result = await todayView(env, day);
    expect(result.pool.map(task => task.key)).toEqual(["recreated"]);
    expect(result.deleted).toEqual([]);
  });

  it("clears owner_deleted when a pruned task is recreated", async () => {
    const token = await seedToday([{ key: "pruned", title: "清理后重建", status: "doing", category: "流程", need_kind: "none" }]);
    await deleteToday(env, "codepi", "pruned", day);
    await worker.fetch(ingestRequest("codepi", token, samplePayload({ tasks: [] })), env);
    const old = new Date(Date.now() - (90 + 1) * 86400_000).toISOString();
    await env.DB.prepare("UPDATE tasks SET done_at=? WHERE project_id='codepi' AND key='pruned'").bind(old).run();
    await worker.fetch(ingestRequest("codepi", token, samplePayload({ tasks: [] })), env);
    expect((await env.DB.prepare("SELECT COUNT(*) AS n FROM tasks WHERE project_id='codepi' AND key='pruned'").first<{ n: number }>())?.n).toBe(0);
    await worker.fetch(ingestRequest("codepi", token, samplePayload({
      tasks: [{ key: "pruned", title: "清理后重建", status: "doing", category: "流程", need_kind: "none" }],
    })), env);
    expect((await env.DB.prepare("SELECT COUNT(*) AS n FROM owner_deleted WHERE project_id='codepi' AND task_key='pruned'").first<{ n: number }>())?.n).toBe(0);
    expect((await todayView(env, day)).pool.map(task => task.key)).toEqual(["pruned"]);
  });

  it("does not let the assistant pick a deleted task", async () => {
    await seedToday([{ key: "deleted", title: "已删任务", status: "doing", category: "流程", need_kind: "none" }]);
    await deleteToday(env, "codepi", "deleted", day);
    expect(await pickAgentToday(env, [{ project: "codepi", key: "deleted" }], day)).toEqual({ written: 0 });
    expect((await todayView(env, day)).deleted.map(task => task.key)).toEqual(["deleted"]);
  });

  it("records checks across days, updates same-day notes, and moves picks back to the pool", async () => {
    await seedToday([{ key: "checked", title: "待检查", status: "doing", category: "流程", need_kind: "none" }]);
    await pickToday(env, "codepi", "checked", "owner", day);
    await unpickToday(env, "codepi", "checked", day);
    expect(await checkAgentToday(env, [{ project: "codepi", key: "checked", note: "第一天结论" }], day)).toEqual({ written: 1, skipped: 0 });
    expect((await todayView(env, day)).today).toEqual([]);
    expect((await todayView(env, day)).pool[0]).toMatchObject({
      key: "checked", checks: { count: 1, last_note: "第一天结论", today: true },
    });
    expect(await checkAgentToday(env, [{ project: "codepi", key: "checked", note: "第二次结论" }], day)).toEqual({ written: 1, skipped: 0 });
    expect((await todayView(env, day)).pool[0]).toMatchObject({
      key: "checked", checks: { count: 1, last_note: "第二次结论", today: true },
    });
    expect(await pickAgentToday(env, [{ project: "codepi", key: "checked" }], day)).toEqual({ written: 0 });
    expect(await pickToday(env, "codepi", "checked", "agent", day)).toEqual({ written: 0 });
    const nextDayTime = new Date("2026-11-06T12:00:00+08:00");
    expect(await pickAgentToday(env, [{ project: "codepi", key: "checked" }], nextDayTime)).toEqual({ written: 1 });
    await unpickToday(env, "codepi", "checked", nextDayTime);
    expect((await todayView(env, day)).pool[0]).toMatchObject({ key: "checked" });
    const secondDay = (await todayView(env, new Date("2026-11-06T12:00:00+08:00"))).pool.find(task => task.key === "checked");
    expect(secondDay?.checks).toMatchObject({ count: 1, today: false });
    expect((await todayView(env, new Date("2026-11-06T12:00:00+08:00"))).counts.checked).toBe(0);
    await checkAgentToday(env, [{ project: "codepi", key: "checked", note: "第二天结论" }], new Date("2026-11-06T12:00:00+08:00"));
    await checkAgentToday(env, [{ project: "codepi", key: "checked", note: "第三天结论" }], new Date("2026-11-07T12:00:00+08:00"));
    const next = (await todayView(env, new Date("2026-11-07T18:00:00+08:00"))).pool.find(task => task.key === "checked");
    expect(next?.checks).toMatchObject({ count: 3, last_note: "第三天结论", today: true });
  });

  it("skips completed or deleted tasks, while missing refs fail before any write", async () => {
    await seedToday([
      { key: "done", title: "已完成", status: "decide", category: "流程", need_kind: "decide" },
      { key: "deleted", title: "已删除", status: "doing", category: "流程", need_kind: "none" },
      { key: "open", title: "可检查", status: "doing", category: "流程", need_kind: "none" },
    ]);
    await markOwnerDone(env, "codepi", "done", day);
    await deleteToday(env, "codepi", "deleted", day);
    await expect(checkAgentToday(env, [{ project: "codepi", key: "open", note: "结论" }, { project: "codepi", key: "missing", note: "不会写入" }], day))
      .rejects.toMatchObject({ code: "task_not_found", status: 404 });
    expect((await env.DB.prepare("SELECT COUNT(*) AS n FROM agent_checked").first<{ n: number }>())?.n).toBe(0);
    expect(await checkAgentToday(env, [
      { project: "codepi", key: "done", note: "跳过" },
      { project: "codepi", key: "deleted", note: "跳过" },
      { project: "codepi", key: "open", note: "写入" },
    ], day)).toEqual({ written: 1, skipped: 2 });
  });
 

});
