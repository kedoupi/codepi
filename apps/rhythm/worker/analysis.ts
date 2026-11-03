import type { DailyMetrics, DailyMetricsRow, DayType } from "./models";

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

export function weekStart(date: string): string {
  const epoch = Date.parse(`${date}T00:00:00+08:00`);
  const weekday = new Date(epoch).getUTCDay();
  const mondayOffset = weekday === 0 ? -6 : 1 - weekday;
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai" })
    .format(new Date(epoch + mondayOffset * 86400_000));
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

export function findAnomalies(
  rows: DailyMetricsRow[],
  thresholds: { earlyLateMinutes: number; commutePercent: number },
): { anomalies: Anomaly[]; insufficientSample: Array<{ date: string; dayType: DayType; sampleDays: number; reason: string }> } {
  const anomalies: Anomaly[] = [];
  const insufficientSample: Array<{ date: string; dayType: DayType; sampleDays: number; reason: string }> = [];
  for (const row of rows) {
    const peers = rows.filter(peer => peer.date !== row.date && peer.metrics.dayType === row.metrics.dayType);
    if (peers.length < 5) {
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
