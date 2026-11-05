import { env } from "cloudflare:test";
import { describe, expect, it, vi } from "vitest";
import worker from "../worker/index";
import type { Env } from "../worker/types";
import {
  UPSTREAM_ACTIVITY_SAMPLES_PATH, UPSTREAM_HOME_DEVICES_PATH, UPSTREAM_HOME_HEARTBEATS_PATH,
  UPSTREAM_HOME_SNAPSHOTS_PATH,
} from "../worker/upstream";

const origin = "https://rhythm.test";
const shanghai = (epoch: number) => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai" }).format(new Date(epoch));
const today = shanghai(Date.now());
const daysAgo = (n: number) => shanghai(Date.now() - n * 86400_000);
const stamp = (date: string, hour: number, minute = 0) =>
  new Date(Date.parse(`${date}T${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}:00+08:00`)).toISOString();

type Options = { cookie?: string; method?: string; source?: string; body?: unknown };

function request(path: string, options: Options = {}) {
  const headers = new Headers({ Origin: options.source ?? origin });
  if (options.cookie) headers.set("Cookie", options.cookie);
  if (options.body !== undefined) headers.set("Content-Type", "application/json");
  return new Request(origin + path, {
    method: options.method ?? "GET", headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
}

function cookieOf(response: Response, kind: string) {
  return response.headers.get("Set-Cookie")?.match(new RegExp(`(__Host-kdp_rhythm_${kind}=[^;,]+)`))?.[1] ?? "";
}

/** 合成上游：只有 `busyDates` 里的日子有工作机样本与家中心跳，其余日子什么都没有。 */
function harness(busyDates: string[]) {
  const rowsFor = (pathname: string): unknown[] => {
    if (pathname === UPSTREAM_HOME_DEVICES_PATH) return [{ device_id: "dev-a", vendor: "示例厂商", name: "示例手机", room: null }];
    if (pathname === UPSTREAM_ACTIVITY_SAMPLES_PATH) {
      return busyDates.flatMap(date => Array.from({ length: 30 }, (_, minute) => ({
        sampled_at: stamp(date, 9, minute), net: "office", idle_sec: 10, locked: 0,
        key_idle_sec: 10, pointer_idle_sec: 10, app_name: "示例编辑器",
      })));
    }
    if (pathname === UPSTREAM_HOME_HEARTBEATS_PATH) {
      return busyDates.map(date => ({ observed_at: stamp(date, 8), scan_ok: 1, device_count: 3 }));
    }
    if (pathname === UPSTREAM_HOME_SNAPSHOTS_PATH) {
      return busyDates.map(date => ({ device_id: "dev-a", observed_at: stamp(date, 8), status: "online", room: null }));
    }
    return [];
  };
  const statusRead = vi.fn(async (input: RequestInfo | URL) => {
    const url = new URL(String(input));
    return Response.json({ ok: true, resource: url.pathname, rows: rowsFor(url.pathname) });
  });
  const central = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const req = new Request(input, init);
    const body = await req.json() as Record<string, unknown>;
    if (req.url.endsWith("/exchange")) {
      return Response.json({ subject: "kdp-owner", session_ref: "synthetic-owner-session", expires_at: Date.now() + 86400_000 });
    }
    if (req.url.endsWith("/session")) {
      return Response.json(body.session_ref === "synthetic-owner-session"
        ? { active: true, subject: "kdp-owner", expires_at: Date.now() + 86400_000 } : { active: false });
    }
    return Response.json({ ok: true });
  });
  const bindings: Env = {
    ...env, SSO_ENABLED: "1", AUTH_CLIENT_ID: "rhythm", AUTH_CLIENT_SECRET: "test-sso-secret",
    AUTH_ORIGIN: "https://auth.codepi.app",
    AUTH: { fetch: central } as unknown as Fetcher,
    STATUS_READ: { fetch: statusRead } as unknown as Fetcher,
  };
  const send = (path: string, options: Options = {}) => worker.fetch(request(path, options), bindings);
  async function login() {
    const started = await send("/api/auth/login?return=%2F");
    const state = new URL(started.headers.get("Location")!).searchParams.get("state");
    const callback = await send(`/api/auth/callback?code=synthetic&state=${state}`, { cookie: cookieOf(started, "transaction") });
    return cookieOf(callback, "session");
  }
  const upstreamCalls = (pathname: string) =>
    statusRead.mock.calls.filter(([input]) => new URL(String(input)).pathname === pathname).length;
  return { send, login, bindings, statusRead, upstreamCalls };
}

