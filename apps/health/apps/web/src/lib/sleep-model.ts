import {
  duration, finite, seriesPoints, sleepForDay, stagePoints,
  type SleepRecord, type SleepSeriesPoint, type SleepStagePoint,
} from "./health.ts";

export const STAGE_COLORS: Record<SleepStagePoint["stage"], string> = {
  deep: "#36465f",
  rem: "#9d739b",
  light: "#f4aa69",
  awake: "#eadfd4",
};
export const HR_COLOR = "#6f7f72";
export const HRV_COLOR = "#ad491e";

const SAMPLE_MIN = 5;
const CIRCADIAN_MIN = 20 * 60; // 20:00

export type TimestampParts = {
  date: string; time: string; ms: number; offsetMinutes: number; minutes: number;
};

/** Keep the recorded local wall time and offset instead of the browser timezone. */
export function parseTimestamp(value: unknown): TimestampParts | null {
  if (typeof value !== "string") return null;
  const match = value.match(/^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?([+-]\d{2}:\d{2}|Z)$/);
  if (!match) return null;
  const [, date, hour, minute, second = "0", zone] = match;
  const offsetMinutes = zone === "Z" ? 0 : offsetOf(zone);
  const ms = Date.parse(value);
  if (!Number.isFinite(ms)) return null;
  // Recover the recorded local wall time; Date.parse already normalized to UTC.
  const wall = zone === "Z" ? new Date(ms) : new Date(ms + offsetOf(zone) * 60_000);
  const minutes = wall.getUTCHours() * 60 + wall.getUTCMinutes();
  return { date, time: `${hour}:${minute}`, ms, offsetMinutes, minutes };
}

function offsetOf(zone: string): number {
  const [zh = "0", zm = "0"] = zone.slice(1).split(":");
  return (Number(zh) * 60 + Number(zm)) * (zone.startsWith("-") ? -1 : 1);
}

/** Minutes since 20:00 on the evening the sleep belongs to; crosses midnight. */
export function circadianMinutes(parts: TimestampParts): number {
  return parts.minutes < CIRCADIAN_MIN ? parts.minutes + 24 * 60 : parts.minutes;
}

export type NightInterval = {
  start: number; end: number; startLabel: string; endLabel: string;
  startMs: number | null; endMs: number | null;
};

export function nightInterval(record: SleepRecord): NightInterval | null {
  const start = parseTimestamp(record.bedtime_start);
  const end = parseTimestamp(record.bedtime_end);
  if (!start || !end) return null;
  const startMin = circadianMinutes(start);
  let endMin = circadianMinutes(end);
  if (endMin <= startMin) endMin += 24 * 60;
  if (endMin - startMin > 24 * 60) return null;
  return {
    start: startMin, end: endMin, startLabel: start.time, endLabel: end.time,
    startMs: start.ms, endMs: end.ms,
  };
}

export type AlignedPoint = SleepSeriesPoint & { t: number };
export type AlignedStage = SleepStagePoint & { t0: number; t1: number };

/** Project the 5-minute stage string onto the recorded bedtime window. */
export function alignStages(record: SleepRecord, night: NightInterval): AlignedStage[] {
  const raw = stagePoints(record);
  if (!raw.length) return [];
  // The stage string starts at the recorded bedtime and steps 5 minutes.
  const points: AlignedStage[] = [];
  for (const point of raw) {
    const t0 = night.start + (point.offset ?? 0) / 60;
    points.push({ ...point, t0, t1: t0 + SAMPLE_MIN });
  }
  return points;
}

export function alignSeries(record: SleepRecord, night: NightInterval, series: SleepRecord["hrv"]): AlignedPoint[] {
  const raw = seriesPoints(record, series);
  if (!raw.length) return [];
  // When bedtime bounds exist, the series starts at bedtime and items step by
  // the interval. Offsets are more faithful than the midnight-anchored stamps.
  if (record.bedtime_start && record.bedtime_end) {
    return raw
      .map(point => ({ ...point, t: night.start + (point.offset ?? 0) / 60 }))
      .filter(point => point.t >= night.start - SAMPLE_MIN && point.t <= night.end + SAMPLE_MIN);
  }
  const points: AlignedPoint[] = [];
  for (const point of raw) {
    if (point.at === null) continue;
    const parts = parseTimestamp(point.at);
    if (!parts) continue;
    let t = circadianMinutes(parts);
    if (t < night.start - 12 * 60) t += 24 * 60;
    if (t < night.start - SAMPLE_MIN || t > night.end + SAMPLE_MIN) continue;
    points.push({ ...point, t });
  }
  return points;
}

export function meanOf(points: Array<{ value: number }>): number | null {
  const values = points.map(point => point.value).filter(finite);
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
}

export function seriesAverage(points: AlignedPoint[]): number | null {
  const value = meanOf(points);
  return value === null ? null : Math.round(value * 10) / 10;
}

export function seriesMin(points: AlignedPoint[]): number | null {
  const values = points.map(point => point.value).filter(finite);
  return values.length ? Math.min(...values) : null;
}

