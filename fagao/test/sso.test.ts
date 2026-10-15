import { createExecutionContext, env } from "cloudflare:test";
import { describe, expect, it, vi } from "vitest";
import worker from "../worker/index";
import { hashSecret } from "../worker/crypto";

const origin = "https://fagao.kdp.cool";
function setup() {
  let active = true;
  let unavailable = false;
  let subject = "kdp-owner";
  let expiresAt = Date.now() + 30 * 86400_000;
  const central = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const req = new Request(input, init);
    expect(req.headers.get("Authorization")).toBe(`Basic ${btoa("fagao:test-sso-secret")}`);
    if (unavailable) return new Response("unavailable", { status: 503 });
    const body = await req.json() as Record<string, string>;
    if (req.url.endsWith("/exchange")) {
      expect(body.redirect_uri).toBe(origin + "/api/auth/callback");
      expect(body.code_verifier).toMatch(/^[A-Za-z0-9_-]{43}$/);
      return Response.json({ subject, session_ref: "central-browser", expires_at: expiresAt });
    }
    expect(body.session_ref).toBe("central-browser");
    if (req.url.endsWith("/logout")) { active = false; return Response.json({ ok: true }); }
    expect(req.url).toBe("https://auth.internal/internal/session");
    return Response.json({ active, subject, expires_at: expiresAt });
  });
  const bindings: Env = {
    ...env, SSO_ENABLED: "1", AUTH_CLIENT_ID: "fagao", AUTH_CLIENT_SECRET: "test-sso-secret",
    AUTH_ORIGIN: "https://auth.kdp.cool", AUTH: { fetch: central } as unknown as Fetcher,
  };
  const call = (path: string, cookie = "", method = "GET", source = origin, customEnv = bindings) =>
    worker.fetch(new Request(origin + path, { method, headers: { Cookie: cookie, Origin: source } }), customEnv, createExecutionContext());
  function cookieOf(response: Response, kind: string) {
    return response.headers.get("Set-Cookie")?.match(new RegExp(`(__Host-kdp_fagao_${kind}=[^;,]+)`))?.[1] || "";
  }
  async function begin() {
    const response = await call("/api/auth/login?return=%2Fp%2Fkdp-0917-zao%2F");
    expect(response.status).toBe(302);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    const authorize = new URL(response.headers.get("Location")!);
    expect(authorize.origin).toBe("https://auth.kdp.cool");
    expect(authorize.searchParams.get("client_id")).toBe("fagao");
    return {
      path: `/api/auth/callback?code=test-code&state=${authorize.searchParams.get("state")}`,
      cookie: cookieOf(response, "transaction"),
    };
  }
  async function login() {
    const tx = await begin();
    const response = await call(tx.path, tx.cookie);
    expect(response.status).toBe(303);
    expect(response.headers.get("Location")).toBe("/p/kdp-0917-zao/");
    return { response, cookie: cookieOf(response, "session"), tx };
  }
  return {
    bindings, call, central, begin, login,
    revoke: () => { active = false; }, outage: () => { unavailable = true; },
    subject: (value: string) => { subject = value; },
    expires: (value: number) => { expiresAt = value; },
  };
}

