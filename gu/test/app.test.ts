import { env } from "cloudflare:test";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import worker from "../worker/index";
import { hash, OWNER_EMAIL } from "../worker/lib";
import type { Dashboard, Env } from "../worker/types";
import { markdown } from "../web/src/markdown";

function request(path: string, options: { method?: string; body?: unknown; cookie?: string; bearer?: string; origin?: string; host?: string } = {}) {
  const host = options.host || "http://localhost";
  const headers: Record<string, string> = { Origin: options.origin ?? host };
  if (options.body !== undefined) headers["Content-Type"] = "application/json";
  if (options.cookie) headers.Cookie = options.cookie;
  if (options.bearer) headers.Authorization = `Bearer ${options.bearer}`;
  return new Request(host + path, {
    method: options.method || (options.body === undefined ? "GET" : "POST"),
    headers,
    ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
  });
}
const call = (req: Request, bindings: Env = env) => worker.fetch(req, bindings);
const cookieOf = (r: Response, name = "gu_challenge") => r.headers.get("Set-Cookie")?.match(new RegExp(`(?:^|,\\s*)(${name}=[^;]+)`))?.[1] || "";

async function challenge() {
  const result = await call(request("/api/auth/request-otp", { body: {} }));
  expect(result.status).toBe(200);
  const body = await result.json() as { dev_otp: string };
  return { cookie: cookieOf(result), code: body.dev_otp };
}
async function login() {
  const c = await challenge();
  const result = await call(request("/api/auth/verify-otp", { cookie: c.cookie, body: { code: c.code } }));
  expect(result.status).toBe(200);
  return cookieOf(result, "gu_session");
}
function fixture(): Dashboard {
  return {
    account: [{ data_mode: "live", generated_at: "2026-10-13T12:00:00+08:00", holdings_as_of: "2026-09-16",
      quote_date: "2026-10-12", framework: "test", cash_as_of: "2026-09-16", warnings: "测试数据",
      total_usd: 1000, stocks_usd: 600, hk_usd: 0, cash_usd: 400, cash_weight: .4, cash_after_dca: .2, cash_age_days: 27 }],
    positions: [{ ticker: "TEST", name: "测试", shares: 10, avg_cost: 50, price: 60, change_pct: .01,
      value_usd: 600, weight: .6, target: .6, pnl_pct: .2, quote_date: "2026-10-12" }],
    risk: [{ rule_id: "test-stop", item: "TEST 停买", kind: "权重", current: "60%", threshold: ">=60%",
      level: "停买", triggered: true, distance: 0, action: "不再加仓", proximity: "critical" }],
    market: [{ symbol: "TEST", name: "测试指数", group: "指数", close: 100, change_pct: .02, date: "2026-10-12", error: null }],
    reports: [{ id: "test-report", date: "2026-10-13", date_source: "front_matter", trading_date: "2026-10-12",
      kind: "盘后复盘", headline: "测试报告", action: "只观察", rule: "无", body: "# 测试\n正文",
      path: "reports/2026-10/2026-10-13_盘后复盘.md" }],
  };
}
async function pack(data = fixture()) {
  const payload = JSON.stringify(data);
  return { schema_version: 1, batch_id: await hash(payload), payload };
}
async function sync(data = fixture()) {
  return call(request("/api/sync", { method: "PUT", body: await pack(data), bearer: env.UPLOAD_TOKEN }));
}
beforeEach(async () => {
  await env.DB.exec("DROP TRIGGER IF EXISTS fail_pointer; DELETE FROM dashboard_current; DELETE FROM dashboard_batches; DELETE FROM sessions; DELETE FROM otp_codes;");
});
afterEach(() => vi.restoreAllMocks());

