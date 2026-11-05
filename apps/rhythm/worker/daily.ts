import { calculateDay, dayStartEpoch, isOfficeWorkMinute, phonePresenceByMinute, shanghaiDate, STATE_THRESHOLDS, weekdayOf } from "./state";
import { APP_CATEGORIES, normalizeAppCategory } from "./models";
import type {
  ActivitySample, AppCategory, DailyMetrics, DailyMetricsRow, DailyStatusRow, DayComputation,
  DayType, FocusSegment, GapReason, RhythmStatus, StateInput,
} from "./models";
import type { Env } from "./types";

export const DAILY_ALGORITHM_VERSION = "p9-2026-11-06";
const MINUTES_PER_DAY = 1440;
const MS_PER_MINUTE = 60_000;
export { APP_CATEGORIES };

function activeSample(row: ActivitySample | null): boolean {
  if (!row || row.locked === true) return false;
  const idle = [row.key_idle_sec, row.pointer_idle_sec, row.idle_sec]
    .filter((value): value is number => typeof value === "number" && Number.isFinite(value));
  return idle.length > 0 && Math.min(...idle) < STATE_THRESHOLDS.activeIdleSeconds;
}
function officeActiveSample(row: ActivitySample | null): boolean {
  return row?.net === "office" && activeSample(row);
}

function appName(row: ActivitySample | null): string {
  return row?.app_name?.trim() || row?.bundle_id?.trim() || "未标注应用";
}

function categoryOf(row: ActivitySample | null, mappings: Record<string, AppCategory>): AppCategory {
  if (!row) return "其他";
  for (const name of [row.bundle_id ?? "", row.app_name ?? ""]) {
    if (name && mappings[name]) return mappings[name];
  }
  return "其他";
}

export function dayType(date: string): DayType {
  const weekday = weekdayOf(date);
  return weekday >= 1 && weekday <= 5 ? "workday" : "restday";
}

function emptyCategories(): Record<AppCategory, number> {
  return Object.fromEntries(APP_CATEGORIES.map(category => [category, 0])) as Record<AppCategory, number>;
}

function minuteSamples(input: StateInput, now?: number): Array<ActivitySample | null> {
  const start = dayStartEpoch(input.date);
  const allowed = now !== undefined && shanghaiDate(now) === input.date ? now : Infinity;
  const rows = input.activity
    .map(row => ({ row, at: Date.parse(row.sampled_at) }))
    .filter(item => Number.isFinite(item.at) && item.at <= allowed)
    .sort((a, b) => a.at - b.at);
  const result: Array<ActivitySample | null> = new Array(MINUTES_PER_DAY).fill(null);
  for (const item of rows) {
    const minute = Math.floor((item.at - start) / MS_PER_MINUTE);
    if (minute >= 0 && minute < MINUTES_PER_DAY) result[minute] = item.row;
  }
  return result;
}

/**
 * 每分钟「最近一条且仍新鲜」的观测值。行只排序一次，游标单向前进，复杂度 O(N log N + 1440)。
 */
function perMinuteFresh<T>(rows: Array<{ at: number; value: T }>, start: number, freshMs: number): Array<T | null> {
  const sorted = rows.filter(row => Number.isFinite(row.at)).sort((a, b) => a.at - b.at);
  const result: Array<T | null> = new Array(MINUTES_PER_DAY).fill(null);
  let index = 0;
  let latest: { at: number; value: T } | null = null;
  for (let minute = 0; minute < MINUTES_PER_DAY; minute += 1) {
    const at = start + minute * MS_PER_MINUTE;
    while (index < sorted.length && sorted[index].at <= at) latest = sorted[index++];
    result[minute] = latest && at - latest.at <= freshMs ? latest.value : null;
  }
  return result;
}


/** 家中扫描每分钟的心跳：null 表示没有新鲜心跳，否则为 scan_ok。 */
function heartbeatByMinute(input: StateInput): Array<boolean | null> {
  const rows = input.heartbeats.map(row => ({ at: Date.parse(row.observed_at), value: row.scan_ok === true }));
  return perMinuteFresh(rows, dayStartEpoch(input.date), STATE_THRESHOLDS.homeFreshnessMinutes * MS_PER_MINUTE);
}

/** 专注段里允许连续缺几分钟采样（采样按分钟取整会有抖动），缺口本身不计入专注。 */
const FOCUS_MISSING_SAMPLE_TOLERANCE = 2;