describe("fagao SSO adapter", () => {
  it("maps the fixed owner to existing account data and a seven-day session", async () => {
    const sso = setup();
    const before = await env.DB.prepare("SELECT COUNT(*) AS n FROM posts WHERE account_id = 'acc_owner_kdp'").first("n");
    const { response, cookie, tx } = await sso.login();
    expect(response.headers.get("Set-Cookie")).toContain("Max-Age=604800");
    expect(response.headers.get("Set-Cookie")).toContain("HttpOnly");
    expect(response.headers.get("Set-Cookie")).toContain("Secure");
    expect(response.headers.get("Set-Cookie")).not.toContain("Domain=");
    const me = await sso.call("/api/me", cookie);
    expect(me.status).toBe(200);
    expect(await me.json()).toMatchObject({ account: { email: "kedoupi@gmail.com", role: "owner" } });
    expect((await sso.call("/api/board?date=2026-09-17", cookie)).status).toBe(200);
    expect(await env.DB.prepare("SELECT COUNT(*) AS n FROM accounts").first("n")).toBe(1);
    expect(await env.DB.prepare("SELECT COUNT(*) AS n FROM posts WHERE account_id = 'acc_owner_kdp'").first("n")).toBe(before);
    const row = await env.DB.prepare("SELECT * FROM kdp_sso_sessions").first<Record<string, unknown>>();
    expect(row).toMatchObject({ user_id: "acc_owner_kdp", subject: "kdp-owner" });
    expect(row!.id).not.toBe(cookie.split("=")[1]);
    expect(row!.central_ref).not.toBe("central-browser");
    expect(Number(row!.expires_at) - Number(row!.created_at)).toBe(7 * 86400_000);
    const replay = await sso.call(tx.path, tx.cookie);
    expect(replay.status).toBe(302);
    expect(replay.headers.get("Location")).toBe(origin + "/login?auth_error=retry");
  });

  it.each(["active = 0", "role = 'editor'"])("refuses callback for an owner with %s", async change => {
    const sso = setup();
    await env.DB.prepare(`UPDATE accounts SET ${change} WHERE id = 'acc_owner_kdp'`).run();
    const tx = await sso.begin();
    const failed = await sso.call(tx.path, tx.cookie);
    expect(failed.status).toBe(302);
    expect(failed.headers.get("Location")).toBe(origin + "/login?auth_error=retry");
    expect(sso.central).not.toHaveBeenCalled();
    expect(await env.DB.prepare("SELECT COUNT(*) AS n FROM kdp_sso_sessions").first("n")).toBe(0);
  });

  it.each(["active = 0", "role = 'reviewer'"])("rechecks the existing owner after login when %s", async change => {
    const sso = setup();
    const { cookie } = await sso.login();
    await env.DB.prepare(`UPDATE accounts SET ${change} WHERE id = 'acc_owner_kdp'`).run();
    expect((await sso.call("/api/me", cookie)).status).toBe(401);
    expect((await sso.call("/previews/kdp-0917-zao/", cookie)).status).toBe(302);
  });

  it("rejects non-owner central subjects without creating accounts", async () => {
    const sso = setup();
    sso.subject("reviewer");
    const tx = await sso.begin();
    expect((await sso.call(tx.path, tx.cookie)).status).toBe(302);
    expect(await env.DB.prepare("SELECT COUNT(*) AS n FROM accounts").first("n")).toBe(1);
  });

  it("disables OTP and legacy sessions without mutating the legacy tables", async () => {
    const sso = setup();
    await env.DB.prepare("INSERT INTO sessions (id, account_id, expires_at) VALUES (?, 'acc_owner_kdp', ?)")
      .bind(await hashSecret("legacy", env.SESSION_SECRET), new Date(Date.now() + 3600_000).toISOString()).run();
    expect((await sso.call("/api/me", "fagao_session=legacy")).status).toBe(401);
    for (const path of ["request-otp", "verify-otp"]) {
      expect((await sso.call(`/api/auth/${path}`, "", "POST")).status).toBe(404);
    }
    expect(await env.DB.prepare("SELECT COUNT(*) AS n FROM sessions").first("n")).toBe(1);
    expect(await env.DB.prepare("SELECT COUNT(*) AS n FROM otp_codes").first("n")).toBe(0);
  });

  it("caps local expiry at the central expiry and rejects expired local sessions", async () => {
    const sso = setup();
    const expiry = Date.now() + 3600_000;
    sso.expires(expiry);
    const { cookie } = await sso.login();
    expect(await env.DB.prepare("SELECT expires_at FROM kdp_sso_sessions").first("expires_at")).toBe(expiry);
    await env.DB.prepare("UPDATE kdp_sso_sessions SET expires_at = 0").run();
    expect((await sso.call("/api/me", cookie)).status).toBe(401);
    sso.expires(Date.now() + 30 * 86400_000);
    const renewed = await sso.login();
    expect((await sso.call("/api/me", renewed.cookie)).status).toBe(200);
    expect(renewed.cookie).not.toBe(cookie);
  });

  it("observes central revocation on both APIs and private HTML", async () => {
    const sso = setup();
    const { cookie } = await sso.login();
    sso.revoke();
    expect((await sso.call("/api/me", cookie)).status).toBe(401);
    expect((await sso.call("/previews/kdp-0917-zao/", cookie)).status).toBe(302);
  });

  it("injects an external session guard into standalone previews without changing copy or CSP", async () => {
    const sso = setup();
    const { cookie } = await sso.login();
    const article = "<article><h1>Private draft</h1><p>Original preview content.</p></article>";
    const csp = "default-src 'self'; script-src 'self'; style-src 'self'";
    const bindings = {
      ...sso.bindings,
      ASSETS: { fetch: vi.fn(async () => new Response(
        `<!doctype html><html><head><title>Preview</title></head><body>${article}</body></html>`,
        { headers: { "Content-Type": "text/html; charset=utf-8", "Content-Security-Policy": csp } },
      )) } as unknown as Fetcher,
    };
    const response = await sso.call("/previews/private-draft/?edition=2", cookie, "GET", origin, bindings);
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(response.headers.get("Content-Security-Policy")).toBe(csp);
    const html = await response.text();
    expect(html).toContain(article);
    expect(html).toContain('<script src="/assets/preview-session.js" defer></script></head>');

    sso.revoke();
    const revoked = await sso.call("/previews/private-draft/", cookie, "GET", origin, bindings);
    expect(revoked.status).toBe(302);
    expect(bindings.ASSETS.fetch).toHaveBeenCalledOnce();
  });

  it.each([
    ["/previews/article.css", "text/css", 200],
    ["/", "text/html", 200],
    ["/previews/missing/", "text/html", 404],
  ] as const)("does not inject the preview guard into %s (%s, %i)", async (path, contentType, status) => {
    const sso = setup();
    const { cookie } = await sso.login();
    const body = "<html><head></head><body>Original response</body></html>";
    const bindings = {
      ...sso.bindings,
      ASSETS: { fetch: async () => new Response(body, { status, headers: { "Content-Type": contentType } }) } as unknown as Fetcher,
    };
    const response = await sso.call(path, cookie, "GET", origin, bindings);
    expect(await response.text()).toBe(body);
  });

  it("serves the external guard without requiring a session", async () => {
    const sso = setup();
    const bindings = {
      ...sso.bindings,
      ASSETS: { fetch: async () => new Response("/* session guard */", {
        headers: { "Content-Type": "application/javascript" },
      }) } as unknown as Fetcher,
    };
    const response = await sso.call("/assets/preview-session.js", "", "GET", origin, bindings);
    expect(response.status).toBe(200);
    expect(await response.text()).toBe("/* session guard */");
    expect(sso.central).not.toHaveBeenCalled();
  });

  it("reports AUTH outages as 503 and retains sessions for retry", async () => {
    const sso = setup();
    const { cookie } = await sso.login();
    sso.outage();
    expect((await sso.call("/api/me", cookie)).status).toBe(503);
    expect((await sso.call("/", cookie)).status).toBe(503);
    expect((await sso.call("/api/auth/logout", cookie, "POST")).status).toBe(503);
    expect(await env.DB.prepare("SELECT COUNT(*) AS n FROM kdp_sso_sessions").first("n")).toBe(1);
    expect((await sso.call("/api/auth/login", "", "GET", origin, { ...sso.bindings, AUTH: undefined })).status).toBe(503);
    const tx = await sso.begin();
    const failed = await sso.call(tx.path, tx.cookie);
    expect(failed.status).toBe(302);
    expect(failed.headers.get("Location")).toBe(origin + "/login?auth_error=unavailable");
  });

  it("requires same-origin POST for global logout and invalidates other refs", async () => {
    const sso = setup();
    const { cookie } = await sso.login();
    const other = await sso.login();
    expect((await sso.call("/api/auth/logout", cookie, "POST", "https://evil.example")).status).toBe(403);
    expect((await sso.call("/api/auth/logout", cookie, "GET")).status).not.toBe(200);
    const result = await sso.call("/api/auth/logout", cookie, "POST");
    expect(result.status).toBe(200);
    expect(result.headers.get("Set-Cookie")).toContain("__Host-kdp_fagao_session=;");
    expect(result.headers.get("Set-Cookie")).toContain("Max-Age=0");
    expect((await sso.call("/api/me", other.cookie)).status).toBe(401);
  });

  it("accepts the logout-only cookie for revocation without accepting it for authentication", async () => {
    const sso = setup();
    const { response, cookie } = await sso.login();
    const logoutCookie = response.headers.get("Set-Cookie")?.match(/(__Host-kdp_fagao_logout=[^;,]+)/)?.[1];
    expect(logoutCookie).toBeTruthy();
    expect((await sso.call("/api/me", logoutCookie)).status).toBe(401);
    expect((await sso.call("/api/me", cookie)).status).toBe(200);

    await env.DB.prepare("UPDATE kdp_sso_sessions SET expires_at = 0").run();
    const result = await sso.call("/api/auth/logout", logoutCookie, "POST");
    expect(result.status).toBe(200);
    expect(result.headers.get("Set-Cookie")).toContain("__Host-kdp_fagao_logout=;");
    expect(result.headers.get("Set-Cookie")).toContain("Max-Age=0");
    expect(sso.central).toHaveBeenCalledWith("https://auth.internal/internal/logout", expect.anything());
  });

  it("keeps SSO gated off for the compatibility rollout", async () => {
    const sso = setup();
    const disabled = { ...sso.bindings, SSO_ENABLED: "0" };
    const response = await sso.call("/api/auth/login", "", "GET", origin, disabled);
    expect(response.status).toBe(302);
    expect(response.headers.get("Location")).toBe(origin + "/login");
    expect((await sso.call("/api/auth/callback", "", "GET", origin, disabled)).status).toBe(404);
    expect(await (await sso.call("/api/health", "", "GET", origin, disabled)).json()).toMatchObject({ sso_enabled: false });
  });
});
