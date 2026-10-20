import { env } from "cloudflare:test";
import { expect, it, vi } from "vitest";
import worker from "../worker/index";
import type { Env } from "../worker/types";
import { call, data } from "./helpers";
import { reviewMemory, reviewTimeline } from "../worker/data";

const origin = "https://me.test";
type HttpOptions = { cookie?: string; method?: string; source?: string; body?: unknown };

function request(path: string, options: HttpOptions = {}) {
  const headers = new Headers({ Origin: options.source ?? origin });
  if (options.cookie) headers.set("Cookie", options.cookie);
  if (options.body !== undefined) headers.set("Content-Type", "application/json");
  return new Request(origin + path, {
    method: options.method ?? "GET",
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
}

function cookieOf(response: Response, kind: string) {
  return response.headers.get("Set-Cookie")
    ?.match(new RegExp(`(__Host-kdp_me_${kind}=[^;,]+)`))?.[1] ?? "";
}

function setupSso() {
  const central = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const req = new Request(input, init);
    expect(req.headers.get("Authorization")).toBe(`Basic ${btoa("me:test-sso-secret")}`);
    const body = await req.json() as Record<string, unknown>;
    if (req.url.endsWith("/exchange")) {
      expect(body.redirect_uri).toBe(`${origin}/api/auth/callback`);
      return Response.json({
        subject: "kdp-owner",
        session_ref: "synthetic-owner-session",
        expires_at: Date.now() + 7 * 86400_000,
      });
    }
    if (req.url.endsWith("/session")) {
      if (body.session_ref !== "synthetic-owner-session") return Response.json({ active: false });
      return Response.json({
        active: true,
        subject: "kdp-owner",
        expires_at: Date.now() + 7 * 86400_000,
      });
    }
    return Response.json({ ok: true });
  });
  const bindings: Env = {
    ...env,
    SSO_ENABLED: "1",
    AUTH_CLIENT_ID: "me",
    AUTH_CLIENT_SECRET: "test-sso-secret",
    AUTH_ORIGIN: "https://auth.codepi.app",
    AUTH: { fetch: central } as unknown as Fetcher,
  };
  const send = (path: string, options: HttpOptions = {}) => worker.fetch(request(path, options), bindings);
  async function login() {
    const started = await send("/api/auth/login?return=%2F");
    expect(started.status).toBe(302);
    const authorize = new URL(started.headers.get("Location")!);
    expect(authorize.searchParams.get("client_id")).toBe("me");
    const callback = await send(`/api/auth/callback?code=synthetic&state=${authorize.searchParams.get("state")}`, {
      cookie: cookieOf(started, "transaction"),
    });
    expect(callback.status).toBe(303);
    return cookieOf(callback, "session");
  }
  return { send, login, central, bindings };
}

it("requires verified paired SSO credentials for public readiness", async () => {
  const sso = setupSso();
  const ready = await sso.send("/api/health");
  expect(ready.status).toBe(200);
  expect(await ready.json()).toMatchObject({ source: "me", ok: true, sso_enabled: true, sso_ready: true });
  expect(sso.central).toHaveBeenCalledTimes(1);
  const rejected = await worker.fetch(request("/api/health"), {
    ...sso.bindings,
    AUTH: { fetch: vi.fn(async () => Response.json({ error: "unauthorized" }, { status: 401 })) },
  } as unknown as Env);
  expect(rejected.status).toBe(503);
  expect(await rejected.json()).toMatchObject({ ok: false, sso_enabled: true, sso_ready: false });
  expect((await worker.fetch(request("/api/health"), { ...sso.bindings, SSO_ENABLED: "0" })).status).toBe(503);
});

it("archives only active owner data via same-origin POST and hides it from AI search immediately", async () => {
  const memory = data(await call("memory.save", { kind: "note", text: "可归档记忆", tags: ["归档"] }));
  await reviewMemory(env, String(memory.id), "approve");
  const timeline = data(await call("entry.propose", {
    type: "timeline", kind: "project", title: "可归档经历", started_on: "2024",
  }));
  expect(await reviewTimeline(env, String(timeline.id), "approve")).toBe(true);
  expect(data(await call("memory.search", { query: "归档" })).items).toHaveLength(1);
  expect(data(await call("timeline.search", { query: "归档" })).items).toHaveLength(1);

  const sso = setupSso(), cookie = await sso.login();
  const memoryPath = `/api/memories/${memory.id}/archive`;
  const timelinePath = `/api/timeline/${timeline.id}/archive`;
  expect((await sso.send(memoryPath, { method: "POST", body: {} })).status).toBe(401);
  expect((await sso.send(memoryPath, {
    method: "POST", cookie, source: "https://evil.example", body: {},
  })).status).toBe(403);
  expect((await sso.send(timelinePath, { method: "POST", body: {} })).status).toBe(401);
  expect((await sso.send(timelinePath, {
    method: "POST", cookie, source: "https://evil.example", body: {},
  })).status).toBe(403);
  expect(data(await call("memory.search", { query: "归档" })).items).toHaveLength(1);
  expect(data(await call("timeline.search", { query: "归档" })).items).toHaveLength(1);

  const archivedMemory = await sso.send(memoryPath, { method: "POST", cookie, body: {} });
  expect(archivedMemory.status).toBe(200);
  expect(await archivedMemory.json()).toMatchObject({ id: memory.id, status: "archived" });
  const archivedTimeline = await sso.send(timelinePath, { method: "POST", cookie, body: {} });
  expect(archivedTimeline.status).toBe(200);
  expect(data(await call("memory.search", { query: "归档" })).items).toEqual([]);
  expect(data(await call("timeline.search", { query: "归档" })).items).toEqual([]);
  expect((await sso.send("/api/overview", { cookie })).status).toBe(200);
  expect((await sso.send(memoryPath, { method: "POST", cookie, body: {} })).status).toBe(409);
  expect((await sso.send(timelinePath, { method: "POST", cookie, body: {} })).status).toBe(409);
});
