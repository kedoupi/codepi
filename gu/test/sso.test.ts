import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it, vi } from "vitest";
import worker from "../worker/index";
import { secretHash } from "../worker/lib";
import type { Env } from "../worker/types";

const origin = "https://codepi-gu.pages.dev";
const sevenDays = 7 * 86400;
function request(path: string, cookie = "", method = "GET", source = origin) {
  return new Request(origin + path, { method, headers: { Cookie: cookie, Origin: source } });
}
function cookieOf(response: Response, kind: string) {
  return response.headers.get("Set-Cookie")?.match(new RegExp(`(__Host-kdp_gu_${kind}=[^;,]+)`))?.[1] || "";
}
function setup() {
  let active = true;
  let unavailable = false;
  let subject = "kdp-owner";
  let expiresAt = Date.now() + 30 * 86400_000;
  const central = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const req = new Request(input, init);
    expect(req.headers.get("Authorization")).toBe(`Basic ${btoa("gu:test-sso-secret")}`);
    if (unavailable) throw new Error("upstream failed");
    const body = await req.json() as Record<string, string>;
    if (req.url.endsWith("/exchange")) {
      expect(body.redirect_uri).toBe(`${origin}/api/auth/callback`);
      expect(body.code_verifier).toMatch(/^[A-Za-z0-9_-]{43}$/);
      return Response.json({ subject, session_ref: "browser-session-ref", expires_at: expiresAt });
    }
    expect(body.session_ref).toBe("browser-session-ref");
    if (req.url.endsWith("/logout")) { active = false; return Response.json({ ok: true }); }
    expect(req.url).toBe("https://auth.internal/internal/session");
    return Response.json({ active, subject, expires_at: expiresAt });
  });
  const bindings: Env = {
    ...env, SSO_ENABLED: "1", AUTH_CLIENT_ID: "gu", AUTH_CLIENT_SECRET: "test-sso-secret",
    AUTH_ORIGIN: "https://auth.codepi.app", AUTH: { fetch: central } as unknown as Fetcher,
  };
  const call = (path: string, cookie = "", method = "GET", source = origin) =>
    worker.fetch(request(path, cookie, method, source), bindings);
  async function begin() {
    const response = await call("/api/auth/login?return=%2F%23reports");
    expect(response.status).toBe(302);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    const authorize = new URL(response.headers.get("Location")!);
    expect(authorize.origin).toBe("https://auth.codepi.app");
    expect(authorize.searchParams.get("client_id")).toBe("gu");
    expect(authorize.searchParams.get("code_challenge_method")).toBe("S256");
    return {
      path: `/api/auth/callback?code=test-code&state=${authorize.searchParams.get("state")}`,
      transaction: cookieOf(response, "transaction"),
    };
  }
  async function login() {
    const tx = await begin();
    const response = await call(tx.path, tx.transaction);
    expect(response.status).toBe(303);
    expect(response.headers.get("Location")).toBe("/#reports");
    return { response, cookie: cookieOf(response, "session"), tx };
  }
  return {
    call, bindings, central, begin, login,
    revoke: () => { active = false; }, outage: () => { unavailable = true; },
    subject: (value: string) => { subject = value; },
    expires: (value: number) => { expiresAt = value; },
  };
}

beforeEach(async () => {
  await env.DB.exec("DELETE FROM kdp_sso_sessions; DELETE FROM kdp_sso_transactions; DELETE FROM sessions; DELETE FROM otp_codes;");
});

