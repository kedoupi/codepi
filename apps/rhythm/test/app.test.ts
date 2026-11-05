import { env } from "cloudflare:test";
import { expect, it, vi } from "vitest";
import worker from "../worker/index";
import { selectCurrentStatus, freshnessOf } from "../worker/app";
import { STATE_THRESHOLDS } from "../worker/state";
import type { DayComputation } from "../worker/models";
import type { Env } from "../worker/types";
import {
  UPSTREAM_ACTIVITY_SAMPLES_PATH, UPSTREAM_HOME_DEVICES_PATH, UPSTREAM_HOME_EVENTS_PATH,
  UPSTREAM_HOME_HEARTBEATS_PATH, UPSTREAM_HOME_SNAPSHOTS_PATH,
} from "../worker/upstream";

const origin = "https://rhythm.test";
const testDate = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai" })
  .format(new Date(Date.now() - 86400_000));
const testStamp = (hour: number, minute: number) =>
  new Date(Date.parse(`${testDate}T${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}:00+08:00`)).toISOString();
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
    ?.match(new RegExp(`(__Host-kdp_rhythm_${kind}=[^;,]+)`))?.[1] ?? "";
}

function upstreamRows(pathname: string): unknown[] {
  if (pathname === UPSTREAM_ACTIVITY_SAMPLES_PATH) {
    return [
      { sampled_at: testStamp(9, 0), net: "office", idle_sec: 30, locked: 0, key_idle_sec: 20, pointer_idle_sec: 40, app_name: "示例编辑器" },
      { sampled_at: testStamp(9, 1), net: "office", idle_sec: 30, locked: 0, key_idle_sec: 20, pointer_idle_sec: 40, app_name: "示例编辑器" },
    ];
  }
  if (pathname === UPSTREAM_HOME_DEVICES_PATH) return [{ device_id: "dev-a", name: "示例手机", room: "卧室" }];
  if (pathname === UPSTREAM_HOME_SNAPSHOTS_PATH) {
    return [{ device_id: "dev-a", observed_at: testStamp(8, 0), status: "online", room: "卧室" }];
  }
  if (pathname === UPSTREAM_HOME_EVENTS_PATH) return [];
  if (pathname === UPSTREAM_HOME_HEARTBEATS_PATH) {
    return [{ observed_at: testStamp(9, 1), scan_ok: 1, device_count: 2 }];
  }
  return [];
}

function setupSso(options: { upstreamFails?: boolean } = {}) {
  const central = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const req = new Request(input, init);
    expect(req.headers.get("Authorization")).toBe(`Basic ${btoa("rhythm:test-sso-secret")}`);
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
      return Response.json({ active: true, subject: "kdp-owner", expires_at: Date.now() + 7 * 86400_000 });
    }
    return Response.json({ ok: true });
  });
  const statusRead = vi.fn(async (input: RequestInfo | URL) => {
    const url = new URL(String(input));
    if (options.upstreamFails) return new Response("boom", { status: 503 });
    return Response.json({ ok: true, resource: url.pathname, rows: upstreamRows(url.pathname) });
  });
  const bindings: Env = {
    ...env,
    SSO_ENABLED: "1",
    AUTH_CLIENT_ID: "rhythm",
    AUTH_CLIENT_SECRET: "test-sso-secret",
    AUTH_ORIGIN: "https://auth.codepi.app",
    AUTH: { fetch: central } as unknown as Fetcher,
    STATUS_READ: { fetch: statusRead } as unknown as Fetcher,
  };
  const send = (path: string, options: HttpOptions = {}) => worker.fetch(request(path, options), bindings);
  async function login() {
    const started = await send("/api/auth/login?return=%2F");
    expect(started.status).toBe(302);
    const authorize = new URL(started.headers.get("Location")!);
    expect(authorize.searchParams.get("client_id")).toBe("rhythm");
    const callback = await send(`/api/auth/callback?code=synthetic&state=${authorize.searchParams.get("state")}`, {
      cookie: cookieOf(started, "transaction"),
    });
    expect(callback.status).toBe(303);
    return cookieOf(callback, "session");
  }
  return { send, login, central, statusRead, bindings };
}

it("只有统一登录通过后才能读取当天数据与来源", async () => {
  const sso = setupSso();
  const health = await sso.send("/api/health");
  expect(health.status).toBe(200);
  expect(await health.json()).toMatchObject({ source: "rhythm", ok: true, sso_enabled: true, sso_ready: true });
  expect((await sso.send("/api/me")).status).toBe(401);
  expect((await sso.send(`/api/day?date=${testDate}`)).status).toBe(401);
  expect((await sso.send("/api/sources")).status).toBe(401);

  const cookie = await sso.login();
  expect((await sso.send("/api/me", { cookie })).status).toBe(200);
});

