import { env } from "cloudflare:test";
import { MCP_LIMITS } from "@kedoupi/shared/mcp/contract";
import { beforeEach, describe, expect, it } from "vitest";
import { buildCard, projectGetPage } from "../worker/card";
import { saveHandoff } from "../worker/handoffs";
import { jsonBytes } from "../worker/lib";
import { handoffInput, resetDb, seedProject } from "./helpers";

describe("project card", () => {
  beforeEach(async () => {
    await resetDb();
    await seedProject();
  });

  it("prefers edited fields and exposes per-task progress and unknown task status", async () => {
    await env.DB.batch([
      env.DB.prepare(`INSERT INTO card_fields
        (project_id,field,auto_value,auto_sha,edited_value,edited_base_sha,edited_at)
        VALUES (?,?,?,?,?,?,?)`)
        .bind("kedoupi-codepi", "goal", "Automatic goal", "sha-new", "Edited goal", "sha-old", "2026-10-20T01:00:00Z"),
      env.DB.prepare(`INSERT INTO card_fields
        (project_id,field,auto_value,auto_sha) VALUES (?,?,?,?)`)
        .bind("kedoupi-codepi", "conventions", "Convention text", "sha-new"),
      env.DB.prepare(`INSERT INTO repo_events
        (project_id,kind,ref,title,state,author,url,happened_at)
        VALUES (?,?,?,?,?,?,?,?)`)
        .bind("kedoupi-codepi", "pr", "12", "Open PR", "open", "owner",
          "https://github.com/kedoupi/codepi/pull/12", "2026-10-20T02:00:00Z"),
      env.DB.prepare(`INSERT INTO repo_events
        (project_id,kind,ref,title,state,author,url,happened_at)
        VALUES (?,?,?,?,?,?,?,?)`)
        .bind("kedoupi-codepi", "commit", "abc1234", "A commit", null, "owner",
          "https://github.com/kedoupi/codepi/commit/abc1234", "2026-10-20T01:00:00Z"),
      env.DB.prepare(`INSERT INTO task_notes
        (project_id,path,title,status_line,status,sha,updated_at)
        VALUES (?,?,?,?,?,?,?)`)
        .bind("kedoupi-codepi", "docs/development/tasks/a.md", "Task A", "状态：无法识别", "unknown", "s1", "2026-10-20T03:00:00Z"),
      env.DB.prepare(`INSERT INTO task_notes
        (project_id,path,title,status_line,status,sha,updated_at)
        VALUES (?,?,?,?,?,?,?)`)
        .bind("kedoupi-codepi", "docs/development/tasks/b.md", "Done", "状态：已完成", "done", "s2", "2026-10-20T03:00:00Z"),
      env.DB.prepare(`INSERT INTO sync_state
        (project_id,source,cursor,last_ok_at) VALUES (?,?,?,?)`)
        .bind("kedoupi-codepi", "commits", "2026-10-20T01:00:00Z", "2026-10-20T03:00:00Z"),
    ]);
    const a = await saveHandoff(env, handoffInput({ taskId: "task-a" }));
    await env.DB.prepare("UPDATE handoffs SET created_at=? WHERE id=?")
      .bind("2026-10-20T01:00:00Z", a.handoff.id).run();
    const b = await saveHandoff(env, handoffInput({ taskId: "task-b", summary: "B progress" }));
    await env.DB.prepare("UPDATE handoffs SET created_at=? WHERE id=?")
      .bind("2026-10-20T02:00:00Z", b.handoff.id).run();

    const card = await buildCard(env, await seedProjectRow(), { handoffs: 20 });
    expect(card.goal).toMatchObject({
      value: "Edited goal",
      source: "edited",
      agents_md_changed: true,
    });
    expect(card.conventions).toMatchObject({
      value: "Convention text",
      source: "agents_md",
    });
    expect(card.progress?.summary).toBe("B progress");
    expect(card.task_progress.map(item => item.task_id)).toEqual(["task-b", "task-a"]);
    expect(card.active_tasks.map(task => [task.title, task.status])).toEqual([["Task A", "unknown"]]);
    expect(card.open_prs[0]).toMatchObject({ ref: "12", state: "open" });
    expect(card.recent_commits[0].sha).toBe("abc1234");
    expect(card.sync.commits.last_ok_at).toBe("2026-10-20T03:00:00Z");
  });

  it("selects recently merged PRs by merged_at instead of comment activity", async () => {
    const now = Date.now();
    const oldMerge = new Date(now - 30 * 86400_000).toISOString();
    const firstMerge = new Date(now - 12 * 86400_000).toISOString();
    const secondMerge = new Date(now - 3 * 86400_000).toISOString();
    const commentedAt = new Date(now - 60_000).toISOString();
    await env.DB.batch([
      env.DB.prepare(`INSERT INTO repo_events
        (project_id,kind,ref,title,state,author,url,happened_at,merged_at)
        VALUES (?,?,?,?,?,?,?,?,?)`)
        .bind("kedoupi-codepi", "pr", "1", "Old merge", "merged", "owner",
          "https://github.com/kedoupi/codepi/pull/1", commentedAt, oldMerge),
      env.DB.prepare(`INSERT INTO repo_events
        (project_id,kind,ref,title,state,author,url,happened_at,merged_at)
        VALUES (?,?,?,?,?,?,?,?,?)`)
        .bind("kedoupi-codepi", "pr", "2", "Older recent merge", "merged", "owner",
          "https://github.com/kedoupi/codepi/pull/2", commentedAt, firstMerge),
      env.DB.prepare(`INSERT INTO repo_events
        (project_id,kind,ref,title,state,author,url,happened_at,merged_at)
        VALUES (?,?,?,?,?,?,?,?,?)`)
        .bind("kedoupi-codepi", "pr", "3", "Newest recent merge", "merged", "owner",
          "https://github.com/kedoupi/codepi/pull/3", commentedAt, secondMerge),
    ]);

    const card = await buildCard(env, await seedProjectRow(), { handoffs: 20 });
    expect(card.recently_merged.map(event => event.ref)).toEqual(["3", "2"]);
    expect(card.recently_merged.map(event => event.at)).toEqual([secondMerge, firstMerge]);
  });

  it("pages oversized cards within 12 KiB and reconstructs all content", async () => {
    const files = Array.from({ length: 50 }, (_, index) => `src/${index}/` + "x".repeat(280));
    const huge = await saveHandoff(env, handoffInput({ taskId: "huge-task", files }));
    await env.DB.prepare("UPDATE handoffs SET created_at=? WHERE id=?")
      .bind("2026-10-20T05:00:00Z", huge.handoff.id).run();
    const card = await buildCard(env, await seedProjectRow(), { handoffs: 20 });
    expect(jsonBytes(card)).toBeGreaterThan(MCP_LIMITS.detail);

    let cursor: string | null = null;
    let reconstructed = "";
    let pages = 0;
    while (true) {
      pages++;
      const page = await projectGetPage(card, cursor);
      expect(jsonBytes(page)).toBeLessThanOrEqual(MCP_LIMITS.detail);
      expect(page.as_of).toBe(card.as_of);
      expect(page.project).toEqual(card.project);
      const pagination = page.pagination as {
        chunk: string;
        chunk_bytes: number;
        total_bytes: number;
        next_cursor: string | null;
        complete: boolean;
      };
      expect(pagination).toBeTruthy();
      expect(pagination.total_bytes).toBe(
        new TextEncoder().encode(JSON.stringify(card)).byteLength,
      );
      expect(pagination.chunk_bytes).toBe(
        new TextEncoder().encode(pagination.chunk).byteLength,
      );
      reconstructed += pagination.chunk;
      if (pagination.complete) break;
      cursor = pagination.next_cursor;
      expect(cursor).toBeTruthy();
      expect(pages).toBeLessThan(20);
    }
    expect(JSON.parse(reconstructed)).toEqual(JSON.parse(JSON.stringify(card)));
    expect(new TextEncoder().encode(reconstructed).byteLength).toBe(
      new TextEncoder().encode(JSON.stringify(card)).byteLength,
    );
    expect(pages).toBeGreaterThan(1);
  });

  it("rejects stale pagination instead of silently returning partial data", async () => {
    const files = Array.from({ length: 50 }, (_, index) => `src/${index}/` + "x".repeat(280));
    await saveHandoff(env, handoffInput({ taskId: "huge-task", files }));
    const card = await buildCard(env, await seedProjectRow(), { handoffs: 20 });
    const first = await projectGetPage(card, null);
    const cursor = (first.pagination as { next_cursor: string }).next_cursor;
    card.progress = card.progress ? { ...card.progress, summary: "changed" } : null;
    await expect(projectGetPage(card, cursor)).rejects.toMatchObject(
      expect.objectContaining({ code: "cursor_stale", status: 409 }),
    );
    await expect(projectGetPage(card, "not-a-cursor")).rejects.toMatchObject(
      expect.objectContaining({ code: "invalid_cursor", status: 400 }),
    );
  });
});

async function seedProjectRow() {
  return env.DB.prepare("SELECT * FROM projects WHERE id=?")
    .bind("kedoupi-codepi").first<{
      id: string;
      repo: string;
      name: string;
      status: "active" | "paused" | "archived";
      default_branch: string;
      created_at: string;
      updated_at: string;
    }>().then(row => row!);
}
