import { Hono, type Handler } from "hono";
import { ssoEnabled, ssoReady, SsoError } from "@kedoupi/shared/auth/client";
import { authenticated, callback, login, logout } from "./auth";
import { AppError, isoShanghai, json, validateDate } from "./lib";
import type { Evidence, RhythmStatus, StateInput } from "./models";
import { readSettings, type RhythmSettings } from "./settings";
import { calculateDay, dayStartEpoch, minuteLabel, shanghaiDate, STATE_THRESHOLDS, STATUS_METHODS, statusLabel } from "./state";
import {
  parseActivity, parseDevices, parseEvents, parseHeartbeats, parseSnapshots, readUpstream,
  UPSTREAM_ACTIVITY_SAMPLES_PATH, UPSTREAM_HOME_DEVICES_PATH, UPSTREAM_HOME_EVENTS_PATH,
  UPSTREAM_HOME_HEARTBEATS_PATH, UPSTREAM_HOME_SNAPSHOTS_PATH,
} from "./upstream";
import type { Env } from "./types";

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
const LOOKBACK_MINUTES = 30;

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
  const start = dayStartEpoch(date);
  const end = start + 1440 * 60_000;
  const range = { from: isoShanghai(start - LOOKBACK_MINUTES * 60_000), to: isoShanghai(end) };
  const [activityRaw, devicesRaw, snapshotsRaw, eventsRaw, heartbeatsRaw] = await Promise.all([
    readUpstream(env, UPSTREAM_ACTIVITY_SAMPLES_PATH, range),
    readUpstream(env, UPSTREAM_HOME_DEVICES_PATH),
    readUpstream(env, UPSTREAM_HOME_SNAPSHOTS_PATH, range),
    readUpstream(env, UPSTREAM_HOME_EVENTS_PATH, range),
    readUpstream(env, UPSTREAM_HOME_HEARTBEATS_PATH),
  ]);
  const activity = parseActivity(activityRaw);
  const devices = parseDevices(devicesRaw);
  const snapshots = parseSnapshots(snapshotsRaw);
  const events = parseEvents(eventsRaw);
  const heartbeats = parseHeartbeats(heartbeatsRaw);
  const input: StateInput = {
    date,
    activity,
    devices,
    snapshots,
    events,
    heartbeats,
    subjectDeviceIds: settings.subjectDeviceIds,
    appCategories: settings.appCategories,
  };
  const day = calculateDay(input, now);
  const today = shanghaiDate(now);
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

get("/api/day", async c => {
  const url = new URL(c.req.url);
  const now = Date.now();
  const date = validateDate(url.searchParams.get("date"));
  if (date > shanghaiDate(now)) throw new AppError("invalid_date", 400);
  const settings = await readSettings(c.env);
  return json(await loadDay(c.env, date, settings, now));
});

get("/api/sources", async c => {
  const now = Date.now();
  const settings = await readSettings(c.env);
  const range = { from: isoShanghai(now - 24 * 60 * 60 * 1000), to: isoShanghai(now) };
  const [activityRaw, heartbeatsRaw] = await Promise.all([
    readUpstream(c.env, UPSTREAM_ACTIVITY_SAMPLES_PATH, range),
    readUpstream(c.env, UPSTREAM_HOME_HEARTBEATS_PATH),
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

app.on(["GET", "HEAD"], ["/", "/trend", "/sources", "/login"], async c => {
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