function focusMetrics(day: DayComputation, samples: Array<ActivitySample | null>, mappings: Record<string, AppCategory>) {
  let current = 0;
  let startMinute = -1;
  let endMinute = -1;
  let segments = 0;
  let total = 0;
  let longest = 0;
  let communicationInterruptions = 0;
  let communicationOpen = false;
  const categoryMinutes = new Map<AppCategory, number>();
  const focusSegments: FocusSegment[] = [];
  const finish = (interruptedAt: number | null = null) => {
    if (current >= 25) {
      segments += 1;
      total += current;
      longest = Math.max(longest, current);
      const primary = [...categoryMinutes.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]?.[0] ?? "其他";
      focusSegments.push({
        startMinute,
        endMinute,
        minutes: current,
        primaryCategory: primary,
        interruptedAt: interruptedAt === null ? [] : [interruptedAt],
      });
    }
    current = 0;
    startMinute = -1;
    endMinute = -1;
    categoryMinutes.clear();
  };
  let missingRun = 0;
  for (let minute = 0; minute < MINUTES_PER_DAY; minute += 1) {
    const office = day.minuteStatuses[minute] === "office_active"
      || isOfficeWorkMinute(samples[minute], day.minuteStatuses[minute], day.minuteEvidence[minute]);
    if (office && !samples[minute]) {
      // 这一分钟没有工作机采样：不知道在用什么 App，不计入专注；
      // 只容忍采样时间抖动造成的短缺口，更长就结束本段，不把「未知」当成「没切到沟通」。
      missingRun += 1;
      if (missingRun > FOCUS_MISSING_SAMPLE_TOLERANCE) {
        finish();
        communicationOpen = false;
      }
      continue;
    }
    missingRun = 0;
    const category = categoryOf(samples[minute], mappings);
    const communication = office && (category === "工作沟通" || category === "私人");
    const eligible = office && !communication;
    if (eligible) {
      if (current === 0) startMinute = minute;
      endMinute = minute;
      current += 1;
      categoryMinutes.set(category, (categoryMinutes.get(category) ?? 0) + 1);
      communicationOpen = false;
      continue;
    }
    if (communication && current > 0) {
      if (!communicationOpen && current >= 25) communicationInterruptions += 1;
      finish(current >= 25 && !communicationOpen ? minute : null);
      communicationOpen = true;
      continue;
    }
    finish();
    communicationOpen = false;
  }
  finish();
  return {
    segmentCount: segments,
    totalMinutes: total,
    longestMinutes: longest,
    communicationInterruptions,
    segments: focusSegments,
  };
}

/**
 * 未知分钟的缺口原因：
 * 1. 家中扫描没有新鲜心跳或 scan_ok=false → home_scan_missing；
 * 2. 心跳正常、已指定手机但手机没被看到 → phone_scan_missing；
 * 3. 其余（心跳正常且手机已看到，或尚未指定手机）都归 work_machine_missing：
 *    未指定手机时家里这一路本来就判断不了位置，能补上这一分钟的只有工作机。
 */
function gapReason(heartbeat: boolean | null, phoneSeen: boolean, phoneConfigured: boolean): GapReason {
  if (heartbeat !== true) return "home_scan_missing";
  if (phoneConfigured && !phoneSeen) return "phone_scan_missing";
  return "work_machine_missing";
}

