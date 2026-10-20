import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import {
  handoffPage,
  latestHandoff,
  latestPerTask,
  parseHandoffInput,
  saveHandoff,
} from "../worker/handoffs";
import { handoffArgs, handoffInput, resetDb, seedProject } from "./helpers";

describe("task handoffs", () => {
  beforeEach(async () => {
    await resetDb();
    await seedProject();
  });

  it("requires task, status, branch, full base SHA and an explicit client", () => {
    const required = [
      "task_id", "status", "branch", "base_sha",
    ];
    for (const key of required) {
      const args = handoffArgs();
      delete (args as Record<string, unknown>)[key];
      expect(() => parseHandoffInput(args, {
        projectId: "kedoupi-kdp-cool",
        clientId: "client-a",
        via: "mcp",
      })).toThrow();
    }
    expect(() => parseHandoffInput(handoffArgs({ base_sha: "abc" }), {
      projectId: "kedoupi-kdp-cool",
      clientId: "client-a",
      via: "mcp",
    })).toThrow();
    expect(() => parseHandoffInput(handoffArgs(), {
      projectId: "kedoupi-kdp-cool",
      clientId: "",
      via: "mcp",
    })).toThrow(/client/i);
    expect(() => parseHandoffInput(handoffArgs({ unexpected: true }), {
      projectId: "kedoupi-kdp-cool",
      clientId: "client-a",
      via: "mcp",
    })).toThrow();
  });

  it("validates status, commit, request id and files", () => {
    const context = { projectId: "kedoupi-kdp-cool", clientId: "client-a", via: "mcp" as const };
    expect(() => parseHandoffInput(handoffArgs({ status: "working" }), context)).toThrow();
    expect(() => parseHandoffInput(handoffArgs({ commit: "ABCDEF0" }), context)).toThrow();
    expect(() => parseHandoffInput(handoffArgs({ commit: "abc1234" }), context)).not.toThrow();
    expect(() => parseHandoffInput(handoffArgs({ request_id: "x".repeat(101) }), context)).toThrow();
    expect(() => parseHandoffInput(handoffArgs({ request_id: "retry/run 1" }), context)).not.toThrow();
    expect(() => parseHandoffInput(handoffArgs({ pr: 42 }), context)).toThrow();
    expect(() => parseHandoffInput(handoffArgs({ pr: "42" }), context)).not.toThrow();
    expect(() => parseHandoffInput(handoffArgs({ files: Array(51).fill("x") }), context)).toThrow();
    expect(() => parseHandoffInput(handoffArgs({ summary: "a\u0000b" }), context)).toThrow();
  });

  it("appends once per request id and rejects conflicting reuse", async () => {
    const input = handoffInput({
      taskId: "task-a",
      requestId: "request-1",
    });
    const first = await saveHandoff(env, input);
    const retry = await saveHandoff(env, input);
    expect(retry.deduplicated).toBe(true);
    expect(retry.handoff.id).toBe(first.handoff.id);
    await expect(saveHandoff(env, { ...input, summary: "changed" }))
      .rejects.toMatchObject({ code: "request_id_conflict", status: 409 });
  });

  it("keeps per-task progress separate when tasks run concurrently", async () => {
    const a1 = await saveHandoff(env, handoffInput({ taskId: "task-a", summary: "A first" }));
    await env.DB.prepare("UPDATE handoffs SET created_at=? WHERE id=?")
      .bind("2026-10-20T01:00:00Z", a1.handoff.id).run();
    const b = await saveHandoff(env, handoffInput({ taskId: "task-b", summary: "B first" }));
    await env.DB.prepare("UPDATE handoffs SET created_at=? WHERE id=?")
      .bind("2026-10-20T02:00:00Z", b.handoff.id).run();
    const a2 = await saveHandoff(env, handoffInput({ taskId: "task-a", summary: "A second" }));
    await env.DB.prepare("UPDATE handoffs SET created_at=? WHERE id=?")
      .bind("2026-10-20T03:00:00Z", a2.handoff.id).run();

    const tasks = await latestPerTask(env, "kedoupi-kdp-cool");
    expect(tasks.map(item => [item.task_id, item.latest.summary])).toEqual([
      ["task-a", "A second"],
      ["task-b", "B first"],
    ]);
    expect((await latestHandoff(env, "kedoupi-kdp-cool", "task-b"))?.summary).toBe("B first");
  });

  it("paginates equal timestamps without dropping rows", async () => {
    for (const task of ["task-a", "task-b", "task-c"]) {
      await saveHandoff(env, handoffInput({ taskId: task }));
    }
    await env.DB.prepare("UPDATE handoffs SET created_at=?").bind("2026-10-20T03:00:00Z").run();
    const first = await handoffPage(env, "kedoupi-kdp-cool", { limit: 2 });
    expect(first.handoffs).toHaveLength(2);
    expect(first.next_before).toBe("2026-10-20T03:00:00Z");
    expect(first.next_before_id).toBeTruthy();
    const second = await handoffPage(env, "kedoupi-kdp-cool", {
      limit: 2,
      before: first.next_before,
      beforeId: first.next_before_id,
    });
    expect(second.handoffs).toHaveLength(1);
    expect(new Set([...first.handoffs, ...second.handoffs].map(item => item.id)).size).toBe(3);
  });
});