describe("fixed owner authentication", () => {
  it("requires login for every private API and hides static JSON paths", async () => {
    for (const host of ["https://gu.kdp.cool", "https://kdp-gu.pages.dev", "https://preview.kdp-gu.pages.dev"]) {
      expect((await call(request("/api/dashboard", { host }))).status).toBe(401);
      expect((await call(request("/dashboard/account.json", { host }))).status).toBe(404);
      expect((await call(request("/", { host }))).status).toBe(302);
    }
  });
  it("rejects cross-origin mutations", async () => {
    expect((await call(request("/api/auth/request-otp", { body: {}, origin: "https://evil.example" }))).status).toBe(403);
  });
  it("fails closed in production without mail configuration", async () => {
    const spy = vi.spyOn(console, "log");
    const result = await call(request("/api/auth/request-otp", { body: {}, host: "https://gu.kdp.cool" }), { ...env, ENVIRONMENT: "production" });
    expect(result.status).toBe(503);
    expect(spy).not.toHaveBeenCalled();
    expect(await env.DB.prepare("SELECT COUNT(*) AS n FROM otp_codes").first("n")).toBe(0);
  });
  it("ignores supplied recipient and sends only to the fixed owner", async () => {
    const fetch = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("{}", { status: 200 }));
    const result = await call(request("/api/auth/request-otp", { body: { email: "attacker@example.com" }, host: "https://gu.kdp.cool" }),
      { ...env, ENVIRONMENT: "production", RESEND_API_KEY: "mock-key" });
    expect(result.status).toBe(200);
    const sent = JSON.parse(String(fetch.mock.calls[0][1]?.body));
    expect(sent.to).toEqual([OWNER_EMAIL]);
    expect(await result.text()).not.toContain("dev_otp");
    expect(result.headers.get("Set-Cookie")).toContain("__Host-gu_challenge=");
    expect(result.headers.get("Set-Cookie")).toContain("Secure");
  });
  it("invalidates the challenge when mail delivery fails", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("rejected", { status: 500 }));
    expect((await call(request("/api/auth/request-otp", { body: {} }), { ...env, RESEND_API_KEY: "mock" })).status).toBe(502);
    expect(await env.DB.prepare("SELECT COUNT(*) AS n FROM otp_codes WHERE used_at IS NULL").first("n")).toBe(0);
  });
  it("allows exactly one concurrent send during cooldown", async () => {
    const results = await Promise.all([call(request("/api/auth/request-otp", { body: {} })), call(request("/api/auth/request-otp", { body: {} }))]);
    expect(results.map(r => r.status).sort()).toEqual([200, 429]);
  });
  it("logs in, reads empty state, logs out and revokes the session", async () => {
    const cookie = await login();
    expect((await call(request("/api/me", { cookie }))).status).toBe(200);
    expect((await call(request("/api/dashboard", { cookie }))).status).toBe(404);
    expect((await call(request("/api/auth/logout", { cookie, body: {} }))).status).toBe(200);
    expect((await call(request("/api/me", { cookie }))).status).toBe(401);
  });
  it("consumes an OTP only once under concurrent verification", async () => {
    const c = await challenge();
    const responses = await Promise.all([1, 2].map(() => call(request("/api/auth/verify-otp", { cookie: c.cookie, body: { code: c.code } }))));
    expect(responses.map(r => r.status).sort()).toEqual([200, 400]);
  });
  it("locks a challenge after five failures", async () => {
    const c = await challenge();
    const wrong = c.code === "111111" ? "222222" : "111111";
    for (let i = 0; i < 5; i++) expect((await call(request("/api/auth/verify-otp", { cookie: c.cookie, body: { code: wrong } }))).status).toBe(400);
    expect((await call(request("/api/auth/verify-otp", { cookie: c.cookie, body: { code: c.code } }))).status).toBe(400);
  });
  it("rejects expired OTP and session", async () => {
    const c = await challenge();
    await env.DB.prepare("UPDATE otp_codes SET expires_at = 0").run();
    expect((await call(request("/api/auth/verify-otp", { cookie: c.cookie, body: { code: c.code } }))).status).toBe(400);
    await env.DB.prepare("DELETE FROM otp_codes").run();
    const cookie = await login();
    await env.DB.prepare("UPDATE sessions SET expires_at = 0").run();
    expect((await call(request("/api/me", { cookie }))).status).toBe(401);
  });
  it("does not expose local OTP on a remote preview hostname", async () => {
    expect((await call(request("/api/auth/request-otp", { body: {}, host: "https://preview.kdp-gu.pages.dev" }))).status).toBe(503);
  });
});

