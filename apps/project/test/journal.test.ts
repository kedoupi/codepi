import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { checkAgentToday } from "../worker/today";
import { journal } from "../worker/journal";
import worker from "../worker/index";
import { ingestRequest, resetDb, samplePayload, seedProject } from "./helpers";

const day = new Date("2026-11-04T12:00:00+08:00");

describe("journal", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("returns a Beijing week with release deduplication, completion, checks and deleted exclusion", async () => {
    const codepiToken = await seedProject("codepi", "CodePi");
    const rhythmToken = await seedProject("rhythm", "Rhythm");
    const tasks = [
      { key: "done", title: "已完成任务", status: "doing", category: "流程", need_kind: "none" },
      { key: "deleted", title: "已删除任务", status: "doing", category: "流程", need_kind: "none" },
      { key: "checked", title: "待检查任务", status: "doing", category: "流程", need_kind: "none" },
    ];
    await worker.fetch(ingestRequest("codepi", codepiToken, samplePayload({
      tasks,
      changelog: [
        { date: "2026-11-02", title: "Rhythm 上线" },
        { date: "2026-11-02", title: "Rhythm 工作页上线" },
        { date: "2026-11-02", title: "普通改动" },
        { date: "2026-11-02", title: "普通改动" },
        { date: "2026-11-03", title: "统筹看板「今天 + 池子」上线（project.codepi.app）" },
        { date: "2026-11-03", title: "统筹看板：今天 + 池子 + 做完（project.codepi.app）" },
      ],
    })), env);
    await worker.fetch(ingestRequest("rhythm", rhythmToken, samplePayload({
      changelog: [{ date: "2026-11-03", title: "Rhythm 上线" }],
    })), env);
    await env.DB.prepare("UPDATE tasks SET done_at=? WHERE project_id='codepi' AND key='done'")
      .bind("2026-11-03T16:30:00Z").run();
    const deleted = await env.DB.prepare("SELECT key FROM tasks WHERE project_id='codepi' AND key='deleted'").first<{ key: string }>();
    await env.DB.prepare("INSERT INTO owner_deleted (project_id, task_key, deleted_at) VALUES (?, ?, ?)")
      .bind("codepi", deleted!.key, "2026-11-03T10:00:00Z").run();
    await checkAgentToday(env, [{ project: "codepi", key: "checked", note: "已检查并给出结论" }], day);

    const result = await journal(env, "2026-11-04", undefined, day);
    expect(result.week).toEqual({ start: "2026-11-02", end: "2026-11-08" });
    expect(result.days).toHaveLength(7);
    const monday = result.days[0];
    expect(monday.released.map(item => item.title)).toEqual(["Rhythm 上线", "Rhythm 工作页上线"]);
    expect(monday.other).toHaveLength(1);
    expect(result.days[1].released).toHaveLength(1);
    expect(result.days[1].released[0].title).toContain("统筹看板");
    expect(result.days[1].completed.map(item => item.title)).toEqual(["已完成任务"]);
    expect(result.days[1].checked[0]).toMatchObject({ title: "待检查任务", note: "已检查并给出结论" });
    expect(result.days.flatMap(item => item.completed).map(item => item.title)).not.toContain("已删除任务");
    expect(result.summary).toEqual({ completed: 1, released: 3, checked: 1 });
  });

  it("accepts an empty week without throwing and requires SSO at the HTTP boundary", async () => {
    const result = await journal(env, "2026-12-14", undefined, day);
    expect(result.days).toHaveLength(7);
    expect(result.days.every(item => item.count === 0)).toBe(true);
    const response = await worker.fetch(new Request("https://project.codepi.app/api/journal?week=2026-12-14"), env);
    expect(response.status).toBe(401);
  });
});
