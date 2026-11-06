import type { DailyMetrics, DailyMetricsRow, DayType } from "./models";
import { weekdayOf } from "./state";

const MOMENT_FIELDS = [
  ["leaveHomeMinute", "离家"],
  ["startWorkMinute", "开始办公"],
  ["leaveComputerMinute", "离开电脑"],
  ["arriveHomeMinute", "到家"],
] as const;

type NumericMetric = keyof Pick<DailyMetrics,
  "commuteToWorkMinutes" | "commuteHomeMinutes" | "officeActiveMinutes" | "homeMinutes"
  | "officeSpanMinutes" | "afterWorkWorkMachineMinutes" | "weekendWorkMachineMinutes"
  | "topAppMinutes"
>;

export type MetricAverage = {
  days: number;
  dayType: DayType | "all";
  commuteToWorkMinutes: number | null;
  commuteHomeMinutes: number | null;
  officeActiveMinutes: number | null;
  meetingMinutes?: number | null;
  homeMinutes: number | null;
  officeSpanMinutes: number | null;
  afterWorkWorkMachineMinutes: number | null;
  weekendWorkMachineMinutes: number | null;
  topAppMinutes: number | null;
  statusMinutes: Record<string, number>;
  appCategoryMinutes: Record<string, number>;
  focus: {
    segmentCount: number | null;
    totalMinutes: number | null;
    longestMinutes: number | null;
    communicationInterruptions: number | null;
  };
};

export type TrendDay = {
  date: string;
  dayType: DayType | null;
  missing: boolean;
  computedAt?: string;
  metrics: DailyMetrics | null;
};

function average(values: Array<number | null | undefined>): number | null {
  const usable = values.filter((value): value is number => typeof value === "number" && Number.isFinite(value));
  return usable.length ? usable.reduce((sum, value) => sum + value, 0) / usable.length : null;
}

function averageMap(rows: DailyMetricsRow[], pick: (metrics: DailyMetrics) => Record<string, number>): Record<string, number> {
  const sums = new Map<string, { total: number; count: number }>();
  for (const row of rows) {
    for (const [key, value] of Object.entries(pick(row.metrics))) {
      if (!Number.isFinite(value)) continue;
      const current = sums.get(key) ?? { total: 0, count: 0 };
      current.total += value;
      current.count += 1;
      sums.set(key, current);
    }
  }
  return Object.fromEntries([...sums.entries()].map(([key, value]) => [key, value.total / value.count]));
}

function averageFiltered(filtered: DailyMetricsRow[], dayType: DayType | "all"): MetricAverage {
  const first = (field: NumericMetric) => average(filtered.map(row => row.metrics[field]));
  return {
    days: filtered.length,
    dayType,
    commuteToWorkMinutes: first("commuteToWorkMinutes"),
    commuteHomeMinutes: first("commuteHomeMinutes"),
    officeActiveMinutes: first("officeActiveMinutes"),
    meetingMinutes: average(filtered.map(row => row.metrics.officeMeetingMinutes ?? null)),
    homeMinutes: first("homeMinutes"),
    officeSpanMinutes: first("officeSpanMinutes"),
    afterWorkWorkMachineMinutes: first("afterWorkWorkMachineMinutes"),
    weekendWorkMachineMinutes: first("weekendWorkMachineMinutes"),
    topAppMinutes: first("topAppMinutes"),
    statusMinutes: averageMap(filtered, metrics => metrics.statusMinutes),
    appCategoryMinutes: averageMap(filtered, metrics => metrics.appCategoryMinutes),
    focus: {
      segmentCount: average(filtered.map(row => row.metrics.focus.segmentCount)),
      totalMinutes: average(filtered.map(row => row.metrics.focus.totalMinutes)),
      longestMinutes: average(filtered.map(row => row.metrics.focus.longestMinutes)),
      communicationInterruptions: average(filtered.map(row => row.metrics.focus.communicationInterruptions)),
    },
  };
}

export function averageMetrics(rows: DailyMetricsRow[], dayType: DayType): MetricAverage {
  return averageFiltered(rows.filter(row => row.metrics.dayType === dayType), dayType);
}

export function averageAllMetrics(rows: DailyMetricsRow[]): MetricAverage {
  return averageFiltered(rows, "all");
}

