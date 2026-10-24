import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it, vi } from "vitest";
import worker from "../worker/index";
import { resetDb, seedProject } from "./helpers";
import type { Env } from "../worker/types";

const origin = "https://project.codepi.app";
const authClientId = (env as Env).AUTH_CLIENT_ID || "gu";

function request(
  path: string,
  options: {
    method?: string;
    body?: unknown;
    cookie?: string;
    origin?: string;
  } = {},
) {
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
    expect(req.headers.get("Authorization")).toBe(
      `Basic ${btoa(`${authClientId}:test-project-sso-secret-not-for-production`)}`,
    );
    const body = await req.json() as Record<string, string>;
    if (req.url.endsWith("/exchange")) {
      expect(body.redirect_uri).toBe(`${origin}/api/auth/callback`);
      return Response.json({
        subject: "kdp-owner",
        session_ref: "browser-session-ref",
        expires_at: Date.now() + 30 * 86400_000,
      });
    }
    if (req.url.endsWith("/logout")) {
      active = false;
      return Response.json({ ok: true });
    }
    if (body.session_ref !== "browser-session-ref") return Response.json({ active: false });
    return Response.json({ active, subject: "kdp-owner", expires_at: Date.now() + 30 * 86400_000 });
  });
  const bindings = {
    ...env,
    AUTH: { fetch: central } as unknown as Fetcher,
  } as Env;
  const call = (req: Request, override: Env = bindings) => worker.fetch(req, override);
  async function login(returnTo = "/") {
    const begin = await call(request(`/api/auth/login?return=${encodeURIComponent(returnTo)}`));
    expect(begin.status).toBe(302);
    const authorize = new URL(begin.headers.get("Location")!);
    const transaction = cookieOf(begin, "transaction");
    const callback = await call(request(
      `/api/auth/callback?code=test-code&state=${authorize.searchParams.get("state")}`,
      { cookie: transaction },
    ));
    expect(callback.status).toBe(303);
    expect(callback.headers.get("Location")).toBe(returnTo);
    return cookieOf(callback, "session");
  }
  return { bindings, call, central, login, revoke: () => { active = false; } };
}

