import { Hono, type Handler } from "hono";
import { ssoEnabled, ssoReady, SsoError } from "@kedoupi/shared/auth/client";
import { authenticated, callback, login, logout } from "./auth";
import { AppError, isoShanghai, json, validateDate } from "./lib";
import type { Evidence, RhythmStatus } from "./models";
import {
  parseSettingsUpdate, publicSettings, readPendingRecompute, readSettings, saveSettings, type RhythmSettings,
} from "./settings";
import { calculateDay, dayStartEpoch, minuteLabel, shanghaiDate, STATE_THRESHOLDS, STATUS_METHODS, statusLabel } from "./state";
import {
  parseActivity, parseDevices, parseHeartbeats, readUpstream, UPSTREAM_ACTIVITY_SAMPLES_PATH, UPSTREAM_HOME_DEVICES_PATH,
  UPSTREAM_HOME_HEARTBEATS_PATH,
} from "./upstream";
import type { Env } from "./types";
import { dateDistance, dateOffset, loadStateInput, recomputeRange } from "./recompute";
import { calculateDailyMetrics, DAILY_ALGORITHM_VERSION, dayType, readDailyMetrics, readDailyMetricsRange, readDailyStatus } from "./daily";
import {
  ANOMALY_BASELINE, ANOMALY_BASELINE_DAYS, averageAllMetrics, averageMetrics, findAnomalies, qualityDays, trendDays, weekStart,
} from "./analysis";
import type { DailyMetricsRow } from "./models";

type AppEnv = { Bindings: Env };

export const RHYTHM_CAVEATS = [
  "设备在线不等于人在。",
  "手机落在家、工作机被远程操作都会让结论偏。",
  "通勤是推断值，含出门前和到公司后没开电脑的时间。",
  "起床和回卧室只是手机换了房间，不等于真的醒了或睡了。",
  "专注与 App 时长是分钟采样近似值，不是精确计时。",
];

export const RHYTHM_COLLECTION = [
  "不采集键盘内容、鼠标轨迹、屏幕画面、窗口标题、网址。",
  "不采集通话内容，手机也不安装额外软件。",
  "不上云完整硬件地址、IP、网关与 BSSID。",
];

const HOME_SOURCE_FRESH_MINUTES = 10;
export const app = new Hono<AppEnv>({ getPath: request => new URL(request.url).pathname });

export function errorResponse(error: unknown) {
  if (error instanceof SsoError) return json({ error: error.code }, error.status);
  if (error instanceof AppError) return json({ error: error.code }, error.status);
  console.error("rhythm_request_failed");
  return json({ error: "internal_error" }, 500);
}

app.onError(errorResponse);

function get(path: string, handler: Handler<AppEnv>) {
  app.get(path, (c, next) => c.req.method === "GET" ? handler(c, next) : next());
}

app.use("*", async (c, next) => {
  const url = new URL(c.req.url);
  if (url.protocol !== "https:" && !(["development", "test"].includes(c.env.ENVIRONMENT ?? "")
    && ["localhost", "[::1]"].includes(url.hostname))) return json({ error: "https_required" }, 403);
  await next();
});

get("/api/health", async c => {
  const ready = await ssoReady(c.env);
  return json({ ok: ready, source: "rhythm", build: c.env.BUILD_SHA || "local",
    sso_enabled: ssoEnabled(c.env), sso_ready: ready }, ready ? 200 : 503);
});

get("/api/auth/login", c => login(c.req.raw, c.env));
get("/api/auth/callback", c => callback(c.req.raw, c.env));

app.use("*", async (c, next) => {
  if (["POST", "PUT", "PATCH", "DELETE"].includes(c.req.method) && c.req.header("Origin") !== new URL(c.req.url).origin) {
    return json({ error: "origin_not_allowed" }, 403);
  }
  await next();
});

app.post("/api/auth/logout", c => logout(c.req.raw, c.env));

app.use("/api/*", async (c, next) => {
  if (!await authenticated(c.req.raw, c.env)) return json({ error: "unauthorized", authenticated: false }, 401);
  await next();
});

