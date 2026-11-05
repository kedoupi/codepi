import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import worker from "../worker/index";
import { executeProject } from "../worker/mcp";
import { markOwnerDone, pickToday, todayView, unpickToday } from "../worker/today";
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
    expect(result.counts).toEqual({ today: 2, pool: 0, done: 2 });
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

  it("records same-day agent unpick as a skip and allows it again tomorrow", async () => {
    await seedToday();
    await pickToday(env, "codepi", "agent", "agent", day);
    await unpickToday(env, "codepi", "agent", day);
    expect((await todayView(env, day)).pool.map(task => task.key)).toContain("agent");
    expect((await pickToday(env, "codepi", "agent", "agent", day)).written).toBe(0);
    expect((await pickToday(env, "codepi", "agent", "agent", new Date("2026-11-06T01:00:00+08:00"))).written).toBe(1);
  });

  it("uses the Beijing date boundary for owner completion", async () => {
    await seedToday();
    await markOwnerDone(env, "codepi", "you", new Date("2026-11-04T16:30:00Z"));
    await markOwnerDone(env, "codepi", "confirm", new Date("2026-11-04T15:59:00Z"));
    const result = await todayView(env, day);
    expect(result.done.map(task => task.key)).toEqual(["you"]);
  });

  it("moves a renamed category/title key to done and puts the new key in pool", async () => {
    await seedToday([{ key: "old", title: "旧标题", status: "doing", category: "流程", need_kind: "none" }]);
    const token = await env.DB.prepare("SELECT token_hash FROM ingest_tokens WHERE project_id='codepi'").first<{ token_hash: string }>();
    expect(token?.token_hash).toMatch(/^[0-9a-f]{64}$/);
    const projectToken = await seedProject("renamed", "renamed", "owner/renamed");
    await worker.fetch(ingestRequest("renamed", projectToken, samplePayload({
      tasks: [{ key: "old", title: "旧标题", status: "doing", category: "流程", need_kind: "none" }],
    })), env);
    await worker.fetch(ingestRequest("renamed", projectToken, samplePayload({
      tasks: [{ title: "新标题", status: "doing", category: "新分类", need_kind: "none" }],
    })), env);
    const result = await todayView(env, new Date());
    expect(result.done.some(task => task.project === "renamed" && task.key !== "old")).toBe(false);
    expect(result.pool.some(task => task.project === "renamed" && task.title === "新标题")).toBe(true);
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
});