export function calculateDailyMetrics(input: StateInput, now?: number): {
  day: DayComputation;
  metrics: DailyMetrics;
} {
  const day = calculateDay(input, now);
  const samples = minuteSamples(input, now);
  const statusMinutes = Object.fromEntries(
    (["bedroom", "living_room", "home", "office_active", "office_away", "commute", "other_network", "unknown"] as RhythmStatus[])
      .map(status => [status, day.minuteStatuses.filter(value => value === status).length]),
  ) as Record<RhythmStatus, number>;
  const appCategoryMinutes = emptyCategories();
  const hourlyAppCategoryMinutes: Record<string, Record<AppCategory, number>> = {};
  const otherNetworkMinutes: Record<string, number> = {};
  const appMinutes = new Map<string, { minutes: number; category: AppCategory }>();
  const hourlyActiveMinutes: Record<string, number> = {};
  const hourlySwitchCounts: Record<string, number> = {};
  let previousOfficeApp: string | null = null;
  const afterWorkRoomMinutes: Record<string, number> = {};
  const weekendRoomMinutes: Record<string, number> = {};

  let lastOffice = -1;
  for (let minute = 0; minute < day.minuteStatuses.length; minute += 1) {
    if (day.minuteStatuses[minute] === "office_active") lastOffice = minute;
    const row = samples[minute];
    if (officeActiveSample(row)) {
      const category = categoryOf(row, input.appCategories);
      appCategoryMinutes[category] += 1;
      const hour = String(Math.floor(minute / 60)).padStart(2, "0");
      hourlyAppCategoryMinutes[hour] ??= emptyCategories();
      hourlyAppCategoryMinutes[hour][category] += 1;
    }
    if (officeActiveSample(row)) {
      const hour = String(Math.floor(minute / 60)).padStart(2, "0");
      hourlyActiveMinutes[hour] = (hourlyActiveMinutes[hour] ?? 0) + 1;
      hourlySwitchCounts[hour] ??= 0;
      const name = appName(row);
      const existing = appMinutes.get(name);
      appMinutes.set(name, { minutes: (existing?.minutes ?? 0) + 1, category: categoryOf(row, input.appCategories) });
      if (previousOfficeApp !== null && previousOfficeApp !== name) {
        hourlySwitchCounts[hour] = (hourlySwitchCounts[hour] ?? 0) + 1;
      }
      previousOfficeApp = name;
    } else {
      previousOfficeApp = null;
    }
    if (row?.net === "other" && activeSample(row)) {
      const rawName = row.ssid?.trim() || row.net_key?.trim() || "未命名网络";
      const name = input.otherNetworkNames?.[row.net_key?.trim() || ""]
        || input.otherNetworkNames?.[row.ssid?.trim() || ""]
        || rawName;
      otherNetworkMinutes[name] = (otherNetworkMinutes[name] ?? 0) + 1;
    }
  }

  // 下班后 / 周末仍用工作机（设计口径）：工作日里工作机在家里网络且有键鼠的分钟都算（不论当天去没去公司、
  // 是在上班前还是下班后）；休息日所有有键鼠的分钟都算。房间按当分钟状态拆分。
  const workday = dayType(input.date) === "workday";
  let afterWorkWorkMachineMinutes = 0;
  let weekendWorkMachineMinutes = 0;
  for (let minute = 0; minute < samples.length; minute += 1) {
    const row = samples[minute];
    if (!row || !activeSample(row)) continue;
    const afterWork = workday && row.net === "home";
    const weekendWork = !workday;
    if (!afterWork && !weekendWork) continue;
    if (afterWork) afterWorkWorkMachineMinutes += 1;
    else weekendWorkMachineMinutes += 1;
    const status = day.minuteStatuses[minute];
    const room = status === "bedroom" ? "卧室" : status === "living_room" ? "客厅" : "房间未知";
    const target = afterWork ? afterWorkRoomMinutes : weekendRoomMinutes;
    target[room] = (target[room] ?? 0) + 1;
  }

  const covered = day.minuteStatuses.reduce((count, status) => count + (status !== "unknown" && status !== "not_arrived" ? 1 : 0), 0);
  const countedMinutes = day.minuteStatuses.filter(status => status !== "not_arrived").length;
  const gapReasonMinutes: Record<GapReason, number> = {
    home_scan_missing: 0, phone_scan_missing: 0, work_machine_missing: 0,
  };
  const heartbeats = heartbeatByMinute(input);
  const phoneSeen = phonePresenceByMinute(input);
  const phoneConfigured = input.subjectDeviceIds.length > 0;
  for (let minute = 0; minute < day.minuteStatuses.length; minute += 1) {
    if (day.minuteStatuses[minute] !== "unknown") continue;
    gapReasonMinutes[gapReason(heartbeats[minute], phoneSeen[minute], phoneConfigured)] += 1;
  }
  const firstOffice = day.minuteStatuses.findIndex(status => status === "office_active");
  const officeSpanMinutes = firstOffice >= 0 && lastOffice >= firstOffice ? lastOffice - firstOffice + 1 : null;
  const topApp = [...appMinutes.entries()].sort((a, b) => b[1].minutes - a[1].minutes || a[0].localeCompare(b[0]))[0];
  const findMoment = (kind: string) => day.moments.find(moment => moment.kind === kind)?.minute ?? null;
  const focus = day.channels.work ? focusMetrics(day, samples, input.appCategories)
    : { segmentCount: null, totalMinutes: null, longestMinutes: null, communicationInterruptions: null, segments: null };

  const metrics: DailyMetrics = {
    ...day.metrics,
    statusMinutes,
    wakeMinute: findMoment("wake"),
    leaveHomeMinute: findMoment("leave_home"),
    startWorkMinute: findMoment("start_work"),
    leaveComputerMinute: findMoment("leave_computer"),
    arriveHomeMinute: findMoment("arrive_home"),
    returnBedroomMinute: findMoment("return_bedroom"),
    officeSpanMinutes,
    focus,
    afterWorkWorkMachineMinutes: day.channels.work ? afterWorkWorkMachineMinutes : null,
    weekendWorkMachineMinutes: day.channels.work ? weekendWorkMachineMinutes : null,
    afterWorkRoomMinutes,
    weekendRoomMinutes,
    appCategoryMinutes,
    hourlyAppCategoryMinutes,
    appMinutes: Object.fromEntries(appMinutes),
    hourlyActiveMinutes: day.channels.work ? hourlyActiveMinutes : {},
    hourlySwitchCounts: day.channels.work ? hourlySwitchCounts : {},
    focusSegments: focus.segments,
    topAppName: topApp?.[0] ?? null,
    topAppMinutes: topApp?.[1].minutes ?? null,
    otherNetworkMinutes,
    coverage: {
      ratio: countedMinutes > 0 ? covered / countedMinutes : null,
      gapReasonMinutes,
    },
    dayType: dayType(input.date),
  };
  return { day, metrics };
}

