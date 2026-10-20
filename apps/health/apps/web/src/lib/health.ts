import { api, RequestError } from "./api.ts";
import type { Day } from "./types";
export { calendarWindow as dateWindow } from "../../../../shared/dates.ts";
import { calendarWindow as dateWindow, shiftDay } from "../../../../shared/dates.ts";

export type HealthCollection = {
  name: string; label: string; mode: string; records: number;
  earliest_day: string | null; latest_day: string | null; failed_windows: number;
  last_attempt: { synced_at: string | null; attempted_at: string; last_error: string | null } | null;
  access?: {
    status: "unavailable" | "available" | "unknown";
    automatic_retry: boolean;
    code: string | null;
    checked_at: string | null;
  };
};
export type SyncFailure = {
  collection: string; from: string; to: string;
  code: string; requestId?: string; retryAt?: string;
};
export type SleepRecord = {
  id: string; day: string; type?: string;
  bedtime_start?: string; bedtime_end?: string;
  total_sleep_duration?: number | null; time_in_bed?: number | null; latency?: number | null;
  deep_sleep_duration?: number | null; rem_sleep_duration?: number | null;
  light_sleep_duration?: number | null; awake_time?: number | null;
  average_hrv?: number | null; hrv?: { interval?: number | null; items?: Array<number | null> | null } | null;
  average_heart_rate?: number | null; heart_rate?: { interval?: number | null; items?: Array<number | null> | null } | null;
  lowest_heart_rate?: number | null; average_breath?: number | null; breath?: { interval?: number | null; items?: Array<number | null> | null } | null;
  efficiency?: number | null; sleep_phase_5_min?: string | null;
};
export type SleepSeriesPoint = { at: string | null; offset: number | null; value: number };
export type SleepStagePoint = { at: string | null; offset: number | null; stage: "awake" | "light" | "deep" | "rem"; code: string };
type SleepResponse = {
  records: SleepRecord[]; next_offset: number | null;
  sync: { synced_at: string | null; error: string | null; window_verified: boolean };
};
export type StressDay = { day: string; stress_high?: number | null; recovery_high?: number | null };
export type TagRecord = {
  id: string; start_day?: string; end_day?: string; start_time?: string; end_time?: string;
  comment?: string | null; tag_type_code?: string | null; custom_name?: string | null;
};
export type Spo2Day = { day: string; spo2_percentage?: { average?: number | null } | null };

