import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it, vi } from "vitest";
import worker from "../worker/index";
import { ingestRequest, resetDb, samplePayload, seedProject } from "./helpers";
import type { Env } from "../worker/types";

const origin = "https://project.codepi.app";
const authClientId = (env as Env).AUTH_CLIENT_ID || "project";

function request(path: string, options: { method?: string; body?: unknown; cookie?: string; origin?: string } = {}) {
  const headers: Record<string, string> = {};
  if (options.origin !== "") headers.Origin = options.origin || origin;
  if (options.body !== undefined) headers["Content-Type"] = "application/json";
  if (options.cookie) headers.Cookie = options.cookie;
  return new Request(origin + path, {
    method: options.method || (options.body === undefined ? "GET" : "POST"),
    headers,
    ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
  });
}

function cookieOf(response: Response, kind: string) {
  return response.headers.get("Set-Cookie")
    ?.match(new RegExp(`(__Host-kdp_${authClientId}_${kind}=[^;,]+)`))?.[1] || "";
}

function setup() {
  let active = true;
  const central = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const req = new Request(input, init);
    const body = await req.json() as Record<string, string>;
    if (req.url.endsWith("/exchange")) {
      return Response.json({ subject: "kdp-owner", session_ref: "browser-session-ref", expires_at: Date.now() + 30 * 86400_000 });
    }
    if (req.url.endsWith("/logout")) {
      active = false;
      return Response.json({ ok: true });
    }
    if (body.session_ref !== "browser-session-ref") return Response.json({ active: false });
    return Response.json({ active, subject: "kdp-owner", expires_at: Date.now() + 30 * 86400_000 });
  });
  const bindings = { ...env, AUTH: { fetch: central } as unknown as Fetcher } as Env;
  const call = (req: Request, override: Env = bindings) => worker.fetch(req, override);
  async function login(returnTo = "/") {
    const begin = await call(request(`/api/auth/login?return=${encodeURIComponent(returnTo)}`));
    expect(begin.status).toBe(302);
    const authorize = new URL(begin.headers.get("Location")!);
    const callback = await call(request(
      `/api/auth/callback?code=test-code&state=${authorize.searchParams.get("state")}`,
      { cookie: cookieOf(begin, "transaction") },
    ));
    expect(callback.status).toBe(303);
    return cookieOf(callback, "session");
  }
  return { bindings, call, login, revoke: () => { active = false; } };
}