get("/api/me", () => json({ authenticated: true }));

type Freshness = { latestAt: string | null; ageMinutes: number | null; status: "fresh" | "stale" | "missing" | "time_anomaly" };

export function freshnessOf(
  latest: string | null,
  now: number,
  freshMinutes: number = STATE_THRESHOLDS.activityFreshnessMinutes,
): Freshness {
  if (!latest) return { latestAt: null, ageMinutes: null, status: "missing" };
  const at = Date.parse(latest);
  if (Number.isFinite(at) && at > now + STATE_THRESHOLDS.futureTimestampToleranceSeconds * 1000) {
    return { latestAt: latest, ageMinutes: null, status: "time_anomaly" };
  }
  const ageMinutes = Number.isFinite(at) ? Math.max(0, Math.round((now - at) / 60_000)) : null;
  const status: Freshness["status"] = ageMinutes !== null && ageMinutes <= freshMinutes ? "fresh" : "stale";
  return { latestAt: latest, ageMinutes, status };
}

function latestTimestamp(rows: Array<{ at: string }>): string | null {
  let latest: string | null = null, latestAt = -Infinity;
  for (const row of rows) {
    const at = Date.parse(row.at);
    if (Number.isFinite(at) && at > latestAt) { latestAt = at; latest = row.at; }
  }
  return latest;
}

function latestOf(values: Array<string | null>): string | null {
  let latest: string | null = null, latestAt = -Infinity;
  for (const value of values) {
    if (!value) continue;
    const at = Date.parse(value);
    if (Number.isFinite(at) && at > latestAt) { latestAt = at; latest = value; }
  }
  return latest;
}

export function displayShanghaiTime(value: string | null): string | null {
  if (!value) return null;
  const at = Date.parse(value);
  if (!Number.isFinite(at)) return null;
  const parts = new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai",
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(at);
  const get = (type: Intl.DateTimeFormatPartTypes) => parts.find(part => part.type === type)?.value ?? "";
  return `${get("month")} 月 ${get("day")} 日 ${get("hour")}:${get("minute")}`;
}

async function loadDay(env: Env, date: string, settings: RhythmSettings, now: number) {
  const input = await loadStateInput(env, date, settings);
  const { activity, heartbeats, snapshots } = input;
  const day = calculateDay(input, now);
  const today = shanghaiDate(now);
  const start = dayStartEpoch(date);
  const currentMinute = today === date
    ? Math.min(1439, Math.max(0, Math.floor((now - start) / 60_000)))
    : -1;
  let fallbackMinute = -1;
  for (let minute = 1439; minute >= 0; minute--) {
    if (day.minuteStatuses[minute] !== "unknown" && day.minuteStatuses[minute] !== "not_arrived") {
      fallbackMinute = minute;
      break;
    }
  }
  const minute = currentMinute >= 0 ? currentMinute : fallbackMinute;
  const current = minute >= 0 ? {
    status: day.minuteStatuses[minute],
    evidence: day.minuteEvidence[minute],
    label: statusLabel(day.minuteStatuses[minute]),
    minute,
    time: minuteLabel(minute),
    live: currentMinute >= 0,
  } : null;
  const workLatest = latestTimestamp(activity.map(row => ({ at: row.sampled_at })));
  const homeLatest = latestOf([
    latestTimestamp(heartbeats.map(row => ({ at: row.observed_at }))),
    latestTimestamp(snapshots.map(row => ({ at: row.observed_at }))),
  ]);
  return {
    date,
    timezone: "Asia/Shanghai",
    generatedAt: new Date(now).toISOString(),
    phoneConfigured: settings.subjectDeviceIds.length > 0,
    current,
    segments: day.segments.map(segment => ({
      status: segment.status,
      label: statusLabel(segment.status),
      evidence: segment.evidence,
      detail: day.minuteDetails[segment.startMinute] ?? "",
      startMinute: segment.startMinute,
      endMinute: segment.endMinute,
      startLabel: minuteLabel(segment.startMinute),
      endLabel: minuteLabel(segment.endMinute),
      minutes: segment.endMinute - segment.startMinute + 1,
    })),
    moments: day.moments.map(moment => ({
      kind: moment.kind,
      label: moment.label,
      detail: moment.detail,
      evidence: moment.evidence,
      minute: moment.minute,
      time: minuteLabel(moment.minute),
    })),
    metrics: day.metrics,
    appBreakdown: day.appBreakdown.map(item => ({
      category: item.category,
      minutes: item.minutes,
      share: item.share,
      apps: item.apps,
    })),
    keyboardMouseMinutes: day.keyboardMouseMinutes,
    freshness: {
      home: freshnessOf(homeLatest, now, HOME_SOURCE_FRESH_MINUTES),
      work: freshnessOf(workLatest, now, STATE_THRESHOLDS.activityFreshnessMinutes),
    },
    thresholds: STATE_THRESHOLDS,
  };
}