describe("Project HTTP boundary", () => {
  beforeEach(async () => {
    await resetDb();
    await seedProject();
  });

  it("requires verified paired SSO credentials for public readiness", async () => {
    const sso = setup();
    const ready = await sso.call(request("/api/health"));
    expect(ready.status).toBe(200);
    expect(await ready.json()).toMatchObject({ ok: true, sso_enabled: true, sso_ready: true });
    expect(sso.central).toHaveBeenCalledTimes(1);
    const rejected = await sso.call(request("/api/health"), {
      ...sso.bindings,
      AUTH: { fetch: vi.fn(async () => Response.json({ error: "unauthorized" }, { status: 401 })) },
    } as unknown as Env);
    expect(rejected.status).toBe(503);
    expect(await rejected.json()).toMatchObject({ ok: false, sso_enabled: true, sso_ready: false });
    expect((await sso.call(request("/api/health"), { ...sso.bindings, SSO_ENABLED: "0" })).status).toBe(503);
  });

  it("requires SSO for private APIs and redirects unauthenticated HTML to login", async () => {
    const sso = setup();
    expect((await sso.call(request("/api/projects"))).status).toBe(401);
    const page = await sso.call(request("/p/kedoupi-codepi"));
    expect(page.status).toBe(302);
    expect(page.headers.get("Location")).toBe(
      `${origin}/login?return=%2Fp%2Fkedoupi-codepi`,
    );
  });

  it("rejects cross-origin mutations before authentication", async () => {
    const sso = setup();
    const result = await sso.call(request("/api/projects/kedoupi-codepi", {
      method: "PATCH",
      body: { name: "x" },
      origin: "https://evil.example",
    }));
    expect(result.status).toBe(403);
  });

  it("logs in through the shared SSO adapter and revokes the session centrally", async () => {
    const sso = setup();
    const cookie = await sso.login("/p/kedoupi-codepi");
    expect(cookie).toContain(`__Host-kdp_${authClientId}_session=`);
    expect((await sso.call(request("/api/me", { cookie }))).status).toBe(200);
    const projects = await sso.call(request("/api/projects", { cookie }));
    expect(projects.status).toBe(200);
    expect((await projects.json() as { projects: unknown[] }).projects).toHaveLength(1);
    sso.revoke();
    expect((await sso.call(request("/api/me", { cookie }))).status).toBe(401);
  });

  it("edits/reset card fields and appends a web handoff with same-origin protection", async () => {
    const sso = setup();
    const cookie = await sso.login();
    const edit = await sso.call(request("/api/projects/kedoupi-codepi/card", {
      method: "PATCH",
      cookie,
      body: { field: "goal", value: "Owner-edited goal" },
    }));
    expect(edit.status).toBe(200);
    let card = await sso.call(request("/api/projects/kedoupi-codepi", { cookie }));
    expect((await card.json() as { goal: { value: string } }).goal.value).toBe("Owner-edited goal");
    expect((await sso.call(request("/api/projects/kedoupi-codepi/card", {
      method: "PATCH",
      cookie,
      origin: "https://evil.example",
      body: { field: "goal", value: "bad" },
    }))).status).toBe(403);
    expect((await sso.call(request("/api/projects/kedoupi-codepi/card", {
      method: "PATCH",
      cookie,
      body: { field: "goal", value: null },
    }))).status).toBe(200);
    card = await sso.call(request("/api/projects/kedoupi-codepi", { cookie }));
    expect((await card.json() as { goal: { source: string } }).goal.source).toBe("none");

    const handoff = await sso.call(request("/api/projects/kedoupi-codepi/handoffs", {
      method: "POST",
      cookie,
      body: {
        task_id: "task-web",
        status: "blocked",
        summary: "Rendered <script>alert(1)</script> as text.",
        next: "Review the generated DOM.",
        branch: "codex/task-web",
        base_sha: "abbafdfe2d04966d66dad2f4f0084075f040caaf",
        files: ["apps/project/web/src/App.svelte"],
        request_id: "web-request-1",
      },
    }));
    expect(handoff.status).toBe(201);
    const history = await sso.call(request(
      "/api/projects/kedoupi-codepi/handoffs?limit=20",
      { cookie },
    ));
    const body = await history.json() as { handoffs: { summary: string }[] };
    expect(body.handoffs[0].summary).toContain("<script>");
  });

  it("keeps the edited base at the interleaved sync SHA", async () => {
    await env.DB.prepare(`INSERT INTO card_fields
      (project_id,field,auto_value,auto_sha) VALUES (?,?,?,?)`)
      .bind("kedoupi-codepi", "goal", "Automatic goal", "old-sha").run();
    const sso = setup();
    const cookie = await sso.login();
    const originalPrepare = env.DB.prepare.bind(env.DB);
    const prepareSpy = vi.spyOn(env.DB, "prepare");
    prepareSpy.mockImplementation(((query: string) => {
      const statement = originalPrepare(query);
      const interleave = async () => {
        await originalPrepare(
          "UPDATE card_fields SET auto_sha=? WHERE project_id=? AND field=?",
        ).bind("new-sha", "kedoupi-codepi", "goal").run();
      };
      if (query.includes("SELECT auto_sha") && !query.includes("edited_base_sha")) {
        return new Proxy(statement, {
          get(target, property, receiver) {
            if (property !== "bind") return Reflect.get(target, property, receiver);
            return (...args: unknown[]) => {
              const bound = target.bind(...args);
              return new Proxy(bound, {
                get(boundTarget, boundProperty, boundReceiver) {
                  if (boundProperty !== "first") {
                    return Reflect.get(boundTarget, boundProperty, boundReceiver);
                  }
                  return async () => {
                    const row = await boundTarget.first();
                    await interleave();
                    return row;
                  };
                },
              });
            };
          },
        });
      }
      if (query.includes("edited_base_sha")) {
        return new Proxy(statement, {
          get(target, property, receiver) {
            if (property !== "bind") return Reflect.get(target, property, receiver);
            return (...args: unknown[]) => {
              const bound = target.bind(...args);
              return new Proxy(bound, {
                get(boundTarget, boundProperty, boundReceiver) {
                  if (boundProperty !== "run") {
                    return Reflect.get(boundTarget, boundProperty, boundReceiver);
                  }
                  return async () => {
                    await interleave();
                    return boundTarget.run();
                  };
                },
              });
            };
          },
        });
      }
      return statement;
    }) as typeof env.DB.prepare);
    try {
      const response = await sso.call(request("/api/projects/kedoupi-codepi/card", {
        method: "PATCH",
        cookie,
        body: { field: "goal", value: "Owner-edited goal" },
      }));
      expect(response.status).toBe(200);
      const selectAutoShaQueries = prepareSpy.mock.calls.filter(([sql]) =>
        sql.trimStart().startsWith("SELECT auto_sha"),
      );
      const row = await originalPrepare(
        "SELECT auto_sha,edited_base_sha FROM card_fields WHERE project_id=? AND field=?",
      ).bind("kedoupi-codepi", "goal").first<{ auto_sha: string; edited_base_sha: string }>();
      expect(row).toEqual({ auto_sha: "new-sha", edited_base_sha: "new-sha" });
      expect(selectAutoShaQueries).toHaveLength(0);
    } finally {
      prepareSpy.mockRestore();
    }
  });

  it("limits manual sync to once per 60 seconds and records provider failure codes", async () => {
    const sso = setup();
    const cookie = await sso.login();
    const responses = await Promise.all([
      sso.call(request("/api/projects/kedoupi-codepi/sync", {
        method: "POST",
        cookie,
      })),
      sso.call(request("/api/projects/kedoupi-codepi/sync", {
        method: "POST",
        cookie,
      })),
    ]);
    expect(responses.map(response => response.status).sort()).toEqual([200, 429]);
    const succeeded = responses.find(response => response.status === 200)!;
    expect((await succeeded.json() as { errors: Record<string, string> }).errors.commits)
      .toBe("github_unavailable");
    const limited = responses.find(response => response.status === 429)!;
    const limitedBody = await limited.json() as { error: string; retry_after: number };
    expect(limitedBody.error).toBe("sync_too_frequent");
    expect(limitedBody.retry_after).toBeGreaterThan(0);
    expect(limited.headers.get("Retry-After")).toBe(String(limitedBody.retry_after));
    const third = await sso.call(request("/api/projects/kedoupi-codepi/sync", {
      method: "POST",
      cookie,
    }));
    expect(third.status).toBe(429);
  });

  it("does not sync a project removed from PROJECT_REPOS", async () => {
    const sso = setup();
    const cookie = await sso.login();
    const removed = { ...sso.bindings, PROJECT_REPOS: "" } as Env;
    const result = await sso.call(request("/api/projects/kedoupi-codepi/sync", {
      method: "POST",
      cookie,
    }), removed);
    expect(result.status).toBe(409);
    expect(await result.json()).toMatchObject({ error: "project_not_syncable" });
  });

  it("fails closed when unified login is disabled", async () => {
    const sso = setup();
    const disabled = { ...sso.bindings, SSO_ENABLED: "0" } as Env;
    expect((await sso.call(request("/api/auth/login"), disabled)).status).toBe(503);
    expect((await sso.call(request("/api/projects"), disabled)).status).toBe(401);
  });
});
