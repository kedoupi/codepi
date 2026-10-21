import { env } from "cloudflare:test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import worker from "../worker/index";
import { secretHash } from "../worker/lib";
import type { Env } from "../worker/types";

const origin = "https://gu.test";
const session = "routing-test-session";
const summaryToken = "synthetic-desk-summary-token-32-characters";
const sessionHeaders = { Cookie: `__Host-gu_session=${session}` };

function request(path: string, init: RequestInit = {}) {
  return new Request(origin + path, init);
}

function expectSecure(response: Response) {
  expect(response.headers.get("Cache-Control")).toBe("no-store");
  expect(response.headers.get("X-Content-Type-Options")).toBe("nosniff");
  expect(response.headers.get("X-Frame-Options")).toBe("DENY");
  expect(response.headers.get("Referrer-Policy")).toBe("no-referrer");
  expect(response.headers.get("X-Robots-Tag")).toBe("noindex, nofollow, noarchive");
  expect(response.headers.get("Content-Security-Policy")).toContain("style-src 'self'");
}

beforeEach(async () => {
  await env.DB.exec("DELETE FROM sessions; DELETE FROM otp_codes; DELETE FROM kdp_sso_transactions; DELETE FROM dashboard_current; DELETE FROM dashboard_batches;");
  await env.DB.prepare("INSERT INTO sessions (id, expires_at) VALUES (?, ?)")
    .bind(await secretHash(session, env.SESSION_SECRET!), Date.now() + 3600_000).run();
});
afterEach(() => vi.restoreAllMocks());

describe("transport and route precedence", () => {
  it.each(["/api/health", "/api/auth/login", "/api/sync", "/login", "/assets/app.js"])(
    "requires HTTPS before handling %s",
    async path => {
      const response = await worker.fetch(new Request(`http://remote.test${path}`), env);
      expect(response.status).toBe(403);
      expect(await response.json()).toEqual({ error: "需要 HTTPS" });
      expectSecure(response);
    },
  );

  it("only permits local HTTP in development or test", async () => {
    for (const environment of ["development", "test", "production", "staging"]) {
      const response = await worker.fetch(new Request("http://localhost/api/health"), {
        ...env, ENVIRONMENT: environment,
      });
      expect(response.status).toBe(["development", "test"].includes(environment) ? 200 : 403);
    }
  });

  it("gives the internal summary its own transport, method and token checks", async () => {
    const bindings: Env = { ...env, DESK_SUMMARY_TOKEN: summaryToken, ENVIRONMENT: "production" };
    const headers = { Authorization: `Bearer ${summaryToken}` };
    const response = await worker.fetch(new Request("http://localhost/api/internal/desk-summary", { headers }), bindings);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ source: "gu", status: "empty" });
    expectSecure(response);
    const insecure = await worker.fetch(new Request("http://remote.test/api/internal/desk-summary", { headers }), bindings);
    expect(insecure.status).toBe(403);
    expect(await insecure.json()).toEqual({ error: "https_required" });
    for (const method of ["HEAD", "POST", "OPTIONS"]) {
      const denied = await worker.fetch(request("/api/internal/desk-summary", { method, headers }), bindings);
      expect(denied.status).toBe(405);
      expectSecure(denied);
    }
    expect((await worker.fetch(request("/api/internal/desk-summary", { headers: sessionHeaders }), bindings)).status).toBe(401);
    expect((await worker.fetch(request("/api/internal/desk-summary", {
      headers: { Authorization: `Bearer ${env.UPLOAD_TOKEN}` },
    }), bindings)).status).toBe(401);
    expect((await worker.fetch(request("/api/internal/desk-summary"), env)).status).toBe(503);
  });

  it.each(["/api/sync", "/api/calendar/sync"])("keeps %s outside browser Origin and session checks", async path => {
    for (const source of [undefined, "https://other.test"]) {
      const headers = new Headers({ Authorization: `Bearer ${env.UPLOAD_TOKEN}`, "Content-Type": "application/json" });
      if (source) headers.set("Origin", source);
      const response = await worker.fetch(request(path, { method: "PUT", headers, body: "{" }), {
        ...env, INVESTMENT_CALENDAR_ID: "routing@test.invalid",
      });
      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({ error: "JSON 格式无效" });
      expectSecure(response);
    }
    const denied = await worker.fetch(request(path, { method: "PUT", headers: sessionHeaders }), env);
    expect(denied.status).toBe(401);
  });

  it.each(["POST", "PUT", "PATCH", "DELETE"])("checks Origin before routing other %s requests", async method => {
    for (const path of ["/api/auth/logout", "/api/unknown", "/login", "/missing"]) {
      for (const source of [undefined, "https://other.test"]) {
        const headers = new Headers(sessionHeaders);
        if (source) headers.set("Origin", source);
        const response = await worker.fetch(request(path, { method, headers }), env);
        expect(response.status).toBe(403);
        expect(await response.json()).toEqual({ error: "请求来源无效" });
        expectSecure(response);
      }
    }
    const unknown = await worker.fetch(request("/api/unknown", {
      method, headers: { Origin: origin, ...sessionHeaders },
    }), env);
    expect(unknown.status).toBe(404);
    expect(await unknown.json()).toEqual({ error: "接口不存在" });
  });
});