/** 缺失日的完整指标结构：标量为 null（未知），集合为空对象，不能被当成 0。 */
function emptyDayMetrics(date: string) {
  return {
    commuteToWorkMinutes: null, commuteHomeMinutes: null, officeActiveMinutes: null, homeMinutes: null,
    bedroomMinutes: null, livingRoomMinutes: null, homeUnknownMinutes: null,
    statusMinutes: {},
    wakeMinute: null, leaveHomeMinute: null, startWorkMinute: null,
    leaveComputerMinute: null, arriveHomeMinute: null, returnBedroomMinute: null,
    officeSpanMinutes: null,
    focus: { segmentCount: null, totalMinutes: null, longestMinutes: null, communicationInterruptions: null },
    afterWorkWorkMachineMinutes: null, weekendWorkMachineMinutes: null,
    afterWorkRoomMinutes: {}, weekendRoomMinutes: {},
    appCategoryMinutes: {}, hourlyAppCategoryMinutes: {},
    topAppName: null, topAppMinutes: null,
    otherNetworkMinutes: {},
    coverage: { ratio: null, gapReasonMinutes: {} },
    dayType: dayType(date),
  };
}

/** 历史日还没有汇总：保持和正常响应相同的结构，所有指标为 null（未知），由页面显示「还没有汇总」。 */
function missingStoredDay(date: string, settings: RhythmSettings) {
  return {
    date,
    timezone: "Asia/Shanghai",
    missing: true,
    generatedAt: null,
    phoneConfigured: settings.subjectDeviceIds.length > 0,
    current: null,
    computedAt: null,
    segments: [],
    moments: [],
    metrics: emptyDayMetrics(date),
    appBreakdown: [],
    keyboardMouseMinutes: { keyboard: null, pointer: null, both: null },
    freshness: {
      home: { latestAt: null, ageMinutes: null, status: "missing" as const },
      work: { latestAt: null, ageMinutes: null, status: "missing" as const },
    },
    thresholds: STATE_THRESHOLDS,
  };
}

