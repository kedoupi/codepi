import { Hono, type Handler } from "hono";
import { ssoEnabled, ssoReady, SsoError } from "@kedoupi/shared/auth/client";
import { authenticated, callback, login, logout } from "./auth";
import { AppError, isoShanghai, json, validateDate } from "./lib";
import { APP_CATEGORIES, type AppCategory, type DayComputation, type Evidence, type RhythmStatus } from "./models";
import {
  DEFAULT_ANOMALY_THRESHOLDS, parseSettingsUpdate, publicSettings, readPendingRecompute, readSettings, saveSettings, type RhythmSettings,
} from "./settings";
import { buildStoredWorkBlocks, calculateDay, currentStatusLookbackMinutes, dayStartEpoch, minuteLabel, shanghaiDate, STATE_THRESHOLDS, STATUS_METHODS, statusLabel } from "./state";
import {
  parseActivity, parseDevices, parseHeartbeats, readUpstream, UPSTREAM_ACTIVITY_SAMPLES_PATH, UPSTREAM_HOME_DEVICES_PATH,
  UPSTREAM_HOME_HEARTBEATS_PATH,
} from "./upstream";
import type { Env } from "./types";
import { dateDistance, dateOffset, loadStateInput, recomputeRange } from "./recompute";
import { calculateDailyMetrics, DAILY_ALGORITHM_VERSION, dayType, readDailyMetrics, readDailyMetricsRange, readDailyStatus, readDailyStatusRange, workAvailability } from "./daily";
import {
  ANOMALY_BASELINE, ANOMALY_BASELINE_DAYS, averageAllMetrics, averageMetrics, findAnomalies, qualityDays, trendDays, weekStart,
} from "./analysis";
import type { DailyMetricsRow, DailyStatusRow } from "./models";
import type { WorkAvailability } from "./daily";

type AppEnv = { Bindings: Env };