it("页面路由（含设置页）未登录跳去登录，登录后返回页面壳", async () => {
  const sso = setupSso();
  for (const path of ["/trend", "/settings"]) {
    const anonymous = await sso.send(path);
    expect(anonymous.status).toBe(302);
    expect(anonymous.headers.get("Location")).toContain(`/login?return=${encodeURIComponent(path)}`);
  }
  const cookie = await sso.login();
  const assets = vi.fn(async () => new Response("<!doctype html>", { headers: { "Content-Type": "text/html" } }));
  const shell = await worker.fetch(request("/settings", { cookie }), { ...sso.bindings, ASSETS: { fetch: assets } as unknown as Fetcher });
  expect(shell.status).toBe(200);
  expect(assets).toHaveBeenCalledOnce();
});

it("昨天 live 接口返回压缩时间段、工作块、关键时刻、四个数字与应用构成", async () => {
  await env.DB.prepare(
    "INSERT OR REPLACE INTO settings (id, subject_device_ids, app_categories, updated_at) VALUES (?,?,?,?)",
  ).bind("default", JSON.stringify(["dev-a"]), JSON.stringify({ "示例编辑器": "AI 编程" }), "2026-11-03T00:00:00.000Z").run();
  const sso = setupSso();
  const cookie = await sso.login();
  const response = await sso.send(`/api/day?date=${testDate}`, { cookie });
  expect(response.status).toBe(200);
  const body = await response.json() as Record<string, any>;
  expect(body.date).toBe(testDate);
  expect(body.timezone).toBe("Asia/Shanghai");
  expect(body.phoneConfigured).toBe(true);
  expect(body.segments.length).toBeGreaterThan(0);
  expect(body.segments[0]).toMatchObject({ status: expect.any(String), startMinute: 0 });
  expect(body.workBlocks.length).toBeGreaterThan(0);
  expect(body.workBlocks[0]).toMatchObject({ appsKind: "app", kind: expect.any(String), startMinute: expect.any(Number), gapMinutes: expect.any(Number) });
  expect(body.moments.some((moment: { kind: string }) => moment.kind === "start_work")).toBe(true);
  expect(body.metrics).toHaveProperty("commuteToWorkMinutes");
  expect(body.metrics).toHaveProperty("commuteHomeMinutes");
  expect(body.metrics).toHaveProperty("officeActiveMinutes");
  expect(body.metrics).toHaveProperty("homeMinutes");
  expect(body.appBreakdown[0]).toMatchObject({ category: "AI 编程" });
  expect(body.keyboardMouseMinutes).toEqual({ keyboard: 2, pointer: 2, both: 2 });
  // 假上游两路都返回了昨天的记录；历史日汇总缺失时不会现场补算。
  expect(body.freshness.home).toMatchObject({ status: "stale" });
  expect(body.freshness.home.ageMinutes).toEqual(expect.any(Number));
  expect(body.freshness.work).toMatchObject({ status: "stale" });
  expect(body.freshness.work.ageMinutes).toEqual(expect.any(Number));
  expect(sso.statusRead).toHaveBeenCalled();
});

it("没有指定手机时明确说明未指定手机", async () => {
  const sso = setupSso();
  const cookie = await sso.login();
  const body = await (await sso.send(`/api/day?date=${testDate}`, { cookie })).json() as Record<string, any>;
  expect(body.phoneConfigured).toBe(false);
  expect(body.metrics.bedroomMinutes).toBeNull();
  expect(body.metrics.livingRoomMinutes).toBeNull();
});

it("拒绝无效日期与未来日期", async () => {
  const sso = setupSso();
  const cookie = await sso.login();
  for (const date of ["", "2026-13-01", "2026-02-30", "not-a-date"]) {
    const response = await sso.send(`/api/day?date=${encodeURIComponent(date)}`, { cookie });
    expect(response.status, date).toBe(400);
    expect(await response.json()).toMatchObject({ error: "invalid_date" });
  }
  const tomorrow = new Date(Date.now() + 36 * 3600_000).toISOString().slice(0, 10);
  const future = await sso.send(`/api/day?date=${tomorrow}`, { cookie });
  expect(future.status).toBe(400);
  expect(await future.json()).toMatchObject({ error: "invalid_date" });
});

it("上游失败时返回明确错误码，页面不会拿到假数据", async () => {
  const sso = setupSso({ upstreamFails: true });
  const cookie = await sso.login();
  const response = await sso.send(`/api/day?date=${testDate}`, { cookie });
  expect(response.status).toBe(502);
  expect(await response.json()).toEqual({ error: "upstream_unavailable" });
  const sources = await sso.send("/api/sources", { cookie });
  expect(sources.status).toBe(502);
  expect(await sources.json()).toEqual({ error: "upstream_unavailable" });
});