export function trendDays(from: string, to: string, rows: DailyMetricsRow[]): TrendDay[] {
  const byDate = new Map(rows.map(row => [row.date, row]));
  const result: TrendDay[] = [];
  for (let at = Date.parse(`${from}T00:00:00+08:00`); at <= Date.parse(`${to}T00:00:00+08:00`); at += 86400_000) {
    const date = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai" }).format(new Date(at));
    const row = byDate.get(date);
    result.push(row
      ? { date, dayType: row.metrics.dayType, missing: false, computedAt: row.computedAt, metrics: row.metrics }
      : { date, dayType: null, missing: true, metrics: null });
  }
  return result;
}

/** 该日所在周的周一（YYYY-MM-DD）。按 UTC 日历日计算，避免时区把星期算错一天。 */
export function weekStart(date: string): string {
  const epoch = Date.parse(`${date}T00:00:00Z`);
  const weekday = weekdayOf(date);
  const mondayOffset = weekday === 0 ? -6 : 1 - weekday;
  return new Date(epoch + mondayOffset * 86400_000).toISOString().slice(0, 10);
}

export type AnomalyReason = {
  metric: string;
  actual: number;
  average: number;
  delta: number;
};

export type Anomaly = {
  date: string;
  dayType: DayType;
  sampleDays: number;
  reasons: AnomalyReason[];
};

export const ANOMALY_BASELINE_DAYS = 30;
export const ANOMALY_MIN_PEERS = 5;
export const ANOMALY_BASELINE = "该日之前近 30 天的同类日（工作日 / 休息日）平均；同类日不足 5 天时不判断。";

function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00+08:00`) - Date.parse(`${from}T00:00:00+08:00`)) / 86400_000);
}

/**
 * 和平时比：基线是「该日之前近 30 天」的同类日，不含该日本身和它之后的日子。
 * `rows` 需要包含被判断区间之前 30 天的汇总；只对 `targetFrom` 及之后的日子给出结论。
 */
export function findAnomalies(
  rows: DailyMetricsRow[],
  thresholds: { earlyLateMinutes: number; commutePercent: number },
  targetFrom = rows[0]?.date ?? "",
): { anomalies: Anomaly[]; insufficientSample: Array<{ date: string; dayType: DayType; sampleDays: number; reason: string }> } {
  const anomalies: Anomaly[] = [];
  const insufficientSample: Array<{ date: string; dayType: DayType; sampleDays: number; reason: string }> = [];
  for (const row of rows) {
    if (row.date < targetFrom) continue;
    const peers = rows.filter(peer => peer.metrics.dayType === row.metrics.dayType && peer.date < row.date
      && daysBetween(peer.date, row.date) <= ANOMALY_BASELINE_DAYS);
    if (peers.length < ANOMALY_MIN_PEERS) {
      insufficientSample.push({ date: row.date, dayType: row.metrics.dayType, sampleDays: peers.length, reason: "同类日样本不足 5 天" });
      continue;
    }
    const reasons: AnomalyReason[] = [];
    for (const [field, label] of MOMENT_FIELDS) {
      const actual = row.metrics[field];
      const baseline = average(peers.map(peer => peer.metrics[field]));
      if (actual === null || baseline === null) continue;
      const delta = actual - baseline;
      if (Math.abs(delta) >= thresholds.earlyLateMinutes) reasons.push({ metric: label, actual, average: baseline, delta });
    }
    for (const [field, label] of [["commuteToWorkMinutes", "上班通勤"], ["commuteHomeMinutes", "下班通勤"]] as const) {
      const actual = row.metrics[field];
      const baseline = average(peers.map(peer => peer.metrics[field]));
      if (actual === null || baseline === null || baseline <= 0) continue;
      const delta = actual - baseline;
      if (delta / baseline >= thresholds.commutePercent / 100) reasons.push({ metric: label, actual, average: baseline, delta });
    }
    if (reasons.length) anomalies.push({ date: row.date, dayType: row.metrics.dayType, sampleDays: peers.length, reasons });
  }
  return { anomalies, insufficientSample };
}

export function coverageTier(ratio: number | null): "high" | "medium" | "low" | "unknown" {
  if (ratio === null || !Number.isFinite(ratio)) return "unknown";
  if (ratio >= 0.99) return "high";
  if (ratio >= 0.95) return "medium";
  return "low";
}

export function qualityDays(days: TrendDay[]) {
  return days.map(day => ({
    date: day.date,
    missing: day.missing,
    coverage: day.metrics?.coverage.ratio ?? null,
    tier: coverageTier(day.metrics?.coverage.ratio ?? null),
    gapReasonMinutes: day.metrics?.coverage.gapReasonMinutes ?? {
      home_scan_missing: null,
      phone_scan_missing: null,
      work_machine_missing: null,
    },
  }));
}