export type DailyRows = { status: DailyStatusRow; metrics: DailyMetricsRow };

export function dailyRows(input: StateInput, now?: number, computedAt = new Date().toISOString()): DailyRows {
  const result = calculateDailyMetrics(input, now);
  return {
    status: { date: input.date, segments: result.day.segments, computedAt, version: DAILY_ALGORITHM_VERSION },
    metrics: { date: input.date, metrics: result.metrics, computedAt, version: DAILY_ALGORITHM_VERSION },
  };
}

export async function readDailyStatus(env: Env, date: string): Promise<DailyStatusRow | null> {
  const row = await env.DB.prepare(
    "SELECT date, segments_json, computed_at, version FROM daily_status WHERE date=?",
  ).bind(date).first<{ date: string; segments_json: string; computed_at: string; version: string }>();
  if (!row) return null;
  try {
    return { date: row.date, segments: JSON.parse(row.segments_json), computedAt: row.computed_at, version: row.version };
  } catch {
    return null;
  }
}

export async function readDailyMetrics(env: Env, date: string): Promise<DailyMetricsRow | null> {
  const row = await env.DB.prepare("SELECT * FROM daily_metrics WHERE date=?")
    .bind(date).first<Record<string, unknown>>();
  return row ? parseDailyMetricsRow(row) : null;
}

function categoryMinutesFromJson(value: unknown): Record<AppCategory, number> {
  const result = emptyCategories();
  if (typeof value !== "object" || value === null || Array.isArray(value)) return result;
  for (const [category, minutes] of Object.entries(value as Record<string, unknown>)) {
    const normalized = normalizeAppCategory(category);
    if (normalized && typeof minutes === "number" && Number.isFinite(minutes)) result[normalized] += minutes;
  }
  return result;
}

function hourlyCategoriesFromJson(value: unknown): Record<string, Record<AppCategory, number>> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return {};
  return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([hour, categories]) => [
    hour, categoryMinutesFromJson(categories),
  ]));
}

function parseJson<T = unknown>(value: unknown): T {
  try { return JSON.parse(String(value ?? "{}")) as T; } catch { return {} as T; }
}

function parseAppMinutes(value: unknown): Record<string, { minutes: number; category: AppCategory }> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return {};
  const result: Record<string, { minutes: number; category: AppCategory }> = {};
  for (const [name, item] of Object.entries(value as Record<string, unknown>)) {
    if (typeof item !== "object" || item === null || Array.isArray(item)) continue;
    const row = item as Record<string, unknown>;
    const category = normalizeAppCategory(row.category) ?? "其他";
    if (typeof row.minutes === "number" && Number.isFinite(row.minutes)) result[name] = { minutes: row.minutes, category };
  }
  return result;
}