it("来源页给出每个状态的判断方法、口径与不采集清单", async () => {
  const sso = setupSso();
  const cookie = await sso.login();
  const body = await (await sso.send("/api/sources", { cookie })).json() as Record<string, any>;
  expect(body.sources.home.name).toBeTruthy();
  expect(body.sources.work.method).toContain("键鼠");
  expect(body.states.map((state: { status: string }) => state.status)).toEqual([
    "bedroom", "living_room", "home", "office_active", "office_away", "commute", "other_network", "unknown",
  ]);
  for (const state of body.states) expect(state.method).toBeTruthy();
  expect(body.caveats.length).toBeGreaterThanOrEqual(5);
  expect(body.collection.length).toBeGreaterThanOrEqual(3);
  expect(body.collection.join(" ")).toContain("键盘内容");
  expect(body.collection.join(" ")).toContain("BSSID");
});

it("只接受同源写请求", async () => {
  const sso = setupSso();
  const cookie = await sso.login();
  const cross = await sso.send("/api/auth/logout", { cookie, method: "POST", source: "https://evil.example" });
  expect(cross.status).toBe(403);
  expect(await cross.json()).toMatchObject({ error: "origin_not_allowed" });
  const same = await sso.send("/api/auth/logout", { cookie, method: "POST" });
  expect(same.status).toBe(200);
});

it("日志只记录错误码，不记录上游行数据", async () => {
  const error = vi.spyOn(console, "error").mockImplementation(() => {});
  const sso = setupSso({ upstreamFails: true });
  const cookie = await sso.login();
  await sso.send(`/api/day?date=${testDate}`, { cookie });
  const logged = error.mock.calls.flat().join(" ");
  expect(logged).toContain("upstream_unavailable");
  expect(logged).not.toContain("示例");
  expect(logged).not.toContain("dev-a");
  error.mockRestore();
});

it("新鲜度按服务器当前时间解析 Z 与 +08:00", () => {
  const now = Date.parse("2026-11-03T16:00:00.000Z");
  expect(freshnessOf("2026-11-03T15:51:00.000Z", now, 10)).toMatchObject({
    ageMinutes: 9,
    status: "fresh",
  });
  expect(freshnessOf("2026-11-03T23:42:00+08:00", now, STATE_THRESHOLDS.activityFreshnessMinutes)).toMatchObject({
    ageMinutes: 18,
    status: "stale",
  });
});

it("两路新鲜度按各自阈值判断，超过 240 分钟仍是过期", () => {
  const now = Date.parse("2026-11-03T16:00:00.000Z");
  const stampMinutesAgo = (minutes: number) => new Date(now - minutes * 60_000).toISOString();

  expect(freshnessOf(stampMinutesAgo(10), now, 10).status).toBe("fresh");
  expect(freshnessOf(stampMinutesAgo(11), now, 10).status).toBe("stale");
  expect(freshnessOf(stampMinutesAgo(5), now, STATE_THRESHOLDS.activityFreshnessMinutes).status).toBe("fresh");
  expect(freshnessOf(stampMinutesAgo(6), now, STATE_THRESHOLDS.activityFreshnessMinutes).status).toBe("stale");
  expect(freshnessOf(stampMinutesAgo(241), now, STATE_THRESHOLDS.activityFreshnessMinutes)).toMatchObject({
    ageMinutes: 241,
    status: "stale",
  });
  expect(freshnessOf(null, now, 10).status).toBe("missing");
});

it("未来超过 60 秒的新鲜度标为时间异常", () => {
  const now = Date.parse("2026-11-03T16:00:00.000Z");
  expect(freshnessOf("2026-11-03T16:01:01.000Z", now)).toEqual({
    latestAt: "2026-11-03T16:01:01.000Z",
    ageMinutes: null,
    status: "time_anomaly",
  });
});

it("当前状态卡保留当前时刻并把状态截至最近可判断分钟", () => {
  const minuteStatuses = Array(1440).fill("unknown");
  const minuteEvidence = Array(1440).fill("no_data");
  minuteStatuses[580] = "office_active";
  minuteEvidence[580] = "seen";
  const day = { minuteStatuses, minuteEvidence } as unknown as DayComputation;
  expect(selectCurrentStatus(day, 600)).toEqual({ minute: 600, statusMinute: 580 });
});

it("当前状态卡回看窗口包含第 20 分钟但不包含第 21 分钟", () => {
  const minuteStatuses = Array(1440).fill("unknown");
  const minuteEvidence = Array(1440).fill("no_data");
  minuteStatuses[580] = "office_active";
  minuteEvidence[580] = "seen";
  const day = { minuteStatuses, minuteEvidence } as unknown as DayComputation;
  expect(selectCurrentStatus(day, 600)).toEqual({ minute: 600, statusMinute: 580 });
  expect(selectCurrentStatus(day, 601)).toEqual({ minute: 601, statusMinute: null });
});

it("最近 20 分钟内都不可判断时 current asOf 为 null", () => {
  const minuteStatuses = Array(1440).fill("unknown");
  const minuteEvidence = Array(1440).fill("no_data");
  const day = { minuteStatuses, minuteEvidence } as unknown as DayComputation;
  expect(selectCurrentStatus(day, 600)).toEqual({ minute: 600, statusMinute: null });
});