export const RHYTHM_CAVEATS = [
  "设备在线不等于人在。",
  "手机落在家、工作机被远程操作都会让结论偏。",
  "通勤是推断值，含出门前和到公司后没开电脑的时间。",
  "起床和回卧室只是手机换了房间，不等于真的醒了或睡了。",
  "早期在家时段由手机上线 / 离线事件区间推断，m1 停机期间可能被误算为在家。",
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

export function selectCurrentStatus(day: DayComputation, currentMinute: number): { minute: number; statusMinute: number | null } | null {
  let fallbackMinute = -1;
  for (let minute = 1439; minute >= 0; minute--) {
    if (day.minuteStatuses[minute] !== "unknown" && day.minuteStatuses[minute] !== "not_arrived") {
      fallbackMinute = minute;
      break;
    }
  }
  if (currentMinute < 0) return fallbackMinute >= 0 ? { minute: fallbackMinute, statusMinute: fallbackMinute } : null;
  const statusMinute = Array.from({ length: currentStatusLookbackMinutes + 1 }, (_, offset) => currentMinute - offset)
    .find(candidate => candidate >= 0 && day.minuteEvidence[candidate] !== "no_data" && day.minuteEvidence[candidate] !== "not_arrived");
  return { minute: currentMinute, statusMinute: statusMinute ?? null };
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
  const selection = selectCurrentStatus(day, currentMinute);
  const current = selection ? (() => {
    const statusMinute = selection.statusMinute ?? selection.minute;
    return {
      status: day.minuteStatuses[statusMinute],
      evidence: day.minuteEvidence[statusMinute],
      label: statusLabel(day.minuteStatuses[statusMinute]),
      minute: selection.minute,
      time: minuteLabel(selection.minute),
      asOf: selection.statusMinute === null ? null : minuteLabel(selection.statusMinute),
      live: currentMinute >= 0,
    };
  })() : null;
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
    workBlocks: day.workBlocks.map(block => ({
      ...block,
      startLabel: minuteLabel(block.startMinute),
      endLabel: minuteLabel(block.endMinute),
    })),
    metrics: day.metrics,
    appBreakdown: day.appBreakdown.map(item => ({
      category: item.category,
      minutes: item.minutes,
      share: item.share,
      apps: item.apps,
    })),
    meetingAppBreakdown: (day.meetingAppBreakdown ?? []).map(item => ({
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
    commuteToWorkMinutes: null, commuteHomeMinutes: null, officeActiveMinutes: null, officeMeetingMinutes: null, homeMinutes: null,
    bedroomMinutes: null, livingRoomMinutes: null, homeUnknownMinutes: null,
    statusMinutes: {},
    wakeMinute: null, leaveHomeMinute: null, startWorkMinute: null,
    leaveComputerMinute: null, arriveHomeMinute: null, returnBedroomMinute: null,
    officeSpanMinutes: null, meetingSessions: null,
    focus: { segmentCount: null, totalMinutes: null, longestMinutes: null, communicationInterruptions: null, segments: null },
    afterWorkWorkMachineMinutes: null, weekendWorkMachineMinutes: null,
    afterWorkRoomMinutes: {}, weekendRoomMinutes: {},
    appCategoryMinutes: {}, meetingAppCategoryMinutes: {}, hourlyAppCategoryMinutes: {},
    appMinutes: {}, meetingAppMinutes: null, hourlyActiveMinutes: {}, hourlySwitchCounts: {}, focusSegments: null,
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
    workBlocks: [],
    metrics: emptyDayMetrics(date),
    appBreakdown: [],
    meetingAppBreakdown: [],
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
  if (!status || !metrics || status.version !== DAILY_ALGORITHM_VERSION || metrics.version !== DAILY_ALGORITHM_VERSION
    || typeof metrics.metrics.statusMinutes.office_meeting !== "number") return missingStoredDay(date, settings);
  const categoryEntries = Object.entries(metrics.metrics.appCategoryMinutes)
    .filter(([, minutes]) => minutes > 0)
    .sort(([, left], [, right]) => right - left);
  const categoryTotal = categoryEntries.reduce((sum, [, minutes]) => sum + minutes, 0);
  const meetingCategoryEntries = Object.entries(metrics.metrics.meetingAppCategoryMinutes ?? {})
    .filter(([, minutes]) => minutes > 0)
    .sort(([, left], [, right]) => right - left);
  const meetingCategoryTotal = meetingCategoryEntries.reduce((sum, [, minutes]) => sum + minutes, 0);
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
    workBlocks: buildStoredWorkBlocks(status.segments),
    metrics: metrics.metrics,
    appBreakdown: categoryEntries.map(([category, minutes]) => ({
      category,
      minutes,
      share: categoryTotal > 0 ? minutes / categoryTotal : 0,
      apps: [],
    })),
    meetingAppBreakdown: meetingCategoryEntries.map(([category, minutes]) => ({
      category,
      minutes,
      share: meetingCategoryTotal > 0 ? minutes / meetingCategoryTotal : 0,
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
  const stored = await readDailyMetricsRange(env, from, end);
  const byDate = new Map(stored.map(row => [row.date, row]));
  for (let date = from; dateDistance(date, end) >= 0; date = dateOffset(date, 1)) {
    const distance = dateDistance(date, today);
    const legacySelected = date === end && byDate.get(date)?.metrics.appMinutes === null;
    if ((distance < 0 || distance > 1) && !legacySelected) continue;
    const { metrics } = await calculateDailyMetrics(await loadStateInput(env, date, settings), date === today ? now : undefined);
    byDate.set(date, { date, metrics, computedAt: new Date(now).toISOString(), version: DAILY_ALGORITHM_VERSION });
  }
  return [...byDate.values()].sort((left, right) => left.date.localeCompare(right.date));
}
async function workStatusRows(env: Env, from: string, to: string, settings: RhythmSettings) {
  const today = shanghaiDate(Date.now());
  const [stored, recent] = await Promise.all([
    readDailyStatusRange(env, from, to),
    (async () => {
      const rows = [];
      for (let date = from; dateDistance(date, to) >= 0; date = dateOffset(date, 1)) {
        const distance = dateDistance(date, today);
        if (distance < 0 || distance > 1) continue;
        const { day } = await calculateDailyMetrics(await loadStateInput(env, date, settings), date === today ? Date.now() : undefined);
        rows.push({ date, segments: day.segments, computedAt: new Date().toISOString(), version: DAILY_ALGORITHM_VERSION });
      }
      return rows;
    })(),
  ]);
  return new Map([...stored, ...recent].filter(row => row.version === DAILY_ALGORITHM_VERSION).map(row => [row.date, row]));
}

type WorkAggregate = {
  officeMinutes: number | null;
  meetingMinutes: number | null;
  workMinutes: number | null;
  awayMinutes: number | null;
  categories: Record<AppCategory, number> | null;
  meetingCategories: Record<AppCategory, number> | null;
  topApps: Array<{ name: string; category: AppCategory; minutes: number }> | null;
  focusTotal: number | null;
  focusLongest: number | null;
  focusSegments: number | null;
  focusSegmentList: DailyMetricsRow["metrics"]["focusSegments"];
  interruptions: number | null;
  hourlyActive: Record<string, number> | null;
  hourlySwitches: Record<string, number> | null;
};

function aggregateWorkRows(rows: DailyMetricsRow[]): WorkAggregate {
  const usable = rows.filter(row => row.metrics.officeActiveMinutes !== null);
  if (!usable.length) {
    return {
      officeMinutes: null, meetingMinutes: null, workMinutes: null, awayMinutes: null, categories: null, meetingCategories: null, topApps: null,
      focusTotal: null, focusLongest: null, focusSegments: null, focusSegmentList: null,
      interruptions: null, hourlyActive: null, hourlySwitches: null,
    };
  }
  const categories = Object.fromEntries(APP_CATEGORIES.map(category => [category, 0])) as Record<AppCategory, number>;
  const meetingCategories = Object.fromEntries(APP_CATEGORIES.map(category => [category, 0])) as Record<AppCategory, number>;
  const appRows = usable.filter(row => row.metrics.appMinutes !== null);
  const hourlyRows = usable.filter(row => row.metrics.hourlyActiveMinutes !== null && row.metrics.hourlySwitchCounts !== null);
  const apps = new Map<string, { category: AppCategory; minutes: number }>();
  let awayMinutes = 0, meetingMinutes = 0, focusTotal = 0, focusLongest = 0, focusSegments = 0, interruptions = 0;
  let meetingKnown = true, focusTotalKnown = true, focusLongestKnown = true, focusSegmentsKnown = true, interruptionsKnown = true;
  const hourlyActiveTotals: Record<string, number> = {}, hourlySwitchTotals: Record<string, number> = {};
  for (const row of usable) {
    const metrics = row.metrics;
    awayMinutes += metrics.statusMinutes.office_away ?? 0;
    if (typeof metrics.officeMeetingMinutes !== "number") meetingKnown = false; else meetingMinutes += metrics.officeMeetingMinutes;
    for (const category of APP_CATEGORIES) {
      categories[category] += metrics.appCategoryMinutes[category] ?? 0;
      meetingCategories[category] += metrics.meetingAppCategoryMinutes?.[category] ?? 0;
    }
    if (metrics.focus.totalMinutes === null) focusTotalKnown = false; else focusTotal += metrics.focus.totalMinutes;
    if (metrics.focus.longestMinutes === null) focusLongestKnown = false; else focusLongest += metrics.focus.longestMinutes;
    if (metrics.focus.segmentCount === null) focusSegmentsKnown = false; else focusSegments += metrics.focus.segmentCount;
    if (metrics.focus.communicationInterruptions === null) interruptionsKnown = false; else interruptions += metrics.focus.communicationInterruptions;
  }
  for (const row of appRows) {
    for (const [name, app] of Object.entries(row.metrics.appMinutes!)) {
      const current = apps.get(name);
      apps.set(name, { category: app.category, minutes: (current?.minutes ?? 0) + app.minutes });
    }
  }
  for (const row of hourlyRows) {
    for (const [hour, minutes] of Object.entries(row.metrics.hourlyActiveMinutes!)) {
      hourlyActiveTotals[hour] = (hourlyActiveTotals[hour] ?? 0) + minutes;
    }
    for (const [hour, count] of Object.entries(row.metrics.hourlySwitchCounts!)) {
      hourlySwitchTotals[hour] = (hourlySwitchTotals[hour] ?? 0) + count;
    }
  }
  const officeMinutes = usable.reduce((sum, row) => sum + (row.metrics.officeActiveMinutes ?? 0), 0);
  const knownMeetingMinutes = meetingKnown ? meetingMinutes : null;
  const workMinutes = knownMeetingMinutes === null ? null : officeMinutes + knownMeetingMinutes;
  const divisor = hourlyRows.length;
  return {
    officeMinutes,
    meetingMinutes: knownMeetingMinutes,
    workMinutes,
    categories,
    meetingCategories,
    awayMinutes,
    topApps: appRows.length ? [...apps.entries()].sort((a, b) => b[1].minutes - a[1].minutes || a[0].localeCompare(b[0]))
      .slice(0, 5).map(([name, app]) => ({ name, category: app.category, minutes: app.minutes })) : null,
    focusTotal: focusTotalKnown ? (usable.length === 1 ? focusTotal : focusTotal / usable.length) : null,
    focusLongest: focusLongestKnown ? (usable.length === 1 ? focusLongest : focusLongest / usable.length) : null,
    focusSegments: focusSegmentsKnown ? (usable.length === 1 ? focusSegments : focusSegments / usable.length) : null,
    focusSegmentList: usable.length === 1 ? usable[0].metrics.focusSegments : null,
    interruptions: interruptionsKnown ? (usable.length === 1 ? interruptions : interruptions / usable.length) : null,
    hourlyActive: divisor ? Object.fromEntries(Object.entries(hourlyActiveTotals).map(([hour, minutes]) => [hour, minutes / divisor])) : null,
    hourlySwitches: divisor ? Object.fromEntries(Object.entries(hourlySwitchTotals).map(([hour, count]) => [hour, count / divisor])) : null,
  };
}
function meetingSessions(segments: Array<{ status: string; startMinute: number; endMinute: number }>): number {
  let count = 0;
  let previousEnd = -Infinity;
  for (const segment of segments) {
    if (segment.status !== "office_meeting") continue;
    if (segment.startMinute - previousEnd - 1 > 5) count += 1;
    previousEnd = segment.endMinute;
  }
  return count;
}

type DayWorkStats = {
  date: string;
  office_minutes: number | null;
  meeting_minutes: number | null;
  work_minutes: number | null;
  work_delta_minutes: number | null;
  meeting_delta_minutes: number | null;
  meeting_sessions: number | null;
  focus_availability: WorkAvailability | null;
};

function dayWorkStats(date: string, row: DailyMetricsRow | undefined, status: DailyStatusRow | undefined): DayWorkStats {
  const officeMinutes = row?.metrics.officeActiveMinutes ?? null;
  const meetingMinutes = typeof row?.metrics.officeMeetingMinutes === "number" ? row.metrics.officeMeetingMinutes : null;
  return {
    date,
    office_minutes: officeMinutes,
    meeting_minutes: meetingMinutes,
    work_minutes: officeMinutes === null || meetingMinutes === null ? null : officeMinutes + meetingMinutes,
    work_delta_minutes: null,
    meeting_delta_minutes: null,
    meeting_sessions: status ? meetingSessions(status.segments) : null,
    focus_availability: status ? workAvailability(status.segments) : null,
  };
}


function aggregateAvailability(days: DayWorkStats[]) {
  const available = days.filter(day => day.focus_availability !== null);
  if (!available.length) return null;
  return {
    longest_minutes: Math.max(...available.map(day => day.focus_availability!.longest_minutes)),
    morning: {
      longest_minutes: Math.max(...available.map(day => day.focus_availability!.morning.longest_minutes)),
      has_90_minutes: available.some(day => day.focus_availability!.morning.has_90_minutes),
    },
    afternoon: {
      longest_minutes: Math.max(...available.map(day => day.focus_availability!.afternoon.longest_minutes)),
      has_90_minutes: available.some(day => day.focus_availability!.afternoon.has_90_minutes),
    },
  };
}

function deltaOf(current: number | null, previous: number | null): number | null {
  return current === null || previous === null ? null : current - previous;
}

function workCategories(current: WorkAggregate, previous: WorkAggregate) {
  const total = current.workMinutes;
  const previousTotal = previous.workMinutes;
  return current.categories === null ? null : Object.fromEntries(APP_CATEGORIES.map(category => {
    const minutes = current.categories![category];
    const previousMinutes = previous.categories?.[category] ?? null;
    return [category, {
      minutes,
      share: total !== null && total > 0 ? minutes / total : 0,
      delta_minutes: deltaOf(minutes, previousMinutes),
      delta_share: total !== null && total > 0 && previousTotal !== null && previousTotal > 0
        ? minutes / total - previousMinutes! / previousTotal : null,
    }];
  }));
}

function heatmap(rows: DailyMetricsRow[], from: string, to: string) {
  const workdays = rows.filter(row => row.date >= from && row.date <= to && dayType(row.date) === "workday"
    && row.metrics.hourlyActiveMinutes !== null);
  const hours = Array.from({ length: 12 }, (_, index) => String(index + 8).padStart(2, "0"));
  const averageHours = (subset: DailyMetricsRow[]) => hours.map(hour => ({
    hour,
    minutes: subset.length ? subset.reduce((sum, row) => sum + (row.metrics.hourlyActiveMinutes![hour] ?? 0), 0) / subset.length : null,
  }));
  const weekdays = ["周一", "周二", "周三", "周四", "周五"];
  const days = weekdays.map((day, index) => {
    const dayRows = workdays.filter(row => ((new Date(`${row.date}T00:00:00Z`).getUTCDay() + 6) % 7) === index);
    return { day, days_available: dayRows.length, hours: averageHours(dayRows) };
  });
  return { from, to, days_available: workdays.length, hours: averageHours(workdays), days };
}

function hourlyWork(current: WorkAggregate) {
  if (current.hourlyActive === null || current.hourlySwitches === null) return null;
  const hours = Array.from({ length: 12 }, (_, index) => String(index + 8).padStart(2, "0"));
  const values = hours.map(hour => current.hourlySwitches![hour] ?? 0);
  const activeHours = hours.filter(hour => (current.hourlyActive![hour] ?? 0) > 0);
  const average = activeHours.length
    ? activeHours.reduce((sum, hour) => sum + (current.hourlySwitches![hour] ?? 0), 0) / activeHours.length
    : 0;
  return hours.map((hour, index) => ({
    hour,
    active_minutes: current.hourlyActive![hour] ?? 0,
    switch_count: values[index],
    above_average: (current.hourlyActive![hour] ?? 0) > 0 && values[index] > average * 1.5,
  }));
}


get("/api/work", async c => {
  const url = new URL(c.req.url);
  const date = validateDate(url.searchParams.get("date"));
  const range = url.searchParams.get("range") ?? "day";
  if (range !== "day" && range !== "week") throw new AppError("invalid_range", 400);
  const today = shanghaiDate(Date.now());
  if (date > today) throw new AppError("invalid_date", 400);
  const from = range === "day" ? date : weekStart(date);
  const previousFrom = dateOffset(from, -7);
  const previousTo = dateOffset(date, -7);
  const settings = await readSettings(c.env);
  const rows = await metricsRows(c.env, dateOffset(from, -28), date, settings);
  const selectedRows = rows.filter(row => row.date >= from && row.date <= date);
  const previousRows = await metricsRows(c.env, previousFrom, previousTo, settings);
  const statusByDate = await workStatusRows(c.env, previousFrom, date, settings);
  const current = aggregateWorkRows(selectedRows);
  const previous = aggregateWorkRows(previousRows);
  const previousByDate = new Map(previousRows.map(row => [row.date, row]));
  const selectedByDate = new Map(selectedRows.map(row => [row.date, row]));
  const selectedDayStats = Array.from({ length: range === "week" ? 7 : 1 }, (_, index) => {
    const day = dateOffset(from, index);
    const stats = dayWorkStats(day, selectedByDate.get(day), statusByDate.get(day));
    const prior = dayWorkStats(dateOffset(day, -7), previousByDate.get(dateOffset(day, -7)), statusByDate.get(dateOffset(day, -7)));
    return { ...stats, work_delta_minutes: deltaOf(stats.work_minutes, prior.work_minutes), meeting_delta_minutes: deltaOf(stats.meeting_minutes, prior.meeting_minutes) };
  });
  const knownSessionDays = selectedDayStats.filter(day => day.meeting_sessions !== null);
  const totalMeetingSessions = knownSessionDays.length
    ? knownSessionDays.reduce((sum, day) => sum + (day.meeting_sessions ?? 0), 0) : null;
  const focusAvailability = aggregateAvailability(selectedDayStats);
  const awayShare = current.awayMinutes === null || current.workMinutes === null || current.workMinutes === 0
    ? null : current.awayMinutes / current.workMinutes;
  const previousAwayShare = previous.awayMinutes === null || previous.workMinutes === null || previous.workMinutes === 0
    ? null : previous.awayMinutes / previous.workMinutes;
  const heatmapEnd = dateOffset(date, -1);
  return json({
    date,
    range,
    from,
    to: date,
    missing: current.workMinutes === null,
    office_minutes: current.officeMinutes,
    categories: workCategories(current, previous),
    meeting_minutes: current.meetingMinutes,
    meeting_delta_minutes: deltaOf(current.meetingMinutes, previous.meetingMinutes),
    work_minutes: current.workMinutes,
    work_delta_minutes: deltaOf(current.workMinutes, previous.workMinutes),
    meeting_sessions: totalMeetingSessions,
    meeting_share: current.meetingMinutes === null || current.workMinutes === null || current.workMinutes === 0
      ? null : current.meetingMinutes / current.workMinutes,
    meeting_categories: current.meetingCategories,
    days: selectedDayStats,
    focus_availability: focusAvailability,
    away: {
      minutes: current.awayMinutes,
      share: awayShare,
      delta_minutes: deltaOf(current.awayMinutes, previous.awayMinutes),
      delta_share: awayShare === null || previousAwayShare === null ? null : awayShare - previousAwayShare,
    },
    top_apps: current.topApps?.map(app => ({ ...app, share: current.workMinutes && current.workMinutes > 0 ? app.minutes / current.workMinutes : 0 })) ?? null,
    focus: {
      total_minutes: current.focusTotal,
      longest_minutes: current.focusLongest,
      segment_count: current.focusSegments,
      segments: range === "day" ? current.focusSegmentList : null,
      communication_interruptions: current.interruptions,
    },
    heatmap: heatmap(rows, dateOffset(heatmapEnd, -27), heatmapEnd),
    hourly: hourlyWork(current),
    communication_interruptions: current.interruptions,
  });
});

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
  const result = findAnomalies(rows, DEFAULT_ANOMALY_THRESHOLDS, bounds.from);
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
  const currentSettings = await readSettings(c.env);
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    throw new AppError("invalid_settings", 400);
  }
  let settings;
  try {
    settings = parseSettingsUpdate(body, currentSettings);
  } catch {
    throw new AppError("invalid_settings", 400);
  }
  const hasSubjectDeviceIds = typeof body === "object" && body !== null && "subject_device_ids" in body;
  let candidates = deviceCandidates([]);
  if (hasSubjectDeviceIds) {
    candidates = deviceCandidates(await readUpstream(c.env, UPSTREAM_HOME_DEVICES_PATH));
    const candidateIds = new Set(candidates.map(candidate => candidate.device_id));
    if (settings.subjectDeviceIds.some(deviceId => !candidateIds.has(deviceId))) {
      throw new AppError("invalid_settings", 400);
    }
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
    evidence: status === "office_away" || status === "office_meeting" || status === "commute" ? "inferred" : status === "unknown" ? "no_data" : "seen",
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

app.on(["GET", "HEAD"], ["/", "/trend", "/work", "/sources", "/settings", "/login"], async c => {
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