describe("Project HTTP boundary", () => {
  let token: string;
  beforeEach(async () => {
    await resetDb();
    token = await seedProject();
    await worker.fetch(ingestRequest("codepi", token, samplePayload()), env);
  });

  it("requires SSO for private APIs and redirects unauthenticated pages to login", async () => {
    const sso = setup();
    for (const path of ["/api/overview", "/api/today", "/api/tasks", "/api/projects", "/api/log", "/api/projects/codepi"]) {
      expect((await sso.call(request(path))).status, path).toBe(401);
    }
    for (const path of ["/", "/board", "/log", "/p/codepi"]) {
      const page = await sso.call(request(path));
      expect(page.status, path).toBe(302);
      expect(page.headers.get("Location")).toBe(`${origin}/login?return=${encodeURIComponent(path)}`);
    }
  });
  it("requires SSO for today mutations", async () => {
    const sso = setup();
    for (const path of ["/api/today/pick", "/api/today/unpick", "/api/today/done", "/api/today/delete"]) {
      const response = await sso.call(request(path, { method: "POST", body: { project: "codepi", key: "task" } }));
      expect(response.status, path).toBe(401);
    }
  });


  it("rejects cross-origin browser mutations before authentication", async () => {
    const sso = setup();
    for (const [path, method] of [["/api/projects", "POST"], ["/api/projects/codepi/token", "POST"],
      ["/api/projects/codepi", "PATCH"], ["/api/today/pick", "POST"], ["/api/today/unpick", "POST"],
      ["/api/today/done", "POST"], ["/api/today/delete", "POST"]] as const) {
      const res = await sso.call(request(path, { method, body: { name: "x" }, origin: "https://evil.example" }));
      expect(res.status, path).toBe(403);
    }
  });

  it("does not accept a push token as a browser credential", async () => {
    const sso = setup();
    const res = await sso.call(new Request(`${origin}/api/overview`, { headers: { Authorization: `Bearer ${token}` } }));
    expect(res.status).toBe(401);
  });

  it("serves overview, board tasks, task detail, project card and log to the signed-in owner", async () => {
    const sso = setup();
    const cookie = await sso.login("/");
    const overview = await (await sso.call(request("/api/overview", { cookie }))).json() as {
      counts: Record<string, number>; need_you: { title: string }[]; projects: { id: string; open: number }[];
    };
    expect(overview.counts).toMatchObject({ open: 4, need_you: 2, branches: 1 });
    expect(overview.need_you.map(task => task.title)).toEqual(["选择示例方案", "续费示例服务器"]);
    expect(overview.projects).toMatchObject([{ id: "codepi", open: 4 }]);
    const board = await (await sso.call(request("/api/today", { cookie }))).json() as {
      today: { key: string }[]; pool: { key: string }[]; done: { key: string }[]; date: string;
    };
    expect(board.date).toMatch(/^2026-11-/);
    expect(board.today).toEqual([]);
    expect(board.pool).toHaveLength(4);
    const pick = await sso.call(request("/api/today/pick", { cookie, body: { project: "codepi", key: board.pool[0].key } }));
    expect(pick.status).toBe(200);
    const pickedBoard = await (await sso.call(request("/api/today", { cookie }))).json() as { today: { key: string }[] };
    expect(pickedBoard.today.map(task => task.key)).toContain(board.pool[0].key);
    expect((await sso.call(request("/api/today/unpick", { cookie, body: { project: "codepi", key: board.pool[0].key } }))).status).toBe(200);


    const tasks = await (await sso.call(request("/api/tasks?need=any", { cookie }))).json() as { tasks: { key: string }[] };
    expect(tasks.tasks).toHaveLength(2);
    const bugs = await (await sso.call(request("/api/tasks?status=bug", { cookie }))).json() as { tasks: unknown[] };
    expect(bugs.tasks).toHaveLength(1);
    expect((await sso.call(request("/api/tasks?status=done", { cookie }))).status).toBe(400);

    const detail = await (await sso.call(request(`/api/tasks/codepi/${tasks.tasks[1].key}`, { cookie }))).json() as {
      task: { what: string; related: string[] }; handoffs: unknown[];
    };
    expect(detail.task).toMatchObject({ what: "示例说明", related: ["docs/b.md"] });
    expect(detail.handoffs).toEqual([]);
    expect((await sso.call(request("/api/tasks/codepi/missing", { cookie }))).status).toBe(404);

    const card = await (await sso.call(request("/api/projects/codepi", { cookie }))).json() as Record<string, unknown>;
    expect(card).toMatchObject({
      project: { id: "codepi", repo: "kedoupi/codepi", adapter: { merge: "agent-team merge" } },
      counts: { need_you: 2, by_status: { decide: 1, doing: 1, bug: 1, idea: 1 } },
      branches: [{ name: "team/example", ahead: 3, has_fragment: true }],
      token: { created_at: expect.any(String) },
    });
    expect(JSON.stringify(card)).not.toContain(token);

    const log = await (await sso.call(request("/api/log?days=90", { cookie }))).json() as { items: { title: string }[] };
    expect(log.items.map(item => item.title)).toContain("示例变更 A");
  });

  it("creates projects with a one-time token and rotates it", async () => {
    const sso = setup();
    const cookie = await sso.login("/");
    const created = await sso.call(request("/api/projects", { cookie, body: { id: "mybrain", name: "MyBrain" } }));
    expect(created.status).toBe(201);
    const { token: first } = await created.json() as { token: string };
    expect(first).toMatch(/^cpw_[A-Za-z0-9_-]{43}$/);
    const stored = await env.DB.prepare("SELECT token_hash FROM ingest_tokens WHERE project_id='mybrain'").first<{ token_hash: string }>();
    expect(stored?.token_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(stored?.token_hash).not.toContain(first);

    expect((await sso.call(request("/api/projects", { cookie, body: { id: "mybrain", name: "again" } }))).status).toBe(409);
    expect((await sso.call(request("/api/projects", { cookie, body: { id: "Bad Id", name: "x" } }))).status).toBe(400);

    const rotated = await (await sso.call(request("/api/projects/mybrain/token", { cookie, method: "POST" }))).json() as { token: string };
    expect(rotated.token).not.toBe(first);
    expect((await worker.fetch(ingestRequest("mybrain", first, samplePayload()), env)).status).toBe(401);
    expect((await worker.fetch(ingestRequest("mybrain", rotated.token, samplePayload()), env)).status).toBe(200);
  });

  it("renames and archives projects; archived projects leave the board", async () => {
    const sso = setup();
    const cookie = await sso.login("/");
    const renamed = await sso.call(request("/api/projects/codepi", { cookie, method: "PATCH", body: { name: "CodePi 网站" } }));
    expect(await renamed.json()).toMatchObject({ project: { name: "CodePi 网站" } });
    expect((await sso.call(request("/api/projects/codepi", { cookie, method: "PATCH", body: { name: "a", status: "paused" } }))).status).toBe(400);
    await sso.call(request("/api/projects/codepi", { cookie, method: "PATCH", body: { status: "archived" } }));
    const tasks = await (await sso.call(request("/api/tasks", { cookie }))).json() as { tasks: unknown[] };
    expect(tasks.tasks).toHaveLength(0);
  });

  it("logs out through the shared SSO adapter", async () => {
    const sso = setup();
    const cookie = await sso.login("/");
    expect((await sso.call(request("/api/me", { cookie }))).status).toBe(200);
    sso.revoke();
    expect((await sso.call(request("/api/me", { cookie }))).status).toBe(401);
  });
});
