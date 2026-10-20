import { calendarWindow, shiftDay } from "../../../../shared/dates.ts";
import { finite, sleepForDay, type SleepRecord, type Spo2Day, type StressDay, type TagRecord } from "./health.ts";
import type { Day } from "./types.ts";

export type Range = { from: string; to: string };

export function rollingRanges(end: string): { current: Range; previous: Range } {
  return {
    current: calendarWindow(7, end),
    previous: calendarWindow(7, shiftDay(end, -7)),
  };
}

export function daysOf(range: Range): string[] {
  const days: string[] = [];
  for (let index = 0; index < 7; index++) days.push(shiftDay(range.from, index));
  return days;
}

export function mean(values: Array<number | null>): number | null {
  const valid = values.filter((value): value is number => finite(value));
  return valid.length ? valid.reduce((sum, value) => sum + value, 0) / valid.length : null;
}

export function weekday(date: string, locale: string): string {
  const names = locale === "zh"
    ? ["周日", "周一", "周二", "周三", "周四", "周五", "周六"]
    : ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  return names[new Date(`${date}T00:00:00Z`).getUTCDay()];
}

/** Main-sleep only; duration-weighted when a day has more than one main period. */
export function nightlySeries(
  sleeps: SleepRecord[],
  range: Range,
  pick: (record: SleepRecord) => number | null | undefined,
): Array<{ date: string; value: number | null }> {
  return daysOf(range).map(date => {
    const main = sleepForDay(sleeps, date).filter(record => record.type === "long_sleep");
    const rows = main.length ? main : sleepForDay(sleeps, date).slice(0, 1);
    const weighted = rows
      .map(record => ({ value: pick(record), weight: finite(record.total_sleep_duration) ? record.total_sleep_duration : 0 }))
      .filter(row => finite(row.value) && row.weight > 0);
    if (!weighted.length) return { date, value: null };
    const total = weighted.reduce((sum, row) => sum + row.weight, 0);
    return { date, value: weighted.reduce((sum, row) => sum + (row.value as number) * row.weight, 0) / total };
  });
}

/** Strictly explicit main sleep; unmarked records never stand in. */
export function mainSleepSeries(
  sleeps: SleepRecord[],
  range: Range,
  pick: (record: SleepRecord) => number | null | undefined,
): Array<{ date: string; value: number | null }> {
  return daysOf(range).map(date => {
    const main = sleepForDay(sleeps, date).find(record => record.type === "long_sleep");
    const value = main ? pick(main) : null;
    return { date, value: finite(value) && value > 0 ? value : null };
  });
}

export function stressSeries(stress: StressDay[], range: Range, field: "stress_high" | "recovery_high") {
  const byDay = new Map(stress.map(row => [row.day, row]));
  return daysOf(range).map(date => {
    const value = byDay.get(date)?.[field];
    return { date, value: finite(value) && value >= 0 ? value / 60 : null }; // minutes
  });
}

export function spo2Series(spo2: Spo2Day[], range: Range) {
  const byDay = new Map(spo2.map(row => [row.day, row]));
  return daysOf(range).map(date => {
    const value = byDay.get(date)?.spo2_percentage?.average;
    return { date, value: finite(value) && value > 0 ? value : null };
  });
}

export function stepSeries(days: Day[], range: Range) {
  const byDay = new Map(days.map(day => [day.date, day]));
  return daysOf(range).map(date => {
    const value = byDay.get(date)?.activity?.steps;
    return { date, value: finite(value) && value >= 0 ? value : null };
  });
}

export function seriesOf(
  source: Array<{ date: string; value: number | null }>,
): { mean: number | null; count: number } {
  return { mean: mean(source.map(point => point.value)), count: source.filter(point => finite(point.value)).length };
}

/** Delta only when both windows carry at least `min` valid samples. */
export function compareSeries(
  current: Array<{ date: string; value: number | null }>,
  previous: Array<{ date: string; value: number | null }>,
  min = 3,
): { current: number; previous: number; delta: number; currentCount: number; previousCount: number } | null {
  const a = seriesOf(current);
  const b = seriesOf(previous);
  if (a.mean === null || b.mean === null || a.count < min || b.count < min) return null;
  return { current: a.mean, previous: b.mean, delta: a.mean - b.mean, currentCount: a.count, previousCount: b.count };
}

/** Dates of the two highest valid values, used to locate where change happened. */
export function peakDates(series: Array<{ date: string; value: number | null }>, count = 2): string[] {
  return series.filter(point => finite(point.value))
    .sort((a, b) => (b.value as number) - (a.value as number))
    .slice(0, count)
    .map(point => point.date);
}

export function tagsForDay(tags: TagRecord[], date: string): TagRecord[] {
  return tags.filter(tag => tag.start_day === date || tag.end_day === date
    || (tag.start_time ?? "").startsWith(date));
}

export function tagLabel(tag: TagRecord): string {
  const code = tag.custom_name || tag.tag_type_code || "tag";
  return code.replace(/^tag_/, "").replace(/_/g, " ");
}