export const finite = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);
export const validScore = (value: unknown): value is number => finite(value) && value >= 0 && value <= 100;
export function duration(seconds: unknown, locale: string): string {
  if (!finite(seconds) || seconds < 0) return "—";
  const minutes = Math.round(seconds / 60);
  return locale === "zh" ? `${Math.floor(minutes / 60)} 小时 ${minutes % 60} 分`
    : `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}
export function latestDay(days: Day[]): Day | undefined {
  return [...days].filter(day => [day.sleep?.score, day.readiness?.score, day.activity?.score].some(finite))
    .sort((a, b) => b.date.localeCompare(a.date))[0];
}
export function calendarDays(records: Day[], count: number, end?: string): Day[] {
  const { from } = dateWindow(count, end);
  const byDate = new Map(records.map(record => [record.date, record]));
  return Array.from({ length: count }, (_, index) => {
    const date = shiftDay(from, index);
    return byDate.get(date) ?? { date };
  });
}
export function scoreDelta(days: Day[], latest: Day, key: "sleep" | "readiness" | "activity") {
  const score = latest[key]?.score;
  const start = dateWindow(8, latest.date).from;
  const values = days.filter(day => day.date >= start && day.date < latest.date)
    .map(day => day[key]?.score).filter(validScore);
  // Sparse baselines should not masquerade as a full week of observations.
  if (!validScore(score) || values.length < 3) return null;
  return { value: Math.round((score - values.reduce((a, b) => a + b, 0) / values.length) * 10) / 10, count: values.length };
}
export function sleepForDay(records: SleepRecord[], day: string) {
  return records.filter(record => record.day === day)
    .sort((a, b) => Number(b.type === "long_sleep") - Number(a.type === "long_sleep")
      || (finite(b.total_sleep_duration) ? b.total_sleep_duration : -1) - (finite(a.total_sleep_duration) ? a.total_sleep_duration : -1));
}
const SLEEP_STAGES: Record<string, SleepStagePoint["stage"]> = { 1: "deep", 2: "light", 3: "rem", 4: "awake" };

/** Local-wall start of a recorded instant; local DST transitions can shift the UTC clock. */
function localMidnightMs(value: string): number | null {
  const parts = value.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?([+-]\d{2}:\d{2}|Z)?/);
  if (!parts) return null;
  const [, year, month, day, hour, minute, second = "0", zone = ""] = parts;
  if (!zone) return null;
  const offsetSign = zone === "Z" || zone.startsWith("+") ? 1 : -1;
  const [offsetHour = "0", offsetMinute = "0"] = zone === "Z" ? [] : zone.slice(1).split(":");
  const localMs = Date.UTC(+year, +month - 1, +day, +hour, +minute, +second);
  const localStartMs = Date.UTC(+year, +month - 1, +day);
  const offsetMs = offsetSign * (+offsetHour * 60 + +offsetMinute) * 60_000;
  return localStartMs - offsetMs;
}

/** Oura stamps sleep series from the local midnight of the night the sleep starts. */
function seriesMidnightMs(record: SleepRecord): number | null {
  if (!record.bedtime_start || !record.bedtime_end) return record.bedtime_start ? localMidnightMs(record.bedtime_start) : null;
  // Anchor the series at the recorded bedtime; items step by the interval.
  const start = Date.parse(record.bedtime_start);
  return Number.isFinite(start) ? start : null;
}

export function seriesPoints(record: SleepRecord, series: { interval?: number | null; items?: Array<number | null> | null } | null | undefined): SleepSeriesPoint[] {
  if (!series || !Number.isFinite(series?.interval) || !series.interval || series.interval <= 0 || !Array.isArray(series.items)) return [];
  const interval = series.interval as number;
  const midnight = seriesMidnightMs(record);
  const points: SleepSeriesPoint[] = [];
  series.items.forEach((item, index) => {
    if (!finite(item)) return; // Missing samples stay missing; never resampled to zero.
    const offset = index * interval;
    const at = midnight !== null ? new Date(midnight + offset * 1000).toISOString() : null;
    points.push({ at, offset, value: item });
  });
  return points;
}

export function stagePoints(record: SleepRecord): SleepStagePoint[] {
  const value = record.sleep_phase_5_min;
  if (typeof value !== "string" || !/^[1234]*$/.test(value)) return [];
  const midnight = seriesMidnightMs(record);
  const points: SleepStagePoint[] = [];
  for (const match of value.match(/(.)\1*/g) ?? []) {
    const offset = points.length * 300;
    points.push({
      at: midnight !== null ? new Date(midnight + offset * 1000).toISOString() : null,
      offset,
      stage: SLEEP_STAGES[match[0]],
      code: match[0],
    });
  }
  return points;
}

/** The archive API accepts at most 31 days per window; chunk wider reads. */
export async function readCollection<T>(collection: string, from: string, to: string, includeSeries = false, signal?: AbortSignal): Promise<T[]> {
  const DAY = 86_400_000;
  const spans: [string, string][] = [];
  for (let start = Date.parse(from); start <= Date.parse(to); start += 31 * DAY) {
    const chunkFrom = new Date(start).toISOString().slice(0, 10);
    const chunkTo = new Date(Math.min(start + 30 * DAY, Date.parse(to))).toISOString().slice(0, 10);
    spans.push([chunkFrom, chunkTo]);
  }
  const records: T[] = [];
  for (const [chunkFrom, chunkTo] of spans) {
    records.push(...await readCollectionWindow<T>(collection, chunkFrom, chunkTo, includeSeries, signal));
  }
  return records;
}

async function readCollectionWindow<T>(collection: string, from: string, to: string, includeSeries: boolean, signal?: AbortSignal): Promise<T[]> {
  const records: T[] = [];
  let offset = 0;
  // The API caps both rows and bytes. Follow every page before presenting totals.
  for (let page = 0; page < 250; page++) {
    const params = new URLSearchParams({ collection, from, to, offset: String(offset) });
    if (includeSeries) params.set("include_series", "true");
    const result = await api<SleepResponse>(`/api/me/health-records?${params}`, { signal });
    if (!Array.isArray(result.records)) throw new RequestError("invalid_response", 502);
    records.push(...(result.records as T[]));
    if (result.next_offset === null) return records;
    if (!Number.isInteger(result.next_offset) || result.next_offset <= offset) throw new RequestError("invalid_response", 502);
    offset = result.next_offset;
  }
  throw new RequestError("sync_window_too_large", 422);
}

export async function readSleep(from: string, to: string, signal?: AbortSignal, includeSeries = false): Promise<SleepResponse> {
  const DAY = 86_400_000;
  if ((Date.parse(to) - Date.parse(from)) / DAY + 1 > 31) {
    const records = await readCollection<SleepRecord>("sleep", from, to, includeSeries, signal);
    return { records, next_offset: null, sync: { synced_at: null, error: null, window_verified: false } };
  }
  const records: SleepRecord[] = [];
  let offset = 0;
  for (let page = 0; page < 250; page++) {
    const params = new URLSearchParams({ collection: "sleep", from, to, offset: String(offset) });
    if (includeSeries) params.set("include_series", "true");
    const result = await api<SleepResponse>(`/api/me/health-records?${params}`, { signal });
    if (!Array.isArray(result.records)) throw new RequestError("invalid_response", 502);
    records.push(...result.records);
    if (result.next_offset === null) return { ...result, records };
    if (!Number.isInteger(result.next_offset) || result.next_offset <= offset) throw new RequestError("invalid_response", 502);
    offset = result.next_offset;
  }
  throw new RequestError("sync_window_too_large", 422);
}

export const readStress = (from: string, to: string, signal?: AbortSignal) =>
  readCollection<StressDay>("daily_stress", from, to, false, signal);
export const readTags = (from: string, to: string, signal?: AbortSignal) =>
  readCollection<TagRecord>("enhanced_tag", from, to, false, signal);
export const readSpo2 = (from: string, to: string, signal?: AbortSignal) =>
  readCollection<Spo2Day>("daily_spo2", from, to, false, signal);
export type AutomaticSyncStatus = {
  enabled: boolean;
  status: "idle" | "running" | "completed" | "partial" | "blocked";
  run_day: string | null;
  started_at: string | null;
  finished_at: string | null;
  last_success_at: string | null;
  error: string | null;
  total: number;
  completed: number;
  failed: number;
  remaining: number;
  unavailable?: { collection: string; code: string | null; checked_at: string | null }[];
  scores: { status: "pending" | "completed" | "failed"; error: string | null };
  details: { total: number; completed: number; failed: number; remaining: number };
  current: { collection: string; from: string; to: string } | null;
  next_run_at: string;
  next_batch_at: string | null;
};
