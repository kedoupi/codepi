import { env } from "cloudflare:test";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import worker from "../worker/index";
import { hash, OWNER_EMAIL } from "../worker/lib";
import type { Dashboard, Env } from "../worker/types";
import { markdown } from "../web/src/markdown";
import { marketChange } from "../web/src/format";
import { allocationGap, riskRail, weightHistory, historyDetail } from "../web/src/charts";
import { accountAlerts, overviewRules } from "../web/src/risk-summary";

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
    risk: [
      { rule_id: "test-stop", item: "TEST 停买", kind: "权重", current: "60%", threshold: ">=60%",
        level: "停买", triggered: true, distance: 0, action: "不再加仓", proximity: "critical" },
      { rule_id: "test-none", item: "TEST 无阈值", kind: "权重", current: "5.6%", threshold: "—",
        level: "—", triggered: null, distance: null, action: null, proximity: "none" },
      { rule_id: "test-clear", item: "TEST 未触发", kind: "权重", current: "10%", threshold: ">20%",
        level: "未触发；距离未临近", triggered: false, distance: .5, action: null, proximity: "clear" },
    ],
    market: [{ symbol: "TEST", name: "测试指数", group: "指数", close: 100, change_pct: .02, date: "2026-10-12", error: null }],
    history: [
      { date: "2026-09-16", source: "portfolio/snapshots/2026-09-16_持仓档案_SSOT.md", approx: true,
        weights: { TEST: .6 } },
      { date: "2026-10-14", source: "本批行情（positions.json）", approx: false, weights: { TEST: .6 } },
    ],
    reports: [{ id: "test-report", date: "2026-10-13", date_source: "front_matter", trading_date: "2026-10-12",
      kind: "盘后复盘", headline: "测试报告", action: "只观察", rule: "无", body: "# 测试\n正文",
      path: "reports/2026-10/2026-10-13_盘后复盘.md" }],
  };
}
async function pack(data = fixture(), schemaVersion = 2) {
  const payload = JSON.stringify(data);
  return { schema_version: schemaVersion, batch_id: await hash(payload), payload };
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
    const code = sent.text.match(/验证码是 (\d{6})/)[1];
    expect(sent.html).toContain(`>${code}</span>`);
    expect(sent.html).toContain('lang="zh-CN"');
    expect(sent.html).toContain('name="viewport"');
    expect(sent.html).toContain("8 分钟内有效，仅可使用一次");
    expect(sent.text).toContain("请勿向他人提供验证码");
    expect(sent.html).not.toMatch(/<script|<iframe|<img|https?:\/\//i);
    const body = await result.text();
    expect(body).not.toContain("dev_otp");
    expect(body).not.toContain(code);
    expect(result.headers.get("Set-Cookie")).toContain("__Host-gu_challenge=");
    expect(result.headers.get("Set-Cookie")).toContain("Secure");
  });
  it("invalidates the challenge when mail delivery fails", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("rejected", { status: 500 }));
    expect((await call(request("/api/auth/request-otp", { body: {} }), { ...env, RESEND_API_KEY: "mock" })).status).toBe(502);
    expect(await env.DB.prepare("SELECT COUNT(*) AS n FROM otp_codes WHERE used_at IS NULL").first("n")).toBe(0);
  });
  it("invalidates the challenge on a mail transport error without exposing details", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("private provider details"));
    const result = await call(request("/api/auth/request-otp", { body: {} }), { ...env, RESEND_API_KEY: "mock" });
    expect(result.status).toBe(502);
    expect(await result.json()).toEqual({ error: "验证码发送失败，请稍后重试" });
    expect(result.headers.get("Set-Cookie")).toBeNull();
    expect(await env.DB.prepare("SELECT COUNT(*) AS n FROM otp_codes WHERE used_at IS NULL").first("n")).toBe(0);
  });
  it("reports the remaining cooldown after mail delivery instead of restarting the clock", async () => {
    const now = Date.now();
    const clock = vi.spyOn(Date, "now").mockReturnValue(now);
    vi.spyOn(globalThis, "fetch").mockImplementation(async () => {
      clock.mockReturnValue(now + 12_345);
      return new Response("{}", { status: 200 });
    });
    const result = await call(request("/api/auth/request-otp", { body: {} }), { ...env, RESEND_API_KEY: "mock" });
    expect(result.status).toBe(200);
    expect(await result.json()).toEqual({ ok: true, retry_after: 48 });
  });
  async function seedSends(now: number, ages: number[]) {
    await env.DB.batch(ages.map((age, i) => env.DB.prepare(`INSERT INTO otp_codes
      (id, code_hash, ip_hash, created_at, expires_at, used_at) VALUES (?, ?, ?, ?, ?, ?)`)
      .bind(`quota-${i}`, "test-hash", "test-ip", now - age, now - age + 480_000, now - age)));
  }
  it.each([
    { window: "cooldown", ages: [12_345], seconds: 48 },
    { window: "15 minute", ages: [180_000, 120_000, 61_000], seconds: 720 },
    { window: "daily", ages: [82_799_877, 78_000_000, 70_000_000, 60_000_000, 50_000_000, 40_000_000, 30_000_000, 20_000_000, 10_000_000, 1_000_000], seconds: 3601 },
    { window: "overlapping", ages: [82_800_000, 78_000_000, 70_000_000, 60_000_000, 50_000_000, 40_000_000, 30_000_000, 180_000, 120_000, 10_000], seconds: 3600 },
    { window: "15 minute with excess rows", ages: [890_000, 850_000, 200_000, 100_000], seconds: 50 },
    { window: "daily with excess rows", ages: [86_390_000, 86_380_000, 80_000_000, 70_000_000, 60_000_000, 50_000_000, 40_000_000, 30_000_000, 20_000_000, 10_000_000, 1_000_000], seconds: 20 },
  ])("returns the remaining $window wait, counting consumed and expired challenges", async ({ ages, seconds }) => {
    const now = Date.now();
    vi.spyOn(Date, "now").mockReturnValue(now);
    await seedSends(now, ages);
    const fetch = vi.spyOn(globalThis, "fetch");
    const result = await call(request("/api/auth/request-otp", { body: {} }));
    expect(result.status).toBe(429);
    expect(await result.json()).toEqual({ error: "发送较频繁，请稍后再试", retry_after: seconds });
    expect(result.headers.get("Retry-After")).toBe(String(seconds));
    expect(result.headers.get("Set-Cookie")).toBeNull();
    expect(fetch).not.toHaveBeenCalled();
    expect(await env.DB.prepare("SELECT COUNT(*) AS n FROM otp_codes").first("n")).toBe(ages.length);
  });
  it.each([
    { window: "cooldown", ages: [59_999] },
    { window: "15 minute", ages: [899_999, 240_000, 120_000] },
    { window: "daily", ages: [86_399_999, 78_000_000, 70_000_000, 60_000_000, 50_000_000, 40_000_000, 30_000_000, 20_000_000, 10_000_000, 1_000_000] },
  ])("allows sending exactly at the $window boundary", async ({ ages }) => {
    const now = Date.now();
    const clock = vi.spyOn(Date, "now").mockReturnValue(now);
    await seedSends(now, ages);
    const blocked = await call(request("/api/auth/request-otp", { body: {} }));
    expect(blocked.status).toBe(429);
    expect(await blocked.json()).toMatchObject({ retry_after: 1 });
    clock.mockReturnValue(now + 1);
    expect((await call(request("/api/auth/request-otp", { body: {} }))).status).toBe(200);
  });
  it.each([
    { window: "15 minute", ages: [180_000, 120_000], seconds: 720 },
    { window: "daily", ages: [82_800_000, 78_000_000, 70_000_000, 60_000_000, 50_000_000, 40_000_000, 30_000_000, 20_000_000, 10_000_000], seconds: 3600 },
  ])("reserves only the last $window slot under concurrent sends", async ({ ages, seconds }) => {
    const now = Date.now();
    vi.spyOn(Date, "now").mockReturnValue(now);
    await seedSends(now, ages);
    const results = await Promise.all([1, 2].map(() => call(request("/api/auth/request-otp", { body: {} }))));
    expect(results.map(r => r.status).sort()).toEqual([200, 429]);
    for (const result of results) expect(await result.json()).toMatchObject({ retry_after: seconds });
    expect(await env.DB.prepare("SELECT COUNT(*) AS n FROM otp_codes").first("n")).toBe(ages.length + 1);
  });
  it("allows exactly one concurrent send during cooldown", async () => {
    const results = await Promise.all([call(request("/api/auth/request-otp", { body: {} })), call(request("/api/auth/request-otp", { body: {} }))]);
    expect(results.map(r => r.status).sort()).toEqual([200, 429]);
  });
  it("sends only one real-provider request under concurrent production sends", async () => {
    const fetch = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("{}", { status: 200 }));
    const bindings = { ...env, ENVIRONMENT: "production", RESEND_API_KEY: "mock" };
    const results = await Promise.all([1, 2].map(() =>
      call(request("/api/auth/request-otp", { body: {}, host: "https://gu.kdp.cool" }), bindings)));
    expect(results.map(r => r.status).sort()).toEqual([200, 429]);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(JSON.parse(String(fetch.mock.calls[0][1]?.body)).to).toEqual([OWNER_EMAIL]);
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
  it("reserves at most five attempts under concurrent failures", async () => {
    const c = await challenge();
    const wrong = c.code === "111111" ? "222222" : "111111";
    const results = await Promise.all(Array.from({ length: 8 }, () =>
      call(request("/api/auth/verify-otp", { cookie: c.cookie, body: { code: wrong } }))));
    expect(results.every(r => r.status === 400)).toBe(true);
    expect(await env.DB.prepare("SELECT attempts FROM otp_codes").first("attempts")).toBe(5);
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
  it("preserves quote percentage-point units instead of multiplying by 100", () => {
    expect(marketChange(-1.35)).toBe("-1.35%");
    expect(marketChange(0.2)).toBe("+0.20%");
    expect(marketChange(0)).toBe("0.00%");
    expect(marketChange(null)).toBe("—");
  });
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
  it("accepts not-applicable and inactive risk states without inventing actions", async () => {
    expect((await sync()).status).toBe(200);
    const cookie = await login();
    const result = await call(request("/api/dashboard", { cookie }));
    const data = (await result.json() as { data: Dashboard }).data;
    expect(data.risk[1]).toMatchObject({ rule_id: "test-none", triggered: null, action: null, distance: null });
    expect(data.risk[2]).toMatchObject({ rule_id: "test-clear", triggered: false, action: null });
  });
  it("rejects malformed risk state types", async () => {
    for (const mutate of [
      (d: Dashboard) => { d.risk[0].triggered = "true"; },
      (d: Dashboard) => { d.risk[0].action = 1; },
    ]) { const d = fixture(); mutate(d); expect((await sync(d)).status).toBe(400); }
  });
  it("accepts the weight history and rejects malformed history", async () => {
    expect((await sync()).status).toBe(200);
    const cookie = await login();
    const data = (await (await call(request("/api/dashboard", { cookie }))).json() as { data: Dashboard }).data;
    expect(data.history).toHaveLength(2);
    expect(data.history![0]).toMatchObject({ date: "2026-09-16", approx: true, weights: { TEST: .6 } });
    for (const mutate of [
      (d: Dashboard) => { d.history = []; },
      (d: Dashboard) => { d.history![0].date = "2026-13-40"; },
      (d: Dashboard) => { d.history![0].approx = "yes"; },
      (d: Dashboard) => { d.history![0].weights = {}; },
      (d: Dashboard) => { d.history![0].weights = { TEST: 1.5 }; },
    ]) { const d = fixture(); mutate(d); expect((await sync(d)).status).toBe(400); }
  });
  it("still reads a schema v1 batch that predates the weight history", async () => {
    const legacy = fixture();
    delete legacy.history;
    const packed = await pack(legacy, 1);
    expect((await call(request("/api/sync", { method: "PUT", body: packed, bearer: env.UPLOAD_TOKEN }))).status).toBe(200);
    const cookie = await login();
    const result = await call(request("/api/dashboard", { cookie }));
    expect((await result.json() as { data: Dashboard }).data.history).toBeUndefined();
    // A v2 envelope must still carry the history key.
    expect((await sync(legacy)).status).toBe(400);
  });
  it("rejects unsupported schema versions", async () => {
    const packed = await pack(fixture(), 3);
    expect((await call(request("/api/sync", { method: "PUT", body: packed, bearer: env.UPLOAD_TOKEN }))).status).toBe(400);
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

describe("charts", () => {
  it("surfaces fatigue locks, cash brakes and severe account warnings safely", () => {
    const html = accountAlerts("现金记录待更新 / ⚠️ 情绪疲劳锁：48 小时禁止卖出/调仓 / 触发硬刹车，需减额或暂停 / ⚠️ <img onerror=x>");
    expect(html).toContain('role="alert"');
    expect(html).toContain("48 小时禁止卖出/调仓");
    expect(html).toContain("触发硬刹车");
    expect(html).not.toContain("现金记录待更新");
    expect(html).not.toContain("<img");
    expect(accountAlerts(null)).toBe("");
    expect(accountAlerts("历史条件未评估")).toBe("");
  });
  it("prioritizes GOOGL force in the overview without removing either detailed rule", () => {
    const rows = [
      { rule_id: "GOOGL_trim", triggered: true, action: "减到约 18%" },
      { rule_id: "GOOGL_force", triggered: true, action: "减到 20%" },
      { rule_id: "NVDA_stop", triggered: true, action: "不再加仓" },
    ];
    expect(overviewRules(rows).map(r => r.rule_id)).toEqual(["GOOGL_force", "NVDA_stop"]);
    expect(rows).toHaveLength(3);
    expect(riskRail(rows)).toContain("减到约 18%");
    expect(riskRail(rows)).toContain("减到 20%");
    expect(overviewRules([{ ...rows[1], triggered: false }, rows[0]])).toEqual([rows[0]]);
  });
  it("keeps all triggered rules visible ahead of approaching rules", () => {
    const rows = [{ rule_id: "near", triggered: false, proximity: "near" },
      ...Array.from({ length: 6 }, (_, i) => ({ rule_id: `trigger-${i}`, triggered: true }))];
    expect(overviewRules(rows)).toHaveLength(7);
    expect(overviewRules(rows)[0].rule_id).toBe("trigger-0");
  });
  it.each(["near", "critical"])("retains analysis deadlines alongside triggered %s actions", proximity => {
    const html = riskRail([{ item: "NVDA", triggered: true, distance: .04, proximity,
      action: "不再加仓（不是卖出信号）" }]);
    expect(html).toContain("已触发 ·");
    expect(html).toContain("当天出书面临近分析");
    expect(html).toContain("不是卖出信号");
    if (proximity === "critical") expect(html).toContain("3 个交易日内出书面决策");
  });
  const positions = [
    { ticker: "VOO", weight: .056, target: .6 },
    { ticker: "现金", weight: .698, target: .14 },
  ];
  it("sorts allocation rows by gap and marks the target position", () => {
    const html = allocationGap(positions);
    expect(html.indexOf("现金")).toBeLessThan(html.indexOf("VOO"));
    expect(html).toContain("+55.8");
    expect(html).toContain("−54.4");
    expect((html.match(/class="gap-mark"/g) || []).length).toBe(2);
  });
  it("renders a missing target as no marker instead of zero", () => {
    const html = allocationGap([{ ticker: "X", weight: .1, target: null }]);
    expect(html).not.toContain("gap-mark");
    expect(html).toContain("目标 —");
  });
  it("treats the cash line as a minimum buffer and displays exact allocation without negative zero", () => {
    const html = allocationGap(positions);
    expect(html).toContain("最低 14.0%");
    expect(html).toContain('class="gap-fill buffer"');
    expect(html).toContain("不代表需减至 14%");
    expect(allocationGap([{ ticker: "VOO", weight: .6, target: .6 }])).not.toContain("−0.0");
  });
  it("keeps distance and trigger state separate on the risk rail", () => {
    const html = riskRail([
      { item: "NVDA 停买线", kind: "权重", current: "7.0%", threshold: "≥6.5% 停买",
        distance: .0767, triggered: true, action: "不再加仓（不是卖出信号）", proximity: "near", level: "已触发" },
      { item: "VOO", kind: "权重", current: "5.6%", threshold: "—",
        distance: null, triggered: null, action: null, proximity: "none", level: "—" },
      { item: "GOOGL 减仓线", kind: "权重", current: "13.2%", threshold: ">20% 减仓",
        distance: .3396, triggered: false, action: null, proximity: "clear", level: "未触发；距离未临近" },
    ]);
    expect(html).toContain("已触发");
    expect(html).toContain("不适用");
    expect(html).toContain("未临近");
    expect(html).toContain("不再加仓（不是卖出信号）");
    // The closest rule is listed first; the rule without a threshold comes last.
    expect(html.indexOf("NVDA 停买线")).toBeLessThan(html.indexOf("GOOGL 减仓线"));
    expect(html.indexOf("GOOGL 减仓线")).toBeLessThan(html.indexOf(">VOO<"));
    expect(html).not.toMatch(/data-[wl]="NaN/);
  });
  // The site CSP is style-src 'self': the browser drops style attributes written into markup,
  // so chart geometry must travel as data-* and be applied through CSSOM.
  it("never emits inline style attributes that the CSP would drop", () => {
    const html = allocationGap(positions) + riskRail(fixture().risk)
      + weightHistory(fixture().history!, { NVDA: .065 });
    expect(html).not.toMatch(/\sstyle="/);
    expect(allocationGap(positions)).toMatch(/class="gap-fill buffer" data-w="[\d.]+"/);
    expect(riskRail(fixture().risk)).toMatch(/class="rail-dot" data-l="[\d.]+"/);
  });
  it("skips the history chart until there are at least two dated points", () => {
    expect(weightHistory([], {})).toBe("");
    expect(weightHistory([{ date: "2026-10-14", weights: { NVDA: .07 }, approx: false, source: "x" }], {})).toBe("");
    const html = weightHistory([
      { date: "2026-09-16", weights: { NVDA: .073, VOO: .056 }, approx: true, source: "a" },
      { date: "2026-10-14", weights: { NVDA: .07, VOO: .056 }, approx: false, source: "b" },
    ], { NVDA: .065, GOOGL: .135 });
    expect(html).toContain("NVDA 停买线 6.5%");
    expect(html).toContain("10-14");
    expect(html).not.toContain("GOOGL 目标");
  });
  it("uses elapsed calendar days and sorts history without mutating its input", () => {
    const rows = [
      { date: "2026-10-11", weights: { NVDA: .07 }, approx: false, source: "latest" },
      { date: "2026-10-01", weights: { NVDA: .06 }, approx: true, source: "first" },
      { date: "2026-10-02", weights: { NVDA: .065 }, approx: true, source: "next" },
    ];
    const html = weightHistory(rows);
    expect(html).toContain('cx="137.4"'); // Day 1 of the 10-day range: 54 + 834 * .1.
    expect(html).toContain('<title>2026-10-02 · NVDA 6.5%</title>');
    expect(rows[0].date).toBe("2026-10-11");
    expect(html).not.toContain("NaN");
  });
  it("breaks lines for missing weights and handles same-day snapshot and quote records", () => {
    const html = weightHistory([
      { date: "2026-10-01", weights: { NVDA: .06 }, approx: true, source: "a" },
      { date: "2026-10-02", weights: { VOO: .05 }, approx: true, source: "b" },
      { date: "2026-10-03", weights: { NVDA: .07 }, approx: false, source: "c" },
    ]);
    expect(html).toMatch(/d="M54.0,[\d.]+ M888.0,[\d.]+"/);
    const sameDay = weightHistory([
      { date: "2026-10-14", weights: { NVDA: .07 }, approx: true, source: "snapshot" },
      { date: "2026-10-14", weights: { NVDA: .071 }, approx: false, source: "quote" },
    ]);
    expect(sameDay).not.toMatch(/NaN|Infinity/);
    expect(sameDay).toContain('value="snapshot"');
    expect(sameDay).toContain('value="quote" selected');
  });
  it("shows the selected record's values and escapes its provenance", () => {
    const detail = historyDetail({ date: "2026-06-11", approx: true,
      source: "<img onerror=alert(1)>", weights: { GOOGL: .1376, NVDA: .0552 } });
    expect(detail).toContain("13.8%");
    expect(detail).toContain("历史档案约值");
    expect(detail).toContain("&lt;img");
    expect(detail).not.toContain("<img");
  });
});

describe("safe report links", () => {
  it("renders adjacent HTTP links with formatting, query strings and parentheses", () => {
    const html = markdown('[**SEC**](https://www.sec.gov/a_(b)?x=1&y=2)[新闻](http://example.com/news)');
    expect(html).toContain('href="https://www.sec.gov/a_(b)?x=1&amp;y=2"');
    expect(html).toContain("<strong>SEC</strong></a>");
    expect(html.match(/target="_blank" rel="noopener noreferrer"/g)).toHaveLength(2);
  });
  it.each(["javascript:alert(1)", "data:text/html,test", "//evil.example", "/api/auth/logout", "https://", "java&#x73;cript:alert(1)"])("rejects %s destinations", url => {
    expect(markdown(`[link](${url})`)).not.toContain("<a ");
  });
  it("escapes labels and attributes, and never interprets code as links", () => {
    const html = markdown('[<img src=x onerror=x>](https://example.com/"onclick="x)\n`[code](https://example.com)`\n```\n[code](https://example.com)\n```');
    expect(html).not.toContain("<img");
    expect(html).toContain("&quot;onclick=&quot;x");
    expect(html.match(/<a /g)).toHaveLength(1);
    expect(html).toContain("<code>[code](https://example.com)</code>");
  });
});