function parseDailyMetricsRow(row: Record<string, unknown>): DailyMetricsRow | null {
  try {
    const json = <T = unknown>(key: string) => parseJson<T>(row[key]);
    const present = (key: string) => row[key] !== null && row[key] !== undefined;
    const metrics: DailyMetrics = {
      statusMinutes: json<Record<RhythmStatus, number>>("status_minutes_json"),
      commuteToWorkMinutes: row.commute_to_work_minutes as number | null,
      commuteHomeMinutes: row.commute_home_minutes as number | null,
      wakeMinute: row.wake_minute as number | null,
      leaveHomeMinute: row.leave_home_minute as number | null,
      startWorkMinute: row.start_work_minute as number | null,
      leaveComputerMinute: row.leave_computer_minute as number | null,
      arriveHomeMinute: row.arrive_home_minute as number | null,
      returnBedroomMinute: row.return_bedroom_minute as number | null,
      officeActiveMinutes: row.office_active_minutes as number | null,
      homeMinutes: row.home_minutes as number | null,
      bedroomMinutes: row.bedroom_minutes as number | null,
      livingRoomMinutes: row.living_room_minutes as number | null,
      homeUnknownMinutes: row.home_unknown_minutes as number | null,
      officeSpanMinutes: row.office_span_minutes as number | null,
      focus: {
        segmentCount: row.focus_segment_count as number | null,
        totalMinutes: row.focus_total_minutes as number | null,
        longestMinutes: row.focus_longest_minutes as number | null,
        communicationInterruptions: row.communication_interruptions as number | null,
        segments: row.focus_segments_json === null || row.focus_segments_json === undefined ? null : parseJson(row.focus_segments_json) as FocusSegment[],
      },
      afterWorkWorkMachineMinutes: row.after_work_work_machine_minutes as number | null,
      weekendWorkMachineMinutes: row.weekend_work_machine_minutes as number | null,
      afterWorkRoomMinutes: json<Record<string, number>>("after_work_room_minutes_json"),
      weekendRoomMinutes: json<Record<string, number>>("weekend_room_minutes_json"),
      appCategoryMinutes: categoryMinutesFromJson(json("app_category_minutes_json")),
      hourlyAppCategoryMinutes: hourlyCategoriesFromJson(json("hourly_app_category_minutes_json")),
      appMinutes: present("app_minutes_json") ? parseAppMinutes(json("app_minutes_json")) : null,
      hourlyActiveMinutes: present("hourly_active_minutes_json") ? json<Record<string, number>>("hourly_active_minutes_json") : null,
      hourlySwitchCounts: present("hourly_switch_counts_json") ? json<Record<string, number>>("hourly_switch_counts_json") : null,
      focusSegments: present("focus_segments_json") ? parseJson(row.focus_segments_json) as FocusSegment[] : null,
      topAppName: row.top_app_name as string | null,
      topAppMinutes: row.top_app_minutes as number | null,
      otherNetworkMinutes: json<Record<string, number>>("other_network_minutes_json"),
      coverage: {
        ratio: row.coverage_ratio as number | null,
        gapReasonMinutes: json<Record<GapReason, number>>("gap_reason_minutes_json"),
      },
      dayType: row.day_type as DayType,
    };
    return { date: row.date as string, metrics, computedAt: row.computed_at as string, version: row.version as string };
  } catch {
    return null;
  }
}

export async function readDailyMetricsRange(env: Env, from: string, to: string): Promise<DailyMetricsRow[]> {
  const result = await env.DB.prepare(
    "SELECT * FROM daily_metrics WHERE date >= ? AND date <= ? ORDER BY date",
  ).bind(from, to).all<Record<string, unknown>>();
  return result.results.map(parseDailyMetricsRow).filter((row): row is DailyMetricsRow => row !== null);
}