describe("GU SSO adapter", () => {
  it("maps only the central owner to gu-owner with a seven-day local session", async () => {
    const sso = setup();
    const { response, cookie, tx } = await sso.login();
    expect(response.headers.get("Set-Cookie")).toContain(`Max-Age=${sevenDays}`);
    expect(response.headers.get("Set-Cookie")).toContain("HttpOnly");
    expect(response.headers.get("Set-Cookie")).toContain("Secure");
    expect(response.headers.get("Set-Cookie")).not.toContain("Domain=");
    const row = await env.DB.prepare("SELECT * FROM kdp_sso_sessions").first<Record<string, unknown>>();
    expect(row).toMatchObject({ user_id: "gu-owner", subject: "kdp-owner" });
    expect(row!.id).not.toBe(cookie.split("=")[1]);
    expect(row!.central_ref).not.toBe("browser-session-ref");
    expect(Number(row!.expires_at) - Number(row!.created_at)).toBe(sevenDays * 1000);
    expect((await sso.call("/api/me", cookie)).status).toBe(200);
    const replay = await sso.call(tx.path, tx.transaction);
    expect(replay.status).toBe(302);
    expect(replay.headers.get("Location")).toBe(origin + "/login?auth_error=retry");
    expect(await env.DB.prepare("SELECT COUNT(*) AS n FROM sessions").first("n")).toBe(0);
  });

  it("caps the app expiry at the central expiry and rejects expired local sessions", async () => {
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

  it("disables both old OTP routes and ignores legacy sessions without changing them", async () => {
    const sso = setup();
    await env.DB.prepare("INSERT INTO sessions (id, expires_at) VALUES (?, ?)")
      .bind(await secretHash("legacy", env.SESSION_SECRET!), Date.now() + 3600_000).run();
    expect((await sso.call("/api/me", "__Host-gu_session=legacy")).status).toBe(401);
    for (const endpoint of ["request-otp", "verify-otp"]) {
      expect((await sso.call(`/api/auth/${endpoint}`, "", "POST")).status).toBe(404);
    }
    expect(await env.DB.prepare("SELECT COUNT(*) AS n FROM otp_codes").first("n")).toBe(0);
    expect(await env.DB.prepare("SELECT COUNT(*) AS n FROM sessions").first("n")).toBe(1);
  });

  it("rejects non-owner central subjects and callback tampering", async () => {
    const sso = setup();
    const tx = await sso.begin();
    expect((await sso.call(tx.path + "invalid", tx.transaction)).status).toBe(302);
    expect(sso.central).not.toHaveBeenCalled();
    sso.subject("someone-else");
    expect((await sso.call(tx.path, tx.transaction)).status).toBe(302);
    expect(await env.DB.prepare("SELECT COUNT(*) AS n FROM kdp_sso_sessions").first("n")).toBe(0);
  });

  it("revalidates central revocation on APIs and private page gates", async () => {
    const sso = setup();
    const { cookie } = await sso.login();
    sso.revoke();
    expect((await sso.call("/api/dashboard", cookie)).status).toBe(401);
    expect((await sso.call("/api/calendar", cookie)).status).toBe(401);
    expect((await sso.call("/", cookie)).status).toBe(302);
  });

  it("serves the read-only calendar to the same SSO owner as the dashboard", async () => {
    const sso = setup();
    const { cookie } = await sso.login();
    const response = await sso.call("/api/calendar", cookie);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ read_only: true, sustained_authorization: "unconfirmed" });
    expect((await sso.call("/api/calendar")).status).toBe(401);
    expect((await sso.call("/api/calendar/sync", cookie, "PUT")).status).toBe(401);
  });

  it("returns 503 during an AUTH outage and retains the session for retry", async () => {
    const sso = setup();
    const { cookie } = await sso.login();
    sso.outage();
    expect((await sso.call("/api/me", cookie)).status).toBe(503);
    expect((await sso.call("/", cookie)).status).toBe(503);
    expect((await sso.call("/api/auth/logout", cookie, "POST")).status).toBe(503);
    expect(await env.DB.prepare("SELECT COUNT(*) AS n FROM kdp_sso_sessions").first("n")).toBe(1);
    expect((await worker.fetch(request("/api/auth/login"), { ...sso.bindings, AUTH: undefined })).status).toBe(503);
    const tx = await sso.begin();
    const failed = await sso.call(tx.path, tx.transaction);
    expect(failed.status).toBe(302);
    expect(failed.headers.get("Location")).toBe(origin + "/login?auth_error=unavailable");
  });

  it("globally logs out only on same-origin POST and clears the app cookie", async () => {
    const sso = setup();
    const { cookie } = await sso.login();
    const other = await sso.login();
    expect((await sso.call("/api/auth/logout", cookie, "POST", "https://evil.example")).status).toBe(403);
    expect((await sso.call("/api/auth/logout", cookie, "GET")).status).not.toBe(200);
    const result = await sso.call("/api/auth/logout", cookie, "POST");
    expect(result.status).toBe(200);
    expect(result.headers.get("Set-Cookie")).toContain("__Host-kdp_gu_session=;");
    expect(result.headers.get("Set-Cookie")).toContain("Max-Age=0");
    expect((await sso.call("/api/me", other.cookie)).status).toBe(401);
  });

  it("does not accept browser sessions as ingestion credentials or upload tokens as sessions", async () => {
    const sso = setup();
    const { cookie } = await sso.login();
    expect((await sso.call("/api/sync", cookie, "PUT")).status).toBe(401);
    expect((await worker.fetch(new Request(origin + "/api/me", {
      headers: { Authorization: `Bearer ${env.UPLOAD_TOKEN}` },
    }), sso.bindings)).status).toBe(401);
  });

  it("keeps login disabled and the legacy UI configured when the flag is off", async () => {
    const sso = setup();
    const disabled = { ...sso.bindings, SSO_ENABLED: "0" };
    const response = await worker.fetch(request("/api/auth/login"), disabled);
    expect(response.status).toBe(302);
    expect(response.headers.get("Location")).toBe(origin + "/login");
    expect((await worker.fetch(request("/api/auth/callback"), disabled)).status).toBe(404);
    expect(await (await worker.fetch(request("/api/health"), disabled)).json()).toMatchObject({ sso_enabled: false });
  });
});