async function loadStoredDay(env: Env, date: string, settings: RhythmSettings) {
  const [status, metrics] = await Promise.all([readDailyStatus(env, date), readDailyMetrics(env, date)]);
  if (!status || !metrics) return missingStoredDay(date, settings);
  const categoryEntries = Object.entries(metrics.metrics.appCategoryMinutes)
    .filter(([, minutes]) => minutes > 0)
    .sort(([, left], [, right]) => right - left);
  const categoryTotal = categoryEntries.reduce((sum, [, minutes]) => sum + minutes, 0);
  const momentFields = [
    ["wakeMinute", "起床", "seen"],
    ["leaveHomeMinute", "离家", "inferred"],
    ["startWorkMinute", "开始办公", "seen"],
    ["leaveComputerMinute", "离开电脑", "inferred"],
    ["arriveHomeMinute", "到家", "seen"],
    ["returnBedroomMinute", "回卧室", "seen"],
  ] as const;
  return {
    date,
    timezone: "Asia/Shanghai",
    missing: false,
    generatedAt: metrics.computedAt,
    phoneConfigured: settings.subjectDeviceIds.length > 0,
    current: null,
    computedAt: metrics.computedAt,
    segments: status.segments.map(segment => ({
      status: segment.status,
      label: statusLabel(segment.status),
      evidence: segment.evidence,
      detail: "",
      startMinute: segment.startMinute,
      endMinute: segment.endMinute,
      startLabel: minuteLabel(segment.startMinute),
      endLabel: minuteLabel(segment.endMinute),
      minutes: segment.endMinute - segment.startMinute + 1,
    })),
    moments: momentFields.flatMap(([field, label, evidence]) => {
      const minute = metrics.metrics[field];
      return minute === null ? [] : [{
        kind: field.replace("Minute", "").replace("leaveHome", "leave_home")
          .replace("startWork", "start_work").replace("leaveComputer", "leave_computer")
          .replace("arriveHome", "arrive_home").replace("returnBedroom", "return_bedroom"),
        label,
        detail: `${minuteLabel(minute)} 来自每日汇总`,
        evidence,
        minute,
        time: minuteLabel(minute),
      }];
    }),
    metrics: metrics.metrics,
    appBreakdown: categoryEntries.map(([category, minutes]) => ({
      category,
      minutes,
      share: categoryTotal > 0 ? minutes / categoryTotal : 0,
      apps: [],
    })),
    keyboardMouseMinutes: { keyboard: null, pointer: null, both: null },
    freshness: {
      home: { latestAt: null, ageMinutes: null, status: "missing" as const },
      work: { latestAt: null, ageMinutes: null, status: "missing" as const },
    },
    thresholds: STATE_THRESHOLDS,
  };
}

function deviceCandidates(rawDevices: unknown[]) {
  return parseDevices(rawDevices).map(device => ({
    device_id: device.device_id,
    vendor: device.vendor ?? null,
    name: device.name ?? null,
    room: device.room ?? null,
  }));
}

get("/api/day", async c => {
  const url = new URL(c.req.url);
  const now = Date.now();
  const date = validateDate(url.searchParams.get("date"));
  if (date > shanghaiDate(now)) throw new AppError("invalid_date", 400);
  const settings = await readSettings(c.env);
  if (dateDistance(date, shanghaiDate(now)) > 1) return json(await loadStoredDay(c.env, date, settings));
  return json(await loadDay(c.env, date, settings, now));
});

/**
 * 读取 [from, end] 的每日汇总；end 是今天时，今天那一行按需实时计算（只算到现在），不落库。
 */
async function metricsRows(env: Env, from: string, end: string, settings: RhythmSettings): Promise<DailyMetricsRow[]> {
  const now = Date.now();
  const today = shanghaiDate(now);
  const stored = await readDailyMetricsRange(env, from, end < today ? end : dateOffset(today, -1));
  if (end < today || from > today) return stored;
  const { metrics } = calculateDailyMetrics(await loadStateInput(env, today, settings), now);
  return [...stored, { date: today, metrics, computedAt: new Date(now).toISOString(), version: DAILY_ALGORITHM_VERSION }];
}

function rangeBounds(url: URL, defaultRange: 7 | 30 = 7) {
  const rawRange = url.searchParams.get("range");
  const range = rawRange === null ? defaultRange : Number(rawRange);
  if (range !== 7 && range !== 30) throw new AppError("invalid_range", 400);
  const today = shanghaiDate(Date.now());
  const end = url.searchParams.has("end")
    ? validateDate(url.searchParams.get("end"))
    : dateOffset(today, -1);
  if (end > today) throw new AppError("invalid_date", 400);
  return { range, end, from: dateOffset(end, -(range - 1)) };
}

