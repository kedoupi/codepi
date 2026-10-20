import {
  HRV_COLOR, HR_COLOR, STAGE_COLORS, maxGap, mergeStages,
  type AlignedPoint, type NightTimeline,
} from "./sleep-model.ts";
import { finite, type SleepRecord } from "./health.ts";

export const PLOT = { left: 44, right: 10, top: 8, bottom: 22, width: 760 };

const stageBand = { awake: 0, rem: 1, light: 2, deep: 3 };

export function nightWindow(night: NightTimeline): { min: number; max: number } {
  return { min: night.night.start, max: night.night.end };
}

export function xFor(minutes: number, window: { min: number; max: number }): number {
  const inner = PLOT.width - PLOT.left - PLOT.right;
  const span = Math.max(1, window.max - window.min);
  return PLOT.left + (minutes - window.min) / span * inner;
}

/** Round clock tick times inside the window, every ~2 hours. */
export function clockTicks(window: { min: number; max: number }, target = 4): number[] {
  const span = window.max - window.min;
  const step = Math.max(30, Math.ceil(span / target / 30) * 30);
  const ticks: number[] = [];
  for (let t = Math.ceil(window.min / step) * step; t < window.max; t += step) ticks.push(t);
  if (!ticks.length || ticks[0] - window.min > step) ticks.unshift(Math.round(window.min));
  if (window.max - ticks[ticks.length - 1] > step / 2) ticks.push(Math.round(window.max));
  return [...new Set(ticks)].sort((a, b) => a - b);
}

export function clockLabel(minutes: number): string {
  const wrapped = ((minutes % (24 * 60)) + 24 * 60) % (24 * 60);
  const hour = Math.floor(wrapped / 60);
  const minute = wrapped % 60;
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

export type StageRect = { x: number; y: number; width: number; height: number; color: string; stage: string };

export function stageRects(night: NightTimeline, height: number): StageRect[] {
  const window = nightWindow(night);
  const band = (height - PLOT.top - PLOT.bottom) / 4;
  const rects: StageRect[] = [];
  for (const block of mergeStages(night.stages)) {
    const y = PLOT.top + band * stageBand[block.stage];
    const x0 = xFor(block.t0, window);
    const x1 = xFor(block.t1, window);
    // Awake reads as a narrow band near the top of the chart.
    const h = block.stage === "awake" ? Math.min(band * 0.9, 10) : band * 0.92;
    rects.push({ x: x0, y: block.stage === "awake" ? y : y + (band - h) / 2, width: Math.max(1, x1 - x0), height: h, color: STAGE_COLORS[block.stage], stage: block.stage });
  }
  return rects;
}

function yScale(points: AlignedPoint[], height: number): (value: number) => number {
  const values = points.map(point => point.value).filter(finite);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const pad = Math.max(2, (max - min) * 0.15);
  const low = Math.floor(min - pad);
  const high = Math.ceil(max + pad);
  const inner = height - PLOT.top - PLOT.bottom;
  return value => PLOT.top + (1 - (value - low) / Math.max(1, high - low)) * inner;
}

export function seriesPath(points: AlignedPoint[], height: number, window: { min: number; max: number }): { line: string; circles: { x: number; y: number }[]; } {
  if (!points.length) return { line: "", circles: [] };
  const y = yScale(points, height);
  const parts: string[] = [];
  const circles: { x: number; y: number }[] = [];
  let pen = false;
  for (const point of points) {
    const x = xFor(point.t, window);
    const py = y(point.value);
    circles.push({ x, y: py });
    parts.push(`${pen ? "L" : "M"}${x.toFixed(1)} ${py.toFixed(1)}`);
    pen = true;
  }
  return { line: parts.join(" "), circles };
}

/** Split the polyline where a recording gap exceeds ~2.5 sampling intervals. */
export function seriesSegments(points: AlignedPoint[], height: number, window: { min: number; max: number }, intervalMinutes: number): string[] {
  if (points.length < 2) return [];
  const y = yScale(points, height);
  const segments: string[] = [];
  let current = `M${xFor(points[0].t, window).toFixed(1)} ${y(points[0].value).toFixed(1)}`;
  let count = 1;
  for (let index = 1; index < points.length; index++) {
    const previous = points[index - 1];
    const point = points[index];
    const x = xFor(point.t, window);
    const py = y(point.value);
    if (point.t - previous.t > intervalMinutes * 2.5) {
      if (count > 1) segments.push(current);
      current = `M${x.toFixed(1)} ${py.toFixed(1)}`;
      count = 1;
    } else {
      current += ` L${x.toFixed(1)} ${py.toFixed(1)}`;
      count++;
    }
  }
  if (count > 1) segments.push(current);
  return segments;
}

export type ChartBand = { label: string; color: string; average: number | null; unit: string; paths: string[]; ticks: { t: number; label: string }[]; gap: boolean };

export function timelineBands(night: NightTimeline, height = 110): { hr: ChartBand; hrv: ChartBand } {
  const window = nightWindow(night);
  const ticks = clockTicks(window).map(t => ({ t, label: clockLabel(t) }));
  const band = (points: AlignedPoint[], color: string, label: string, unit: string, interval: number, average: number | null): ChartBand => ({
    label, color, unit, ticks,
    average: average === null ? null : Math.round(average * 10) / 10,
    paths: seriesSegments(points, height, window, interval),
    gap: maxGap(points) > interval * 2.5,
  });
  return {
    hr: band(night.heartRate, HR_COLOR, "HR", "bpm", night.hrIntervalMinutes, averageOf(night.heartRate)),
    hrv: band(night.hrv, HRV_COLOR, "HRV", "ms", night.hrvIntervalMinutes, averageOf(night.hrv)),
  };
}

function averageOf(points: AlignedPoint[]): number | null {
  const values = points.map(point => point.value).filter(finite);
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
}

export function sleepDurationHours(record: SleepRecord | undefined): number | null {
  return record && finite(record.total_sleep_duration) ? record.total_sleep_duration / 3600 : null;
}