describe("complete dashboard batches", () => {
  it("separates upload credentials from browser sessions", async () => {
    const cookie = await login();
    expect((await call(request("/api/sync", { method: "PUT", body: await pack(), cookie }))).status).toBe(401);
    expect((await call(request("/api/dashboard", { bearer: env.UPLOAD_TOKEN }))).status).toBe(401);
  });
  it("uploads and reads the same batch with no-store headers", async () => {
    const cookie = await login();
    expect((await sync()).status).toBe(200);
    const result = await call(request("/api/dashboard", { cookie }));
    expect(result.status).toBe(200);
    expect(result.headers.get("Cache-Control")).toBe("no-store");
    expect((await result.json() as { data: Dashboard }).data).toEqual(fixture());
  });
  it("rejects offline and legacy batches", async () => {
    for (const mode of ["offline", undefined]) {
      const d = fixture(); d.account[0].data_mode = mode;
      expect((await sync(d)).status).toBe(400);
    }
  });
  it("rejects incomplete batches and digest mismatches", async () => {
    const packed = await pack(); packed.batch_id = "a".repeat(64);
    expect((await call(request("/api/sync", { method: "PUT", body: packed, bearer: env.UPLOAD_TOKEN }))).status).toBe(400);
    const d = fixture(); d.risk = [];
    expect((await sync(d)).status).toBe(400);
  });
  it("requires missing market prices to carry an explicit error", async () => {
    const d = fixture(); d.market[0].close = null;
    expect((await sync(d)).status).toBe(400);
    d.market[0].error = "provider unavailable";
    expect((await sync(d)).status).toBe(200);
  });
  it("rejects future timestamps, missing holding quotes and negative risk distance", async () => {
    for (const mutate of [
      (d: Dashboard) => { d.account[0].generated_at = "2099-01-01T00:00:00Z"; },
      (d: Dashboard) => { d.positions[0].price = null; },
      (d: Dashboard) => { d.risk[0].distance = -.1; },
    ]) { const d = fixture(); mutate(d); expect((await sync(d)).status).toBe(400); }
  });
  it("keeps current data after invalid and stale uploads; retries are idempotent", async () => {
    expect((await sync()).status).toBe(200);
    expect((await sync()).status).toBe(200);
    const stale = fixture(); stale.account[0].generated_at = "2026-10-12T12:00:00+08:00";
    expect((await sync(stale)).status).toBe(409);
    const invalid = fixture(); invalid.positions[0].price = null;
    expect((await sync(invalid)).status).toBe(400);
    expect(await env.DB.prepare("SELECT batch_id FROM dashboard_current").first("batch_id")).toBe((await pack()).batch_id);
  });
  it("rolls back batch insertion when pointer replacement fails", async () => {
    await sync();
    await env.DB.exec("CREATE TRIGGER fail_pointer BEFORE UPDATE ON dashboard_current BEGIN SELECT RAISE(ABORT, 'simulated write failure'); END;");
    const newer = fixture(); newer.account[0].generated_at = "2026-10-13T13:00:00+08:00";
    expect((await sync(newer)).status).toBe(503);
    expect(await env.DB.prepare("SELECT COUNT(*) AS n FROM dashboard_batches").first("n")).toBe(1);
    expect(await env.DB.prepare("SELECT batch_id FROM dashboard_current").first("batch_id")).toBe((await pack()).batch_id);
  });
  it("renders report markdown without executable HTML or links", () => {
    const rendered = markdown('# Title\n<script>alert(1)</script>\n[x](javascript:alert(1))\n**strong**\n| A | B |\n|---|---|\n| 1 | 2 |');
    expect(rendered).not.toContain("<script>");
    expect(rendered).not.toContain("href=");
    expect(rendered).toContain("<strong>strong</strong>");
    expect(rendered).toContain("<table>");
  });
});
