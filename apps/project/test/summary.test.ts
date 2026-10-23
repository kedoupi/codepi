import { env } from "cloudflare:test";
import { MCP_LIMITS } from "@kedoupi/shared/mcp/contract";
import { beforeEach, describe, expect, it } from "vitest";
import { saveHandoff } from "../worker/handoffs";
import { jsonBytes } from "../worker/lib";
import { buildSummary, fitSummary } from "../worker/summary";
import { handoffInput, resetDb, seedProject } from "./helpers";

describe("project source summary", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("returns an empty summary without projects", async () => {
    const summary = await buildSummary(env, "kdp-owner");
    expect(summary).toMatchObject({ source: "project", status: "empty", stale: false });
  });

  it("summarizes per-project progress, attention and stale sync without privateMetric", async () => {
    await seedProject();
    await saveHandoff(env, handoffInput({ taskId: "task-a", next: "Run integration checks." }));
    await env.DB.batch([
      env.DB.prepare(`INSERT INTO repo_events
        (project_id,kind,ref,title,state,url,happened_at) VALUES (?,?,?,?,?,?,?)`)
        .bind("kedoupi-codepi", "pr", "1", "A very long open pull request title",
          "open", "https://github.com/kedoupi/codepi/pull/1", "2026-10-20T00:00:00Z"),
      env.DB.prepare(`INSERT INTO sync_state
        (project_id,source,last_ok_at,last_error,last_attempt_at) VALUES (?,?,?,?,?)`)
        .bind("kedoupi-codepi", "commits", "2026-10-19T00:00:00Z", "github_forbidden", "2026-10-19T00:00:00Z"),
      env.DB.prepare(`INSERT INTO sync_state
        (project_id,source,last_ok_at,last_error,last_attempt_at) VALUES (?,?,?,?,?)`)
        .bind("kedoupi-codepi", "pulls", "2026-10-19T00:00:00Z", null, "2026-10-19T00:00:00Z"),
      env.DB.prepare(`INSERT INTO sync_state
        (project_id,source,last_ok_at,last_error,last_attempt_at) VALUES (?,?,?,?,?)`)
        .bind("kedoupi-codepi", "issues", "2026-10-19T00:00:00Z", null, "2026-10-19T00:00:00Z"),
      env.DB.prepare(`INSERT INTO sync_state
        (project_id,source,last_ok_at,last_error,last_attempt_at) VALUES (?,?,?,?,?)`)
        .bind("kedoupi-codepi", "agents_md", "2026-10-19T00:00:00Z", null, "2026-10-19T00:00:00Z"),
      env.DB.prepare(`INSERT INTO sync_state
        (project_id,source,last_ok_at,last_error,last_attempt_at) VALUES (?,?,?,?,?)`)
        .bind("kedoupi-codepi", "tasks", "2026-10-19T00:00:00Z", null, "2026-10-19T00:00:00Z"),
    ]);
    const summary = await buildSummary(env, "kdp-owner");
    expect(summary.status).toBe("ok");
    expect(summary.stale).toBe(true);
    expect(summary.metrics).toEqual([
      { label: "进行中项目", value: "1" },
      { label: "最近 7 天交接", value: "1" },
    ]);
    expect(summary.facts[0]).toContain("codepi");
    expect(summary.facts[0]).toContain("Run integration checks.");
    expect(summary.attention.some(item => item.label.includes("github_forbidden"))).toBe(true);
    expect("privateMetric" in summary).toBe(false);
    expect(jsonBytes(summary)).toBeLessThanOrEqual(MCP_LIMITS.overview);
  });

  it("returns empty when projects exist but no handoff has been saved", async () => {
    await seedProject();
    const summary = await buildSummary(env, "kdp-owner");
    expect(summary.status).toBe("empty");
    expect(summary.facts[0]).toContain("尚无交接记录");
  });

  it("never emits more than 4 KiB even when facts are very long", () => {
    const summary = fitSummary({
      source: "project",
      status: "ok",
      asOf: "2026-10-20T00:00:00Z",
      updatedAt: "2026-10-20T00:00:00Z",
      stale: false,
      metrics: Array.from({ length: 20 }, (_, index) => ({
        label: `Metric ${index}`,
        value: "value".repeat(20),
      })),
      facts: Array.from({ length: 30 }, (_, index) => `Fact ${index} ${"长".repeat(1500)}`),
      notes: ["note ".repeat(1000)],
      attention: Array.from({ length: 30 }, (_, index) => ({
        label: `Attention ${index} ${"x".repeat(300)}`,
        href: `https://project.codepi.app/p/${index}`,
      })),
      privateMetric: { label: "secret", value: "must disappear" },
    } as never);
    expect(jsonBytes(summary)).toBeLessThanOrEqual(MCP_LIMITS.overview);
    expect("privateMetric" in summary).toBe(false);
  });

  it("does not expose data to a non-owner subject", async () => {
    await seedProject();
    const summary = await buildSummary(env, "someone-else");
    expect(summary.status).toBe("unavailable");
    expect(summary.facts).toEqual([]);
  });
});