const validSettings = {
  subject_device_ids: ["dev-a"],
  app_categories: { "示例编辑器": "开发", "1Password": "其他" },
  other_network_names: { "net-a": "示例网络" },
  anomaly_thresholds: { early_late_minutes: 40, commute_percent: 50 },
};

describe("P4 接口", () => {
  it("历史日没有汇总时返回完整结构且指标为未知；重算后返回已存汇总", async () => {
    const day = daysAgo(3);
    const h = harness([day]);
    const cookie = await h.login();
    const missing = await (await h.send(`/api/day?date=${day}`, { cookie })).json() as Record<string, any>;
    expect(missing).toMatchObject({ date: day, missing: true, segments: [], moments: [], workBlocks: [], appBreakdown: [] });
    expect(missing.metrics.officeActiveMinutes).toBeNull();
    expect(missing.metrics.focus).toEqual({ segmentCount: null, totalMinutes: null, longestMinutes: null, communicationInterruptions: null });
    expect(missing.metrics.coverage.ratio).toBeNull();
    expect(missing.metrics.afterWorkWorkMachineMinutes).toBeNull();
    expect(missing.metrics.appCategoryMinutes).toEqual({});
    expect(["workday", "restday"]).toContain(missing.metrics.dayType);
    expect(missing.freshness.home.status).toBe("missing");
    expect(missing.keyboardMouseMinutes).toEqual({ keyboard: null, pointer: null, both: null });

    const recompute = await h.send(`/api/admin/recompute?from=${day}&to=${day}`, { cookie, method: "POST" });
    expect(recompute.status).toBe(200);
    const stored = await (await h.send(`/api/day?date=${day}`, { cookie })).json() as Record<string, any>;
    expect(stored.missing).toBe(false);
    expect(stored.segments.length).toBeGreaterThan(0);
    expect(stored.workBlocks.length).toBeGreaterThan(0);
    expect(stored.workBlocks[0].appsKind).toBe("none");
    expect(stored.workBlocks[0].apps).toEqual([]);
    expect(stored.metrics.officeActiveMinutes).toBeGreaterThan(0);
  });

  it("按 8 天分块重算时，没数据的日子指标是 null，不会被同块其他日子的数据算成 0", async () => {
    const busy = daysAgo(10), quiet = daysAgo(9);
    const h = harness([busy]);
    const cookie = await h.login();
    const response = await h.send(`/api/admin/recompute?from=${busy}&to=${daysAgo(1)}`, { cookie, method: "POST" });
    expect(await response.json()).toMatchObject({ days_recomputed: 10 });
    expect(h.upstreamCalls(UPSTREAM_ACTIVITY_SAMPLES_PATH)).toBe(5);   // 10 天 → 每块 2 天，共 5 块
    const busyRow = await env.DB.prepare("SELECT office_active_minutes, focus_segment_count FROM daily_metrics WHERE date=?").bind(busy).first();
    const quietRow = await env.DB.prepare("SELECT office_active_minutes, focus_segment_count, after_work_work_machine_minutes FROM daily_metrics WHERE date=?").bind(quiet).first();
    expect(busyRow?.office_active_minutes).toBeGreaterThan(0);
    expect(quietRow).toEqual({ office_active_minutes: null, focus_segment_count: null, after_work_work_machine_minutes: null });

    // 重复重算结果不变（幂等）
    await h.send(`/api/admin/recompute?from=${busy}&to=${busy}`, { cookie, method: "POST" });
    const again = await env.DB.prepare("SELECT office_active_minutes FROM daily_metrics WHERE date=?").bind(busy).first();
    expect(again?.office_active_minutes).toBe(busyRow?.office_active_minutes);
  });

  it("手动重算的鉴权、同源、范围与「不含今天」", async () => {
    const h = harness([]);
    expect((await h.send(`/api/admin/recompute?from=${daysAgo(2)}&to=${daysAgo(1)}`, { method: "POST" })).status).toBe(401);
    const cookie = await h.login();
    expect((await h.send(`/api/admin/recompute?from=${daysAgo(2)}&to=${daysAgo(1)}`,
      { cookie, method: "POST", source: "https://evil.test" })).status).toBe(403);
    expect((await h.send(`/api/admin/recompute?from=${daysAgo(1)}&to=${today}`, { cookie, method: "POST" })).status).toBe(400);
    expect((await h.send(`/api/admin/recompute?from=${daysAgo(40)}&to=${daysAgo(1)}`, { cookie, method: "POST" })).status).toBe(400);
    expect((await h.send(`/api/admin/recompute?from=${daysAgo(1)}&to=${daysAgo(2)}`, { cookie, method: "POST" })).status).toBe(400);
    const ok = await h.send(`/api/admin/recompute?from=${daysAgo(2)}&to=${daysAgo(1)}`, { cookie, method: "POST" });
    expect(await ok.json()).toMatchObject({ days_recomputed: 2 });
    const todayRow = await env.DB.prepare("SELECT date FROM daily_metrics WHERE date=?").bind(today).first();
    expect(todayRow).toBeNull();
  });

  it("设置：保存、读回、标记与消费待重算，拒收非法、跨站与未知设备", async () => {
    const day = daysAgo(3);
    const h = harness([day]);
    const cookie = await h.login();
    await h.send(`/api/admin/recompute?from=${day}&to=${day}`, { cookie, method: "POST" });

    const saved = await h.send("/api/settings", { cookie, method: "PUT", body: validSettings });
    expect(saved.status).toBe(200);
    const body = await saved.json() as Record<string, any>;
    expect(body.subject_device_ids).toEqual(["dev-a"]);
    expect(body.pending_recompute_days).toEqual({ days: 1, from: day, to: day });
    expect(body.device_candidates).toEqual([{ device_id: "dev-a", vendor: "示例厂商", name: "示例手机", room: null }]);

    const read = await (await h.send("/api/settings", { cookie })).json() as Record<string, any>;
    expect(read.app_categories).toEqual(validSettings.app_categories);
    expect(read.other_network_names).toEqual(validSettings.other_network_names);

    await h.send(`/api/admin/recompute?from=${day}&to=${day}`, { cookie, method: "POST" });
    const after = await (await h.send("/api/settings", { cookie })).json() as Record<string, any>;
    expect(after.pending_recompute_days.days).toBe(0);

    expect((await h.send("/api/settings", { cookie, method: "PUT", body: { ...validSettings, extra: 1 } })).status).toBe(400);
    expect((await h.send("/api/settings", { cookie, method: "PUT",
      body: { ...validSettings, other_network_names: { "net-a": "sk-test-secret-value" } } })).status).toBe(400);
    expect((await h.send("/api/settings", { cookie, method: "PUT",
      body: { ...validSettings, subject_device_ids: ["dev-unknown"] } })).status).toBe(400);
    expect((await h.send("/api/settings", { cookie, method: "PUT", body: validSettings, source: "https://evil.test" })).status).toBe(403);
    expect((await h.send("/api/settings", { method: "PUT", body: validSettings })).status).toBe(401);
  });

  it("趋势、异常与可信度：缺失日不当 0，end 为今天时今天实时计算且不落库", async () => {
    const busy = [daysAgo(3), daysAgo(2)];
    const h = harness([...busy, today]);
    const cookie = await h.login();
    await h.send(`/api/admin/recompute?from=${daysAgo(6)}&to=${daysAgo(1)}`, { cookie, method: "POST" });

    const trends = await (await h.send("/api/trends?range=7", { cookie })).json() as Record<string, any>;
    expect(trends.to).toBe(daysAgo(1));
    expect(trends.days).toHaveLength(7);
    expect(trends.days_available).toBe(6);
    expect(trends.days[0]).toMatchObject({ missing: true, metrics: null });
    // 按周对比两边天数对等：上周只取到与本周同一个星期几
    const span = (from: string, to: string) => Math.round((Date.parse(to) - Date.parse(from)) / 86400_000);
    const week = trends.week_comparison;
    expect(span(week.previous_from, week.previous_to)).toBe(span(week.current_from, trends.to));

    const withToday = await (await h.send(`/api/trends?range=7&end=${today}`, { cookie })).json() as Record<string, any>;
    expect(withToday.days.at(-1)).toMatchObject({ date: today, missing: false, partial: true });
    // 今天没过完，不进平均值：只有已过完的忙碌日参与
    const averagedDays = withToday.averages.workday.days + withToday.averages.restday.days;
    expect(averagedDays).toBe(withToday.days.filter((day: { missing: boolean; partial: boolean }) => !day.missing && !day.partial).length);
    expect(await env.DB.prepare("SELECT date FROM daily_metrics WHERE date=?").bind(today).first()).toBeNull();

    const quality = await (await h.send(`/api/quality?range=7&end=${today}`, { cookie })).json() as Record<string, any>;
    const quiet = quality.days.find((item: { date: string }) => item.date === daysAgo(5));
    expect(quiet.coverage).toBeGreaterThanOrEqual(0);
    const todayQuality = quality.days.find((item: { date: string }) => item.date === today);
    expect(todayQuality.coverage).not.toBeNull();

    const anomalies = await (await h.send("/api/anomalies?range=30", { cookie })).json() as Record<string, any>;
    expect(anomalies.baseline).toContain("之前近 30 天");
    expect(anomalies.anomalies).toEqual([]);
    expect(anomalies.insufficient_sample.length).toBeGreaterThan(0);

    expect((await h.send("/api/trends?range=14", { cookie })).status).toBe(400);
    expect((await h.send("/api/trends?range=7")).status).toBe(401);
  });

  it("来源页按时间范围读取上游（只读接口要求时序资源必须带 from/to）", async () => {
    const h = harness([today]);
    const cookie = await h.login();
    expect((await h.send("/api/sources", { cookie })).status).toBe(200);
    const ranged = h.statusRead.mock.calls.map(([input]) => new URL(String(input)))
      .filter(url => url.pathname !== UPSTREAM_HOME_DEVICES_PATH);
    expect(ranged.length).toBeGreaterThan(0);
    for (const url of ranged) {
      expect(url.searchParams.get("from"), url.pathname).not.toBeNull();
      expect(url.searchParams.get("to"), url.pathname).not.toBeNull();
    }
  });

  it("定时任务重算昨天及之前两天，读设置失败只记错误码", async () => {
    const h = harness([daysAgo(1)]);
    const pending: Promise<unknown>[] = [];
    const ctx = { waitUntil: (promise: Promise<unknown>) => { pending.push(promise); }, passThroughOnException() {} } as unknown as ExecutionContext;
    await worker.scheduled({} as ScheduledController, h.bindings, ctx);
    await Promise.all(pending);
    const rows = await env.DB.prepare("SELECT date FROM daily_metrics ORDER BY date").all<{ date: string }>();
    expect(rows.results.map(row => row.date)).toEqual([daysAgo(3), daysAgo(2), daysAgo(1)]);

    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    const broken = { ...h.bindings, DB: { prepare() { throw new Error("db down"); } } as unknown as D1Database };
    pending.length = 0;
    await expect(worker.scheduled({} as ScheduledController, broken, ctx)).resolves.toBeUndefined();
    await Promise.all(pending);
    expect(errors).toHaveBeenCalledWith("daily_recompute_failed");
  });
});