/** Largest gap between consecutive valid samples, in minutes. */
export function maxGap(points: AlignedPoint[]): number {
  let gap = 0;
  for (let index = 1; index < points.length; index++) {
    gap = Math.max(gap, points[index].t - points[index - 1].t);
  }
  return gap;
}

export type StageBlock = { stage: SleepStagePoint["stage"]; t0: number; t1: number };

export function mergeStages(points: AlignedStage[]): StageBlock[] {
  const blocks: StageBlock[] = [];
  for (const point of points) {
    const last = blocks[blocks.length - 1];
    if (last && last.stage === point.stage) last.t1 = point.t1;
    else blocks.push({ stage: point.stage, t0: point.t0, t1: point.t1 });
  }
  return blocks;
}

export type NightTimeline = {
  night: NightInterval;
  stages: AlignedStage[];
  heartRate: AlignedPoint[];
  hrv: AlignedPoint[];
  hrIntervalMinutes: number;
  hrvIntervalMinutes: number;
};

function seriesIntervalMinutes(series: SleepRecord["hrv"], fallback: number): number {
  return series && finite(series.interval) && series.interval > 0 ? series.interval / 60 : fallback;
}

export function buildTimeline(record: SleepRecord): NightTimeline | null {
  const night = nightInterval(record);
  if (!night) return null;
  return {
    night,
    stages: alignStages(record, night),
    heartRate: alignSeries(record, night, record.heart_rate),
    hrv: alignSeries(record, night, record.hrv),
    hrIntervalMinutes: seriesIntervalMinutes(record.heart_rate, SAMPLE_MIN),
    hrvIntervalMinutes: seriesIntervalMinutes(record.hrv, SAMPLE_MIN),
  };
}

/** Prefer duration columns; fall back to the stage string when they are missing. */
export function stageDurations(record: SleepRecord, stages: AlignedStage[]) {
  const fallback: Record<SleepStagePoint["stage"], number> = { deep: 0, rem: 0, light: 0, awake: 0 };
  for (const point of stages) fallback[point.stage] += (point.t1 - point.t0) * 60;
  const value = (column: number | null | undefined, key: SleepStagePoint["stage"]) =>
    finite(column) && column >= 0 ? column : fallback[key] || null;
  return [
    { key: "deep", seconds: value(record.deep_sleep_duration, "deep"), color: STAGE_COLORS.deep },
    { key: "rem", seconds: value(record.rem_sleep_duration, "rem"), color: STAGE_COLORS.rem },
    { key: "light", seconds: value(record.light_sleep_duration, "light"), color: STAGE_COLORS.light },
    { key: "awake", seconds: value(record.awake_time, "awake"), color: STAGE_COLORS.awake },
  ] as const;
}

export function totalStageSeconds(stages: ReadonlyArray<{ seconds: number | null }>): number {
  return stages.reduce((sum, stage) => sum + (finite(stage.seconds) ? stage.seconds : 0), 0);
}

/** Minutes difference between this night and the median of earlier saved nights. */
export function durationVsMedian(records: SleepRecord[], selected: SleepRecord): { delta: number; count: number } | null {
  if (!finite(selected.total_sleep_duration) || selected.total_sleep_duration <= 0) return null;
  const values = records
    .filter(record => record.day < selected.day)
    .map(record => sleepForDay([record], record.day)[0])
    .map(record => record?.total_sleep_duration)
    .filter((value): value is number => finite(value) && value > 0)
    .sort((a, b) => a - b);
  if (values.length < 5) return null;
  const middle = values.length / 2;
  const median = values.length % 2 ? values[Math.floor(middle)] : (values[middle - 1] + values[middle]) / 2;
  return { delta: Math.round((selected.total_sleep_duration - median) / 60), count: values.length };
}

export type HistoryRange = { low: number; high: number; min: number; max: number; count: number };

/** Personal middle-50% reference band from main-sleep HRV before the selected night. */
export function hrvHistoryRange(records: SleepRecord[], selected: SleepRecord): HistoryRange | null {
  const values = records
    .filter(record => record.type === "long_sleep" && record.day < selected.day
      && finite(record.average_hrv) && record.average_hrv > 0)
    .map(record => record.average_hrv as number)
    .sort((a, b) => a - b);
  if (values.length < 14) return null;
  const quantile = (p: number) => {
    const index = (values.length - 1) * p;
    const lower = Math.floor(index);
    return values[lower] + (values[Math.ceil(index)] - values[lower]) * (index - lower);
  };
  return { low: quantile(0.25), high: quantile(0.75), min: values[0], max: values[values.length - 1], count: values.length };
}

export type RoutineNight = { day: string; start: number; end: number; startLabel: string; endLabel: string };

/** Bedtime-to-rise window for the main sleep of each saved night. */
export function routineNights(records: SleepRecord[], count: number, end: string): RoutineNight[] {
  const nights: RoutineNight[] = [];
  const days = [...new Set(records.map(record => record.day))].sort().filter(day => day <= end).slice(-count);
  for (const day of days) {
    const main = sleepForDay(records, day)[0];
    if (!main) continue;
    const night = nightInterval(main);
    if (!night) continue;
    nights.push({ day, start: night.start, end: night.end, startLabel: night.startLabel, endLabel: night.endLabel });
  }
  return nights;
}