get("/api/trends", async c => {
  const bounds = rangeBounds(new URL(c.req.url));
  const comparisonFrom = dateOffset(weekStart(bounds.end), -7);
  const rows = await metricsRows(c.env, comparisonFrom, bounds.end, await readSettings(c.env));
  const selectedRows = rows.filter(row => row.date >= bounds.from);
  // 今天还没过完：只在逐日列表里展示，不进平均值与按周对比。
  const today = shanghaiDate(Date.now());
  const completeRows = selectedRows.filter(row => row.date < today);
  const currentWeekFrom = weekStart(bounds.end);
  const currentWeek = completeRows.filter(row => row.date >= currentWeekFrom);
  // 本周没过完时，上周也只取到同一个星期几，两边天数对等。
  const previousTo = dateOffset(comparisonFrom, dateDistance(currentWeekFrom, bounds.end));
  const previousWeek = rows.filter(row => row.date >= comparisonFrom && row.date <= previousTo);
  return json({
    range: bounds.range,
    from: bounds.from,
    to: bounds.end,
    days_available: selectedRows.length,
    days: trendDays(bounds.from, bounds.end, selectedRows).map(day => ({ ...day, partial: day.date === today })),
    averages: {
      workday: averageMetrics(completeRows, "workday"),
      restday: averageMetrics(completeRows, "restday"),
    },
    week_comparison: {
      current: averageAllMetrics(currentWeek),
      previous: averageAllMetrics(previousWeek),
      current_from: currentWeekFrom,
      previous_from: comparisonFrom,
      previous_to: previousTo,
    },
  });
});

get("/api/anomalies", async c => {
  const bounds = rangeBounds(new URL(c.req.url), 30);
  const settings = await readSettings(c.env);
  // 基线要用到区间之前 30 天的同类日。
  // 异常只判断已经过完的日子：今天的时刻和通勤还没定型，容易误报。
  const lastComplete = bounds.end < shanghaiDate(Date.now()) ? bounds.end : dateOffset(shanghaiDate(Date.now()), -1);
  const rows = await metricsRows(c.env, dateOffset(bounds.from, -ANOMALY_BASELINE_DAYS), lastComplete, settings);
  const result = findAnomalies(rows, settings.anomalyThresholds, bounds.from);
  return json({
    range: bounds.range,
    from: bounds.from,
    to: bounds.end,
    baseline: ANOMALY_BASELINE,
    days_available: rows.filter(row => row.date >= bounds.from).length,
    anomalies: result.anomalies,
    insufficient_sample: result.insufficientSample,
  });
});

get("/api/quality", async c => {
  const bounds = rangeBounds(new URL(c.req.url), 30);
  const rows = await metricsRows(c.env, bounds.from, bounds.end, await readSettings(c.env));
  return json({
    range: bounds.range,
    from: bounds.from,
    to: bounds.end,
    days_available: rows.length,
    days: qualityDays(trendDays(bounds.from, bounds.end, rows)),
  });
});

get("/api/settings", async c => {
  const [settings, rawDevices, pending] = await Promise.all([
    readSettings(c.env),
    readUpstream(c.env, UPSTREAM_HOME_DEVICES_PATH),
    readPendingRecompute(c.env),
  ]);
  return json(publicSettings(settings, deviceCandidates(rawDevices), pending));
});

app.put("/api/settings", async c => {
  const rawDevices = await readUpstream(c.env, UPSTREAM_HOME_DEVICES_PATH);
  const candidates = deviceCandidates(rawDevices);
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    throw new AppError("invalid_settings", 400);
  }
  let settings;
  try {
    settings = parseSettingsUpdate(body);
  } catch {
    throw new AppError("invalid_settings", 400);
  }
  const candidateIds = new Set(candidates.map(candidate => candidate.device_id));
  if (settings.subjectDeviceIds.some(deviceId => !candidateIds.has(deviceId))) {
    throw new AppError("invalid_settings", 400);
  }
  await saveSettings(c.env, settings);
  return json(publicSettings(settings, candidates, await readPendingRecompute(c.env)));
});

app.post("/api/admin/recompute", async c => {
  const url = new URL(c.req.url);
  const from = validateDate(url.searchParams.get("from"));
  const to = validateDate(url.searchParams.get("to"));
  if (from > to || dateDistance(from, to) >= 31) throw new AppError("invalid_range", 400);
  // 只能重算到昨天：今天没过完，未到的分钟不能当缺口落库。
  if (to >= shanghaiDate(Date.now())) throw new AppError("invalid_date", 400);
  const rows = await recomputeRange(c.env, from, to, await readSettings(c.env));
  return json({ from, to, days_recomputed: rows.length });
});

