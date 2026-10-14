import { calendarDays, dateWindow, finite, latestDay, scoreDelta, sleepForDay, type SleepRecord } from "./health.ts";
import type { Day } from "./types.ts";

export type JournalPoint = { date: string; value: number | null };
export type JournalSeries = { label: string; color: string; points: JournalPoint[] };
export const journalColors = { sleep: "#52758b", readiness: "#60765c", activity: "#ad491e", hrv: "#ad491e" };
export const scoreKeys = ["sleep", "readiness", "activity"] as const;
export type ScoreKey = typeof scoreKeys[number];

export function validScore(value: unknown): number | null {
  return finite(value) && value >= 0 && value <= 100 ? value : null;
}

export function mean(points: JournalPoint[]): number | null {
  const values = points.map(p => p.value).filter(finite);
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
}

export function latestPoint(points: JournalPoint[]): JournalPoint | undefined {
  return points.filter(p => finite(p.value)).at(-1);
}

export function journalData(days: Day[], sleeps: SleepRecord[], end: string) {
  // Normalize once so out-of-range scores never enter summaries or graphs.
  const cleanDays = days.map(day => ({
    ...day,
    ...Object.fromEntries(scoreKeys.map(key => [key, { ...day[key], score: validScore(day[key]?.score) }])),
  })) as Day[];
  const calendar = calendarDays(cleanDays, 90, end);
  const recent = calendar.slice(-30);
  const sleepRows = recent.map(day => ({ date: day.date, row: sleepForDay(sleeps, day.date)[0] }));
  const sleep = sleepRows.map(({ date, row }) => ({
    date,
    value: finite(row?.total_sleep_duration) && row.total_sleep_duration >= 0 ? row.total_sleep_duration / 3600 : null,
  }));
  // HRV is explicitly a main-sleep measure. A nap must not silently replace it.
  const hrv = sleepRows.map(({ date, row }) => ({
    date,
    value: row?.type === "long_sleep" && finite(row.average_hrv) && row.average_hrv > 0 ? row.average_hrv : null,
  }));
  const steps = recent.map(day => ({
    date: day.date,
    value: finite(day.activity?.steps) && day.activity.steps >= 0 ? day.activity.steps : null,
  }));
  const latest = latestDay(calendar);
  const comparisons = latest ? scoreKeys.map(key => ({ key, delta: scoreDelta(calendar, latest, key) }))
    .filter(row => row.delta !== null).sort((a, b) => Math.abs(b.delta!.value) - Math.abs(a.delta!.value)) : [];
  return { calendar, recent, sleep, hrv, steps, latest, comparison: comparisons[0] ?? null };
}

export function scorePoints(days: Day[], key: ScoreKey): JournalPoint[] {
  return days.map(day => ({ date: day.date, value: validScore(day[key]?.score) }));
}

export function historicalHrvRange(points: JournalPoint[], selectedDate: string) {
  const from = dateWindow(31, selectedDate).from;
  const values = points.filter(p => p.date >= from && p.date < selectedDate)
    .map(p => p.value).filter((v): v is number => finite(v) && v > 0).sort((a, b) => a - b);
  if (values.length < 14) return null;
  const quantile = (p: number) => {
    const index = (values.length - 1) * p;
    const lower = Math.floor(index);
    return values[lower] + (values[Math.ceil(index)] - values[lower]) * (index - lower);
  };
  return { low: quantile(0.25), high: quantile(0.75), count: values.length };
}

export function readinessColor(score: number | null) {
  if (score === null) return "transparent";
  if (score < 60) return "#e2e7df";
  if (score < 70) return "#b8c6b2";
  if (score < 80) return "#899e80";
  if (score < 90) return "#587350";
  return "#2d4d35";
}
