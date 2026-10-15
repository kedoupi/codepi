import { api, RequestError } from "./api.ts";
import type { Day } from "./types";
export { calendarWindow as dateWindow } from "../../../../shared/dates.ts";
import { calendarWindow as dateWindow, shiftDay } from "../../../../shared/dates.ts";

export type HealthCollection = {
  name: string; label: string; mode: string; records: number;
  earliest_day: string | null; latest_day: string | null; failed_windows: number;
  last_attempt: { synced_at: string | null; attempted_at: string; last_error: string | null } | null;
};
export type SyncFailure = {
  collection: string; from: string; to: string;
  code: string; requestId?: string; retryAt?: string;
};
export type SleepRecord = {
  id: string; day: string; type?: string;
  bedtime_start?: string; bedtime_end?: string;
  total_sleep_duration?: number | null; time_in_bed?: number | null;
  deep_sleep_duration?: number | null; rem_sleep_duration?: number | null;
  light_sleep_duration?: number | null; awake_time?: number | null;
  average_hrv?: number | null; average_heart_rate?: number | null;
  lowest_heart_rate?: number | null; average_breath?: number | null;
  efficiency?: number | null;
};
type SleepResponse = {
  records: SleepRecord[]; next_offset: number | null;
  sync: { synced_at: string | null; error: string | null; window_verified: boolean };
};

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
export async function readSleep(from: string, to: string, signal?: AbortSignal): Promise<SleepResponse> {
  const records: SleepRecord[] = [];
  let offset = 0;
  // The API caps both rows and bytes. Follow every page before presenting totals.
  for (let page = 0; page < 250; page++) {
    const result = await api<SleepResponse>(`/api/me/health-records?${new URLSearchParams({ collection: "sleep", from, to, offset: String(offset) })}`, { signal });
    if (!Array.isArray(result.records)) throw new RequestError("invalid_response", 502);
    records.push(...result.records);
    if (result.next_offset === null) return { ...result, records };
    if (!Number.isInteger(result.next_offset) || result.next_offset <= offset) throw new RequestError("invalid_response", 502);
    offset = result.next_offset;
  }
  throw new RequestError("sync_window_too_large", 422);
}
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
  scores: { status: "pending" | "completed" | "failed"; error: string | null };
  details: { total: number; completed: number; failed: number; remaining: number };
  current: { collection: string; from: string; to: string } | null;
  next_run_at: string;
  next_batch_at: string | null;
};