get("/api/sources", async c => {
  const now = Date.now();
  const settings = await readSettings(c.env);
  const range = { from: isoShanghai(now - 24 * 60 * 60 * 1000), to: isoShanghai(now) };
  const [activityRaw, heartbeatsRaw] = await Promise.all([
    readUpstream(c.env, UPSTREAM_ACTIVITY_SAMPLES_PATH, range),
    readUpstream(c.env, UPSTREAM_HOME_HEARTBEATS_PATH, range),   // 只读接口要求时序资源必须带范围
  ]);
  const activity = parseActivity(activityRaw);
  const heartbeats = parseHeartbeats(heartbeatsRaw);
  const states: Array<{ status: RhythmStatus; label: string; method: string; evidence: Evidence }> = (
    Object.keys(STATUS_METHODS) as RhythmStatus[]
  ).map(status => ({
    status,
    label: statusLabel(status),
    method: STATUS_METHODS[status],
    evidence: status === "office_away" || status === "commute" ? "inferred" : status === "unknown" ? "no_data" : "seen",
  }));
  return json({
    timezone: "Asia/Shanghai",
    generatedAt: new Date(now).toISOString(),
    sources: {
      home: {
        name: "家中设备扫描",
        ...freshnessOf(
          latestTimestamp(heartbeats.map(row => ({ at: row.observed_at }))),
          now,
          HOME_SOURCE_FRESH_MINUTES,
        ),
        method: "家中扫描器定期采集设备心跳，用来判断手机是否在家以及在哪个房间。",
      },
      work: {
        name: "工作机采样",
        ...freshnessOf(
          latestTimestamp(activity.map(row => ({ at: row.sampled_at }))),
          now,
          STATE_THRESHOLDS.activityFreshnessMinutes,
        ),
        method: "工作机每分钟上报一次网络与键鼠空闲情况，用来判断是否在电脑前。",
      },
    },
    states,
    caveats: RHYTHM_CAVEATS,
    collection: RHYTHM_COLLECTION,
    settings: {
      subjectDeviceCount: settings.subjectDeviceIds.length,
      appCategoryCount: Object.keys(settings.appCategories).length,
    },
    thresholds: STATE_THRESHOLDS,
  });
});

app.use("*", async (c, next) => {
  if (c.req.path.startsWith("/api/")) return json({ error: "not_found" }, 404);
  if (!["GET", "HEAD"].includes(c.req.method)) return new Response("Method not allowed", { status: 405 });
  await next();
});

app.get("/robots.txt", () => new Response("User-agent: *\nDisallow: /\n"));

app.on(["GET", "HEAD"], ["/", "/trend", "/sources", "/settings", "/login"], async c => {
  const origin = new URL(c.req.url).origin;
  if (c.req.path !== "/login" && !await authenticated(c.req.raw, c.env)) {
    return Response.redirect(`${origin}/login?return=${encodeURIComponent(c.req.path)}`, 302);
  }
  return c.env.ASSETS?.fetch(new Request(`${origin}/`, { method: c.req.method }))
    ?? new Response("Assets unavailable", { status: 503 });
});

const PUBLIC_BRAND_ASSETS = new Set([
  "/favicon.ico",
  "/favicon-16.png",
  "/favicon-32.png",
  "/apple-touch-icon.png",
  "/brand/codepi-symbol.png",
  "/brand/codepi-symbol.webp",
]);

app.get("*", c => {
  if (/^\/assets\/[a-zA-Z0-9_.-]+\.(?:js|css|svg|png|webp|woff2)$/.test(c.req.path) || PUBLIC_BRAND_ASSETS.has(c.req.path)) {
    return c.env.ASSETS?.fetch(c.req.raw) ?? c.notFound();
  }
  return c.notFound();
});