describe("exact API methods and paths", () => {
  it.each(["/api/health", "/api/auth/login", "/api/auth/callback", "/api/me", "/api/dashboard", "/api/calendar"])(
    "does not treat HEAD %s as GET",
    async path => {
      const bindings: Env = { ...env, SSO_ENABLED: "0" };
      for (const headers of [{}, sessionHeaders]) {
        const response = await worker.fetch(request(path, { method: "HEAD", headers }), bindings);
        expect(response.status).toBe("Cookie" in headers ? 404 : 401);
        expect(response.headers.get("Location")).toBeNull();
        expect(response.headers.get("Set-Cookie")).toBeNull();
        expectSecure(response);
      }
      expect(await env.DB.prepare("SELECT COUNT(*) AS n FROM kdp_sso_transactions").first("n")).toBe(0);
    },
  );

  it.each(["/api/health/", "/api/%68ealth", "/api/auth/%6Cogin", "/api/unknown", "/api/"])(
    "authenticates unmatched API path %s before returning 404",
    async path => {
      const denied = await worker.fetch(request(path), env);
      expect(denied.status).toBe(401);
      expect(await denied.json()).toEqual({ error: "请先登录", authenticated: false, authMode: "otp" });
      const missing = await worker.fetch(request(path, { headers: sessionHeaders }), env);
      expect(missing.status).toBe(404);
      expect(await missing.json()).toEqual({ error: "接口不存在" });
    },
  );

  it.each(["/api", "/API/health", "/%61pi/health"])("keeps %s outside the API namespace", async path => {
    const response = await worker.fetch(request(path), env);
    expect(response.status).toBe(404);
    expect(await response.text()).toBe("Not found");
    expectSecure(response);
  });

  it("does not authenticate public health or accept OPTIONS as a public GET", async () => {
    const response = await worker.fetch(request("/api/health?probe=1"), { ...env, SSO_ENABLED: "1" });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, sso_enabled: true });
    expectSecure(response);
    expect((await worker.fetch(request("/api/health", { method: "OPTIONS" }), env)).status).toBe(401);
    expect((await worker.fetch(request("/api/health", { method: "OPTIONS", headers: sessionHeaders }), env)).status).toBe(404);
  });
});

describe("page and asset gates", () => {
  function assets() {
    const fetch = vi.fn<Fetcher["fetch"]>().mockImplementation(async input => {
      const req = new Request(input);
      return new Response(req.method === "HEAD" ? null : "synthetic asset", {
        headers: { "Content-Type": "text/html", "Cache-Control": "public, max-age=3600" },
      });
    });
    const bindings: Env = {
      ...env,
      ASSETS: { fetch, connect() { throw new Error("Unexpected socket connection in asset test"); } },
    };
    return { fetch, bindings };
  }

  it.each(["GET", "HEAD"])("preserves %s page gates and forwards the original method to ASSETS", async method => {
    const { fetch, bindings } = assets();
    const denied = await worker.fetch(request("/", { method }), bindings);
    expect(denied.status).toBe(302);
    expect(denied.headers.get("Location")).toBe(origin + "/login");
    expectSecure(denied);
    expect(fetch).not.toHaveBeenCalled();
    for (const path of ["/login", "/"]) {
      const response = await worker.fetch(request(path, { method, headers: sessionHeaders }), bindings);
      expect(response.status).toBe(200);
      expectSecure(response);
      const forwarded = new Request(fetch.mock.calls.at(-1)![0]);
      expect(forwarded.url).toBe(origin + "/");
      expect(forwarded.method).toBe(method);
    }
  });

  it("serves only the existing public asset allowlist", async () => {
    const { fetch, bindings } = assets();
    for (const path of ["/assets/app.js", "/assets/app.css", "/assets/icon.svg", "/assets/font.woff2", "/favicon-16.png", "/favicon-32.png", "/favicon.ico", "/apple-touch-icon.png", "/brand/codepi-symbol.png", "/brand/codepi-symbol.webp"]) {
      const response = await worker.fetch(request(path), bindings);
      expect(response.status).toBe(200);
      expectSecure(response);
    }
    const count = fetch.mock.calls.length;
    for (const path of ["/assets/private.json", "/assets/nested/app.js", "/assets/%61pp.js", "/dashboard/account.json", "/login/", "/%6Cogin"]) {
      const response = await worker.fetch(request(path), bindings);
      expect(response.status).toBe(404);
    }
    expect(fetch).toHaveBeenCalledTimes(count);
    const robots = await worker.fetch(request("/robots.txt"), bindings);
    expect(await robots.text()).toBe("User-agent: *\nDisallow: /\n");
    expectSecure(robots);
    expect(fetch).toHaveBeenCalledTimes(count);
  });

  it("keeps asset failure and unsupported-method responses", async () => {
    expect((await worker.fetch(request("/login"), env)).status).toBe(503);
    expect((await worker.fetch(request("/", { headers: sessionHeaders }), env)).status).toBe(503);
    expect((await worker.fetch(request("/assets/app.js"), env)).status).toBe(404);
    for (const method of ["POST", "PUT", "PATCH", "DELETE", "OPTIONS"]) {
      const response = await worker.fetch(request("/login", { method, headers: { Origin: origin } }), env);
      expect(response.status).toBe(405);
      expect(await response.text()).toBe("Method not allowed");
      expectSecure(response);
    }
  });
});

describe("error envelope", () => {
  it("preserves JSON and validation errors on browser endpoints", async () => {
    for (const [contentType, body, error] of [
      ["application/json", "{", "JSON 格式无效"],
      ["text/plain", "{}", "需要 JSON 请求"],
    ]) {
      const response = await worker.fetch(request("/api/auth/verify-otp", {
        method: "POST", headers: { Origin: origin, "Content-Type": contentType }, body,
      }), env);
      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({ error });
      expectSecure(response);
    }
  });

  it("sanitizes infrastructure failures without default framework logging", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(env.DB, "prepare").mockImplementation(() => { throw new Error("synthetic private database failure"); });
    const response = await worker.fetch(request("/api/dashboard", { headers: sessionHeaders }), env);
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: "auth_unavailable" });
    expectSecure(response);
    expect(log).not.toHaveBeenCalled();
  });
});
