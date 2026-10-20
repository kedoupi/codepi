import { env } from "cloudflare:test";
import { MCP_LIMITS } from "@kedoupi/shared/mcp/contract";
import { beforeEach, describe, expect, it } from "vitest";
import { saveHandoff } from "../worker/handoffs";
import { executeProject } from "../worker/mcp";
import { jsonBytes } from "../worker/lib";
import { listProjects, listProjectSummaries } from "../worker/projects";
import { handoffArgs, handoffInput, resetDb, seedProject } from "./helpers";

describe("ProjectMcp operations", () => {
  beforeEach(async () => {
    await resetDb();
    await seedProject();
  });

  it("rejects non-owner subjects and unknown arguments before writing", async () => {
    const denied = await executeProject(env, {
      subject: "someone-else",
      operation: "list",
      args: {},
    });
    expect(denied).toEqual({ ok: false, error: "not_owner", status: 403 });
    const unknown = await executeProject(env, {
      subject: "kdp-owner",
      operation: "list",
      args: { extra: true },
    });
    expect(unknown).toEqual({ ok: false, error: "invalid_arguments", status: 400 });
  });

  it("lists projects and requires a client for handoff writes", async () => {
    const listed = await executeProject(env, {
      subject: "kdp-owner",
      operation: "list",
      args: { status: "active" },
    });
    expect(listed.ok).toBe(true);
    if (listed.ok) {
      expect((listed.data.projects as unknown[]).length).toBe(1);
    }
    const missingClient = await executeProject(env, {
      subject: "kdp-owner",
      operation: "handoff_save",
      args: handoffArgs(),
    });
    expect(missingClient).toEqual({ ok: false, error: "client_required", status: 400 });
  });

  it("keeps the MCP list bounded while the HTTP list retains the full handoff", async () => {
    const next = "下".repeat(2000);
    const huge = await saveHandoff(env, handoffInput({
      taskId: "huge-list-task",
      summary: "述".repeat(2000),
      next,
      blockers: "阻".repeat(2000),
      files: Array.from({ length: 50 }, (_, index) =>
        `${String(index).padStart(3, "0")}${"项".repeat(297)}`),
    }));
    expect(jsonBytes(huge.handoff)).toBeGreaterThan(50_000);

    const listed = await executeProject(env, {
      subject: "kdp-owner",
      operation: "list",
      args: { status: "active" },
    });
    expect(listed.ok).toBe(true);
    if (!listed.ok) return;
    expect(jsonBytes(listed)).toBeLessThanOrEqual(MCP_LIMITS.detail);
    expect(listed.data.next_offset).toBeNull();
    const projects = listed.data.projects as {
      latest_handoff: Record<string, unknown>;
    }[];
    expect(projects).toHaveLength(1);
    expect(Object.keys(projects[0].latest_handoff).sort()).toEqual([
      "next",
      "status",
      "task_id",
    ]);
    expect(projects[0].latest_handoff.task_id).toBe("huge-list-task");
    expect(Array.from(projects[0].latest_handoff.next as string)).toHaveLength(160);
    expect(projects[0].latest_handoff.next).toMatch(/\.\.\.$/);

    const full = await listProjects(env, "active");
    expect(full.projects[0].latest_handoff?.next).toBe(next);
  });

  it("uses 20 by default and follows strict offset pages without omissions", async () => {
    for (let index = 1; index <= 24; index++) {
      await seedProject({
        id: `project-${index}`,
        repo: `kedoupi/project-${index}`,
        name: `Project ${String(index).padStart(2, "0")}`,
      });
    }
    const expected = (await listProjectSummaries(env, "active")).projects.map(item => item.id);
    const first = await executeProject(env, {
      subject: "kdp-owner",
      operation: "list",
      args: { status: "active" },
    });
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    expect(first.data.projects).toHaveLength(20);
    expect(first.data.next_offset).toBe(20);
    expect(first.data.revision).toMatch(/^[0-9a-f]{64}$/);

    const second = await executeProject(env, {
      subject: "kdp-owner",
      operation: "list",
      args: {
        status: "active",
        offset: 20,
        limit: 50,
        revision: first.data.revision,
      },
    });
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(second.data.next_offset).toBeNull();
    expect(second.data.revision).toBe(first.data.revision);
    const seen = [
      ...(first.data.projects as { id: string }[]),
      ...(second.data.projects as { id: string }[]),
    ].map(item => item.id);
    expect(seen).toEqual(expected);
    expect(new Set(seen).size).toBe(25);

    for (const args of [{ limit: 0 }, { limit: 51 }, { offset: -1 }]) {
      expect(await executeProject(env, {
        subject: "kdp-owner",
        operation: "list",
        args,
      })).toEqual({ ok: false, error: "invalid_arguments", status: 400 });
    }
  });

  it("uses the 12 KiB budget to advance pages without silently dropping projects", async () => {
    for (let index = 1; index <= 30; index++) {
      const id = `budget-project-${index}`;
      await seedProject({
        id,
        repo: `kedoupi/budget-project-${index}`,
        name: `预算项目 ${String(index).padStart(2, "0")}`,
      });
      await saveHandoff(env, handoffInput({
        projectId: id,
        taskId: `budget-task-${index}`,
        next: "下".repeat(2000),
      }));
    }
    const expected = (await listProjectSummaries(env, "active")).projects.map(item => item.id);
    const seen: string[] = [];
    let offset = 0;
    let revision: string | undefined;
    let pages = 0;
    while (true) {
      const result = await executeProject(env, {
        subject: "kdp-owner",
        operation: "list",
        args: {
          status: "active",
          offset,
          limit: 50,
          ...(revision === undefined ? {} : { revision }),
        },
      });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(jsonBytes(result)).toBeLessThanOrEqual(MCP_LIMITS.detail);
      expect(result.data.as_of).toBeTypeOf("string");
      expect(result.data.revision).toMatch(/^[0-9a-f]{64}$/);
      revision ??= result.data.revision as string;
      expect(result.data.revision).toBe(revision);
      const items = result.data.projects as { id: string }[];
      expect(items.length).toBeGreaterThan(0);
      seen.push(...items.map(item => item.id));
      const nextOffset = result.data.next_offset as number | null;
      expect(nextOffset === null || nextOffset > offset).toBe(true);
      pages++;
      if (nextOffset === null) break;
      offset = nextOffset;
      expect(pages).toBeLessThan(20);
    }
    expect(pages).toBeGreaterThan(1);
    expect(seen).toEqual(expected);
    expect(new Set(seen).size).toBe(31);
  });

  it("rejects continuation with a changed revision instead of silently skipping projects", async () => {
    await env.DB.prepare("UPDATE projects SET status='paused' WHERE id=?")
      .bind("kedoupi-codepi").run();
    for (const [id, name] of [["alpha", "Alpha"], ["beta", "Beta"], ["gamma", "Gamma"]]) {
      await seedProject({
        id,
        repo: `synthetic/${id}`,
        name,
      });
    }

    const first = await executeProject(env, {
      subject: "kdp-owner",
      operation: "list",
      args: { status: "active", offset: 0, limit: 1 },
    });
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    expect((first.data.projects as { id: string }[]).map(item => item.id)).toEqual(["alpha"]);
    expect(first.data.next_offset).toBe(1);
    const revision = first.data.revision as string;

    await env.DB.prepare("UPDATE projects SET status='paused' WHERE id=?")
      .bind("alpha").run();

    expect(await executeProject(env, {
      subject: "kdp-owner",
      operation: "list",
      args: { status: "active", offset: 1, limit: 1 },
    })).toEqual({ ok: false, error: "cursor_stale", status: 409 });
    expect(await executeProject(env, {
      subject: "kdp-owner",
      operation: "list",
      args: { status: "active", offset: 1, limit: 1, revision },
    })).toEqual({ ok: false, error: "cursor_stale", status: 409 });

    const restarted = await executeProject(env, {
      subject: "kdp-owner",
      operation: "list",
      args: { status: "active", offset: 0, limit: 1 },
    });
    expect(restarted.ok).toBe(true);
    if (!restarted.ok) return;
    expect((restarted.data.projects as { id: string }[]).map(item => item.id)).toEqual(["beta"]);
    expect(restarted.data.revision).not.toBe(revision);

    expect(await executeProject(env, {
      subject: "kdp-owner",
      operation: "list",
      args: { status: "active", offset: 1, limit: 1, revision: "not-a-digest" },
    })).toEqual({ ok: false, error: "invalid_arguments", status: 400 });
  });

  it("saves task-specific progress and filters project_get by task_id", async () => {
    for (const taskId of ["task-a", "task-b"]) {
      const saved = await executeProject(env, {
        subject: "kdp-owner",
        client: "codex",
        clientName: "Codex",
        operation: "handoff_save",
        args: handoffArgs({
          task_id: taskId,
          summary: `${taskId} summary`,
          next: `${taskId} next`,
          request_id: `request-${taskId}`,
        }),
      });
      expect(saved.ok).toBe(true);
    }
    const card = await executeProject(env, {
      subject: "kdp-owner",
      operation: "get",
      args: { project: "kedoupi/codepi", task_id: "task-b" },
    });
    expect(card.ok).toBe(true);
    if (card.ok) {
      expect((card.data.progress as { summary: string }).summary).toBe("task-b summary");
      expect(card.data.task_progress).toHaveLength(1);
    }
  });

  it("returns per-page project metadata for an oversized MCP project_get", async () => {
    const files = Array.from({ length: 50 }, (_, index) =>
      `src/${index}/` + "x".repeat(280));
    const saved = await executeProject(env, {
      subject: "kdp-owner",
      client: "codex",
      operation: "handoff_save",
      args: handoffArgs({
        task_id: "paged-task",
        files,
        request_id: "paged-request",
      }),
    });
    expect(saved.ok).toBe(true);

    const result = await executeProject(env, {
      subject: "kdp-owner",
      operation: "get",
      args: { project: "kedoupi/codepi", handoffs: 20 },
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(jsonBytes(result.data)).toBeLessThanOrEqual(MCP_LIMITS.detail);
    expect(result.data.as_of).toBeTypeOf("string");
    expect(result.data.project).toMatchObject({
      id: "kedoupi-codepi",
      repo: "kedoupi/codepi",
    });
    expect(result.data.pagination).toMatchObject({
      format: "project_card_json_v1",
      encoding: "utf-8",
      complete: false,
    });
    expect((result.data.pagination as { next_cursor: string }).next_cursor)
      .toBeTruthy();
  });

  it("makes retries idempotent through request_id", async () => {
    const request = {
      subject: "kdp-owner",
      client: "codex",
      operation: "handoff_save" as const,
      args: handoffArgs({ request_id: "same-request" }),
    };
    const first = await executeProject(env, request);
    const second = await executeProject(env, request);
    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    if (first.ok && second.ok) {
      expect(second.data.id).toBe(first.data.id);
      expect(second.data.deduplicated).toBe(true);
    }
  });
});