export async function upsertDailyRows(env: Env, rows: DailyRows): Promise<void> {
  const m = rows.metrics.metrics;
  await env.DB.batch([
    env.DB.prepare(
      "INSERT INTO daily_status (date, segments_json, computed_at, version) VALUES (?, ?, ?, ?) "
      + "ON CONFLICT(date) DO UPDATE SET segments_json=excluded.segments_json, computed_at=excluded.computed_at, version=excluded.version",
    ).bind(rows.status.date, JSON.stringify(rows.status.segments), rows.status.computedAt, rows.status.version),
    env.DB.prepare(
      "INSERT INTO daily_metrics (date, status_minutes_json, commute_to_work_minutes, commute_home_minutes, wake_minute, leave_home_minute, start_work_minute, leave_computer_minute, arrive_home_minute, return_bedroom_minute, office_active_minutes, home_minutes, bedroom_minutes, living_room_minutes, home_unknown_minutes, office_span_minutes, focus_segment_count, focus_total_minutes, focus_longest_minutes, communication_interruptions, after_work_work_machine_minutes, weekend_work_machine_minutes, after_work_room_minutes_json, weekend_room_minutes_json, app_category_minutes_json, hourly_app_category_minutes_json, app_minutes_json, hourly_active_minutes_json, hourly_switch_counts_json, focus_segments_json, top_app_name, top_app_minutes, other_network_minutes_json, coverage_ratio, gap_reason_minutes_json, day_type, computed_at, version) "
      + "VALUES (" + Array(38).fill("?").join(", ") + ") "
      + "ON CONFLICT(date) DO UPDATE SET status_minutes_json=excluded.status_minutes_json, commute_to_work_minutes=excluded.commute_to_work_minutes, commute_home_minutes=excluded.commute_home_minutes, wake_minute=excluded.wake_minute, leave_home_minute=excluded.leave_home_minute, start_work_minute=excluded.start_work_minute, leave_computer_minute=excluded.leave_computer_minute, arrive_home_minute=excluded.arrive_home_minute, return_bedroom_minute=excluded.return_bedroom_minute, office_active_minutes=excluded.office_active_minutes, home_minutes=excluded.home_minutes, bedroom_minutes=excluded.bedroom_minutes, living_room_minutes=excluded.living_room_minutes, home_unknown_minutes=excluded.home_unknown_minutes, office_span_minutes=excluded.office_span_minutes, focus_segment_count=excluded.focus_segment_count, focus_total_minutes=excluded.focus_total_minutes, focus_longest_minutes=excluded.focus_longest_minutes, communication_interruptions=excluded.communication_interruptions, after_work_work_machine_minutes=excluded.after_work_work_machine_minutes, weekend_work_machine_minutes=excluded.weekend_work_machine_minutes, after_work_room_minutes_json=excluded.after_work_room_minutes_json, weekend_room_minutes_json=excluded.weekend_room_minutes_json, app_category_minutes_json=excluded.app_category_minutes_json, hourly_app_category_minutes_json=excluded.hourly_app_category_minutes_json, app_minutes_json=excluded.app_minutes_json, hourly_active_minutes_json=excluded.hourly_active_minutes_json, hourly_switch_counts_json=excluded.hourly_switch_counts_json, focus_segments_json=excluded.focus_segments_json, top_app_name=excluded.top_app_name, top_app_minutes=excluded.top_app_minutes, other_network_minutes_json=excluded.other_network_minutes_json, coverage_ratio=excluded.coverage_ratio, gap_reason_minutes_json=excluded.gap_reason_minutes_json, day_type=excluded.day_type, computed_at=excluded.computed_at, version=excluded.version",
    ).bind(
      rows.metrics.date, JSON.stringify(m.statusMinutes), m.commuteToWorkMinutes, m.commuteHomeMinutes,
      m.wakeMinute, m.leaveHomeMinute, m.startWorkMinute, m.leaveComputerMinute, m.arriveHomeMinute,
      m.returnBedroomMinute, m.officeActiveMinutes, m.homeMinutes, m.bedroomMinutes, m.livingRoomMinutes,
      m.homeUnknownMinutes, m.officeSpanMinutes, m.focus.segmentCount, m.focus.totalMinutes, m.focus.longestMinutes,
      m.focus.communicationInterruptions, m.afterWorkWorkMachineMinutes, m.weekendWorkMachineMinutes,
      JSON.stringify(m.afterWorkRoomMinutes), JSON.stringify(m.weekendRoomMinutes), JSON.stringify(m.appCategoryMinutes),
      JSON.stringify(m.hourlyAppCategoryMinutes), JSON.stringify(m.appMinutes), JSON.stringify(m.hourlyActiveMinutes),
      JSON.stringify(m.hourlySwitchCounts), JSON.stringify(m.focusSegments), m.topAppName, m.topAppMinutes,
      JSON.stringify(m.otherNetworkMinutes), m.coverage.ratio, JSON.stringify(m.coverage.gapReasonMinutes),
      m.dayType, rows.metrics.computedAt, rows.metrics.version,
    ),
    // 落库即消费该日期的「设置变更待重算」标记。
    env.DB.prepare("DELETE FROM settings_recompute_queue WHERE date=?").bind(rows.metrics.date),
  ]);
}
