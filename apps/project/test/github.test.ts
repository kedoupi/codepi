import { env } from "cloudflare:test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  runScheduledSync,
  syncProject,
  SyncLeaseLost,
  SyncTooFrequent,
} from "../worker/github";
import { resetDb, seedProject } from "./helpers";
import type { Env } from "../worker/types";

const commitPage2 = "https://api.github.com/repos/kedoupi/codepi/commits?sha=main&since=x&per_page=50&page=2";

function response(body: unknown, init: ResponseInit = {}) {
  return Response.json(body, init);
}

function emptyData(url: URL) {
  if (url.pathname.endsWith("/pulls")) return [];
  if (url.pathname.endsWith("/issues")) return [];
  if (url.pathname.endsWith("/contents/docs/development/tasks")) return [];
  return null;
}

describe("GitHub synchronization", () => {
  beforeEach(async () => {
    await resetDb();
    await seedProject();
  });

  afterEach(() => vi.restoreAllMocks());

  it("follows Link pages, normalizes PRs/issues, extracts AGENTS.md and keeps unknown task status", async () => {
    let taskFiles: unknown[] = [{
      name: "a.md",
      path: "docs/development/tasks/a.md",
      sha: "task-sha-1",
      type: "file",
      url: "https://api.github.com/repos/kedoupi/codepi/contents/docs/development/tasks/a.md?ref=main",
    }];
    const calls: string[] = [];
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const request = new Request(input, init);
      calls.push(request.url);
      const url = new URL(request.url);
      if (url.pathname.endsWith("/commits")) {
        if (url.searchParams.get("page") === "2") {
          return response([{
            sha: "b".repeat(40),
            html_url: "https://github.com/kedoupi/codepi/commit/bbbb",
            commit: {
              message: "Older commit\nbody",
              author: { name: "Owner", date: "2026-10-19T10:00:00Z" },
            },
          }]);
        }
        return response([{
          sha: "a".repeat(40),
          html_url: "https://github.com/kedoupi/codepi/commit/aaaa",
          commit: {
            message: "Newest commit",
            author: { name: "Owner", date: "2026-10-20T10:00:00Z" },
          },
          author: { login: "owner-login" },
        }], {
          headers: { Link: `<${commitPage2}>; rel="next"` },
        });
      }
      if (url.pathname.endsWith("/pulls")) {
        return response([
          {
            number: 8, html_url: "https://github.com/kedoupi/codepi/pull/8",
            title: "Open change", state: "open", merged_at: null,
            updated_at: "2026-10-20T09:00:00Z", user: { login: "owner" },
          },
          {
            number: 7, html_url: "https://github.com/kedoupi/codepi/pull/7",
            title: "Merged change", state: "closed", merged_at: "2026-10-20T08:00:00Z",
            updated_at: "2026-10-20T08:00:00Z", user: { login: "owner" },
          },
        ]);
      }
      if (url.pathname.endsWith("/issues")) {
        return response([
          {
            number: 3, html_url: "https://github.com/kedoupi/codepi/issues/3",
            title: "Real issue", state: "open", updated_at: "2026-10-20T07:00:00Z",
            user: { login: "owner" },
          },
          {
            number: 9, html_url: "https://github.com/kedoupi/codepi/pull/9",
            title: "Issue-shaped PR", state: "open", updated_at: "2026-10-20T06:00:00Z",
            pull_request: {},
          },
        ]);
      }
      if (url.pathname.endsWith("/contents/AGENTS.md")) {
        if (request.headers.get("Accept") === "application/vnd.github.raw") {
          return new Response(`# Repo

## What this repo is

A synthetic repository.

## Architecture in one screen

\`\`\`
apps/
\`\`\`

## Conventions

- Keep scope narrow.

## Pitfalls

1. **Unsafe defaults** Check origin before writing.
`);
        }
        return response({
          name: "AGENTS.md", path: "AGENTS.md", sha: "agents-sha", type: "file",
          url: "https://api.github.com/repos/kedoupi/codepi/contents/AGENTS.md?ref=main",
        });
      }
      if (url.pathname.endsWith("/contents/docs/development/tasks")) {
        return response(taskFiles);
      }
      if (url.pathname.endsWith("/contents/docs/development/tasks/a.md")) {
        return new Response("# Task A\n\n- 状态：实施中，等待外部结论\n");
      }
      const empty = emptyData(url);
      if (empty) return response(empty);
      throw new Error(`Unexpected GitHub URL ${request.url}`);
    });

    const bindings = { ...env, GITHUB_TOKEN: "synthetic-read-only-token" } as Env;
    const startedAt = Date.now();
    const result = await syncProject(bindings, await projectRow(), { now: startedAt });
    expect(result.errors).toEqual({});
    expect(calls).toContain(commitPage2);
    const commits = await env.DB.prepare(
      "SELECT ref,author FROM repo_events WHERE kind='commit' ORDER BY happened_at",
    ).all<{ ref: string; author: string }>();
    expect(commits.results).toEqual([
      { ref: "b".repeat(40), author: "Owner" },
      { ref: "a".repeat(40), author: "owner-login" },
    ]);
    const pulls = await env.DB.prepare(
      "SELECT ref,state FROM repo_events WHERE kind='pr' ORDER BY ref",
    ).all<{ ref: string; state: string }>();
    expect(pulls.results).toEqual([
      { ref: "7", state: "merged" },
      { ref: "8", state: "open" },
    ]);
    const issues = await env.DB.prepare(
      "SELECT ref,state FROM repo_events WHERE kind='issue'",
    ).all<{ ref: string; state: string }>();
    expect(issues.results).toEqual([{ ref: "3", state: "open" }]);
    const fields = await env.DB.prepare(
      "SELECT field,auto_value FROM card_fields ORDER BY field",
    ).all<{ field: string; auto_value: string }>();
    expect(fields.results).toHaveLength(4);
    expect(fields.results.every(row => row.auto_value.length > 0)).toBe(true);
    const task = await env.DB.prepare(
      "SELECT title,status FROM task_notes WHERE path=?",
    ).bind("docs/development/tasks/a.md").first<{ title: string; status: string }>();
    expect(task).toEqual({ title: "Task A", status: "in_progress" });

    taskFiles = [];
    await syncProject(bindings, await projectRow(), { now: startedAt + 60_000 });
    expect(await env.DB.prepare("SELECT COUNT(*) AS n FROM task_notes").first("n")).toBe(0);
  });

  it("keeps the completed high-water cursor and resumes from a failed page checkpoint", async () => {
    await env.DB.prepare(`INSERT INTO sync_state
      (project_id,source,cursor,last_ok_at) VALUES (?,?,?,?)`)
      .bind("kedoupi-codepi", "commits", "2026-10-19T00:00:00Z", "2026-10-19T01:00:00Z").run();
    let failPage2 = true;
    const seen: string[] = [];
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const request = new Request(input, init);
      seen.push(request.url);
      const url = new URL(request.url);
      if (url.pathname.endsWith("/commits")) {
        if (url.searchParams.get("page") === "2") {
          if (failPage2) return new Response("unavailable", { status: 500 });
          return response([{
            sha: "c".repeat(40),
            html_url: "https://github.com/kedoupi/codepi/commit/cccc",
            commit: {
              message: "Continuation commit",
              author: { name: "Owner", date: "2026-10-18T10:00:00Z" },
            },
          }]);
        }
        return response([{
          sha: "d".repeat(40),
          html_url: "https://github.com/kedoupi/codepi/commit/dddd",
          commit: {
            message: "New commit",
            author: { name: "Owner", date: "2026-10-20T10:00:00Z" },
          },
        }], { headers: { Link: `<${commitPage2}>; rel="next"` } });
      }
      if (url.pathname.endsWith("/contents/AGENTS.md")) {
        return response({}, { status: 404 });
      }
      const empty = emptyData(url);
      if (empty) return response(empty);
      throw new Error(`Unexpected GitHub URL ${request.url}`);
    });
    const bindings = { ...env, GITHUB_TOKEN: "synthetic-read-only-token" } as Env;
    const startedAt = Date.now();
    const first = await syncProject(bindings, await projectRow(), { now: startedAt });
    expect(first.errors.commits).toBe("github_unavailable");
    const state = await env.DB.prepare(
      "SELECT cursor,checkpoint,last_error FROM sync_state WHERE project_id=? AND source='commits'",
    ).bind("kedoupi-codepi").first<{
      cursor: string;
      checkpoint: string;
      last_error: string;
    }>();
    expect(state).toEqual({
      cursor: "2026-10-19T00:00:00Z",
      checkpoint: commitPage2,
      last_error: "github_unavailable",
    });

    failPage2 = false;
    seen.length = 0;
    const second = await syncProject(bindings, await projectRow(), { now: startedAt + 60_000 });
    expect(second.errors.commits).toBeUndefined();
    expect(seen).toContain(commitPage2);
    expect(seen.some(url => url.includes("per_page=50") && !url.includes("page=2"))).toBe(false);
    const completed = await env.DB.prepare(
      "SELECT cursor,checkpoint,last_error FROM sync_state WHERE project_id=? AND source='commits'",
    ).bind("kedoupi-codepi").first<{
      cursor: string;
      checkpoint: string | null;
      last_error: string | null;
    }>();
    expect(completed).toEqual({
      cursor: "2026-10-20T10:00:00Z",
      checkpoint: null,
      last_error: null,
    });
  });

  it("stops subsequent GitHub steps after a rate limit and preserves cursors", async () => {
    await env.DB.prepare(`INSERT INTO sync_state
      (project_id,source,cursor,last_ok_at) VALUES (?,?,?,?)`)
      .bind("kedoupi-codepi", "commits", "2026-10-18T00:00:00Z", "2026-10-18T01:00:00Z").run();
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("rate limited", {
        status: 429,
        headers: { "x-ratelimit-remaining": "0" },
      }),
    );
    const result = await syncProject(
      { ...env, GITHUB_TOKEN: "synthetic-read-only-token" } as Env,
      await projectRow(),
    );
    expect(result.rate_limited).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const states = await env.DB.prepare(
      "SELECT source,cursor,last_error FROM sync_state ORDER BY source",
    ).all<{ source: string; cursor: string | null; last_error: string }>();
    expect(states.results.map(row => [row.source, row.last_error])).toEqual([
      ["agents_md", "rate_limited"],
      ["commits", "rate_limited"],
      ["issues", "rate_limited"],
      ["pulls", "rate_limited"],
      ["tasks", "rate_limited"],
    ]);
    expect(states.results.find(row => row.source === "commits")?.cursor)
      .toBe("2026-10-18T00:00:00Z");
  });

  it("persists merged_at without using it as the pull synchronization cursor", async () => {
    const now = Date.now();
    const oldMergedAt = new Date(now - 30 * 86400_000).toISOString();
    const recentMergedAt = new Date(now - 10 * 86400_000).toISOString();
    const latestUpdate = new Date(now - 60_000).toISOString();
    const olderUpdate = new Date(now - 3600_000).toISOString();
    vi.spyOn(globalThis, "fetch").mockImplementation(async input => {
      const url = new URL(new Request(input).url);
      if (url.pathname.endsWith("/pulls")) {
        return response([
          {
            number: 41,
            html_url: "https://github.com/kedoupi/codepi/pull/41",
            title: "Merged long ago, commented today",
            state: "closed",
            merged_at: oldMergedAt,
            updated_at: latestUpdate,
            user: { login: "owner" },
          },
          {
            number: 42,
            html_url: "https://github.com/kedoupi/codepi/pull/42",
            title: "Recently merged",
            state: "closed",
            merged_at: recentMergedAt,
            updated_at: olderUpdate,
            user: { login: "owner" },
          },
        ]);
      }
      if (url.pathname.endsWith("/contents/AGENTS.md")) {
        return response({}, { status: 404 });
      }
      const empty = emptyData(url);
      if (empty) return response(empty);
      throw new Error(`Unexpected GitHub URL ${url}`);
    });

    const result = await syncProject(
      { ...env, GITHUB_TOKEN: "synthetic-read-only-token" } as Env,
      await projectRow(),
      { now },
    );
    expect(result.errors.pulls).toBeUndefined();
    const pulls = await env.DB.prepare(`SELECT ref,state,happened_at,merged_at
      FROM repo_events WHERE kind='pr' ORDER BY ref`).all<{
        ref: string;
        state: string;
        happened_at: string;
        merged_at: string;
      }>();
    expect(pulls.results).toEqual([
      {
        ref: "41",
        state: "merged",
        happened_at: latestUpdate,
        merged_at: oldMergedAt,
      },
      {
        ref: "42",
        state: "merged",
        happened_at: olderUpdate,
        merged_at: recentMergedAt,
      },
    ]);
    const state = await env.DB.prepare(`SELECT cursor FROM sync_state
      WHERE project_id=? AND source='pulls'`)
      .bind("kedoupi-codepi").first<{ cursor: string }>();
    expect(state?.cursor).toBe(latestUpdate);
  });

  it("renews the durable lease before continuing a long-running sync", async () => {
    const startedAt = Date.now();
    let now = startedAt;
    vi.spyOn(Date, "now").mockImplementation(() => now);
    let commitRequests = 0;
    let page2Started!: () => void;
    const page2Reached = new Promise<void>(resolve => {
      page2Started = resolve;
    });
    let releasePage2!: () => void;
    const page2Release = new Promise<void>(resolve => {
      releasePage2 = resolve;
    });
    let pullsStarted!: () => void;
    const pullsReached = new Promise<void>(resolve => {
      pullsStarted = resolve;
    });
    let releasePulls!: () => void;
    const pullsRelease = new Promise<void>(resolve => {
      releasePulls = resolve;
    });
    let requests = 0;
    vi.spyOn(globalThis, "fetch").mockImplementation(async input => {
      requests++;
      const url = new URL(new Request(input).url);
      if (url.pathname.endsWith("/commits")) {
        commitRequests++;
        if (commitRequests === 1) {
          const next = new URL(url);
          next.searchParams.set("page", "2");
          return response([], { headers: { Link: `<${next}>; rel="next"` } });
        }
        page2Started();
        await page2Release;
        return response([]);
      }
      if (url.pathname.endsWith("/pulls")) {
        pullsStarted();
        await pullsRelease;
        return response([]);
      }
      if (url.pathname.endsWith("/contents/AGENTS.md")) {
        return response({}, { status: 404 });
      }
      const empty = emptyData(url);
      if (empty) return response(empty);
      throw new Error(`Unexpected GitHub URL ${url}`);
    });
    const bindings = { ...env, GITHUB_TOKEN: "synthetic-read-only-token" } as Env;
    const project = await projectRow();
    const first = syncProject(bindings, project, { now: startedAt });
    await page2Reached;
    now = startedAt + 14 * 60_000;
    releasePage2();
    await pullsReached;

    const lease = await env.DB.prepare(
      "SELECT lease_until_ms FROM sync_leases WHERE project_id=?",
    ).bind(project.id).first<{ lease_until_ms: number }>();
    expect(lease?.lease_until_ms).toBe(startedAt + 29 * 60_000);

    const requestsBeforeRejectedClaim = requests;
    now = startedAt + 16 * 60_000;
    await expect(syncProject(bindings, project, { now })).rejects
      .toMatchObject({ retryAfter: 780 });
    expect(requests).toBe(requestsBeforeRejectedClaim);

    releasePulls();
    expect((await first).errors).toEqual({ agents_md: "github_forbidden" });
  });

  it("stops a resumed run after ownership moves and preserves the replacement checkpoint", async () => {
    await env.DB.prepare(`INSERT INTO sync_state
      (project_id,source,cursor,checkpoint,last_ok_at) VALUES (?,?,?,?,?)`)
      .bind(
        "kedoupi-codepi",
        "commits",
        "2026-10-19T00:00:00Z",
        commitPage2,
        "2026-10-19T01:00:00Z",
      ).run();
    const startedAt = Date.now();
    let now = startedAt;
    vi.spyOn(Date, "now").mockImplementation(() => now);
    let page2Calls = 0;
    let firstPage2Started!: () => void;
    const firstPage2Reached = new Promise<void>(resolve => {
      firstPage2Started = resolve;
    });
    let releaseFirstPage2!: () => void;
    const firstPage2Release = new Promise<void>(resolve => {
      releaseFirstPage2 = resolve;
    });
    vi.spyOn(globalThis, "fetch").mockImplementation(async input => {
      const url = new URL(new Request(input).url);
      if (url.pathname.endsWith("/commits")) {
        if (url.href !== commitPage2) {
          throw new Error(`Unexpected commit checkpoint URL ${url.href}`);
        }
        page2Calls++;
        if (page2Calls === 1) {
          firstPage2Started();
          await firstPage2Release;
          return response([{
            sha: "e".repeat(40),
            html_url: "https://github.com/kedoupi/codepi/commit/eeee",
            commit: {
              message: "Must not be written after lease loss",
              author: { name: "Owner", date: "2026-10-20T10:00:00Z" },
            },
          }]);
        }
        if (page2Calls === 2) {
          return new Response("unavailable", { status: 503 });
        }
        return response([{
          sha: "f".repeat(40),
          html_url: "https://github.com/kedoupi/codepi/commit/ffff",
          commit: {
            message: "Recovered checkpoint",
            author: { name: "Owner", date: "2026-10-20T11:00:00Z" },
          },
        }]);
      }
      if (url.pathname.endsWith("/contents/AGENTS.md")) {
        return response({}, { status: 404 });
      }
      const empty = emptyData(url);
      if (empty) return response(empty);
      throw new Error(`Unexpected GitHub URL ${url}`);
    });
    const bindings = { ...env, GITHUB_TOKEN: "synthetic-read-only-token" } as Env;
    const project = await projectRow();
    const first = syncProject(bindings, project, { now: startedAt });
    const firstOutcome = first.then(
      value => ({ value }),
      error => ({ error }),
    );
    await firstPage2Reached;

    now = startedAt + 61_000;
    await expect(syncProject(bindings, project, { now })).rejects
      .toMatchObject({ retryAfter: 839 });
    expect(page2Calls).toBe(1);

    now = startedAt + 16 * 60_000;
    const second = await syncProject(bindings, project, { now });
    expect(second.errors.commits).toBe("github_unavailable");
    expect(await env.DB.prepare(`SELECT cursor,checkpoint,last_error FROM sync_state
      WHERE project_id=? AND source='commits'`)
      .bind("kedoupi-codepi").first()).toEqual({
        cursor: "2026-10-19T00:00:00Z",
        checkpoint: commitPage2,
        last_error: "github_unavailable",
      });

    releaseFirstPage2();
    const outcome = await firstOutcome;
    expect(outcome).toHaveProperty("error");
    if (!("error" in outcome)) throw new Error("expected the stale sync to stop");
    expect(outcome.error).toBeInstanceOf(SyncLeaseLost);
    expect(await env.DB.prepare("SELECT COUNT(*) AS n FROM repo_events WHERE ref=?")
      .bind("e".repeat(40)).first("n")).toBe(0);
    expect(await env.DB.prepare(`SELECT cursor,checkpoint,last_error FROM sync_state
      WHERE project_id=? AND source='commits'`)
      .bind("kedoupi-codepi").first()).toEqual({
        cursor: "2026-10-19T00:00:00Z",
        checkpoint: commitPage2,
        last_error: "github_unavailable",
      });

    now = startedAt + 16 * 60_000 + 60_001;
    const recovered = await syncProject(bindings, project, { now });
    expect(recovered.errors.commits).toBeUndefined();
    expect(await env.DB.prepare("SELECT COUNT(*) AS n FROM repo_events WHERE ref=?")
      .bind("f".repeat(40)).first("n")).toBe(1);
    expect(await env.DB.prepare(`SELECT cursor,checkpoint,last_error FROM sync_state
      WHERE project_id=? AND source='commits'`)
      .bind("kedoupi-codepi").first()).toEqual({
        cursor: "2026-10-20T11:00:00Z",
        checkpoint: null,
        last_error: null,
      });
  });

  it("serializes concurrent syncs and keeps the cooldown until 60 seconds", async () => {
    let calls = 0;
    vi.spyOn(globalThis, "fetch").mockImplementation(async input => {
      calls++;
      const url = new URL(new Request(input).url);
      if (url.pathname.endsWith("/contents/AGENTS.md")) {
        return response({}, { status: 404 });
      }
      const empty = emptyData(url);
      if (empty) return response(empty);
      throw new Error(`Unexpected GitHub URL ${url}`);
    });
    const bindings = {
      ...env,
      GITHUB_TOKEN: "synthetic-read-only-token",
    } as Env;
    const project = await projectRow();
    const startedAt = Date.now();
    const attempts = await Promise.allSettled([
      syncProject(bindings, project, { now: startedAt }),
      syncProject(bindings, project, { now: startedAt }),
    ]);
    expect(attempts.filter(item => item.status === "fulfilled")).toHaveLength(1);
    const rejected = attempts.find(item => item.status === "rejected");
    expect(rejected).toMatchObject({
      status: "rejected",
      reason: expect.any(SyncTooFrequent),
    });
    if (rejected?.status === "rejected") {
      expect((rejected.reason as SyncTooFrequent).retryAfter).toBe(900);
    }
    const callsAfterFirst = calls;
    expect(callsAfterFirst).toBe(5);

    await runScheduledSync(bindings, { now: startedAt + 30_000 });
    expect(calls).toBe(callsAfterFirst);
    await expect(syncProject(bindings, project, { now: startedAt + 59_999 }))
      .rejects.toMatchObject({ retryAfter: 1 });
    expect(calls).toBe(callsAfterFirst);
    const allowed = await syncProject(bindings, project, { now: startedAt + 60_000 });
    expect(allowed.errors.agents_md).toBe("github_forbidden");
    expect(calls).toBeGreaterThan(callsAfterFirst);
  });
});

async function projectRow() {
  const row = await env.DB.prepare("SELECT * FROM projects WHERE id=?")
    .bind("kedoupi-codepi").first<{
      id: string;
      repo: string;
      name: string;
      status: "active" | "paused" | "archived";
      default_branch: string;
      created_at: string;
      updated_at: string;
    }>();
  if (!row) throw new Error("project fixture missing");
  return row;
}
