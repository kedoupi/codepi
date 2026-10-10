import type { Day } from "./types";

export const BUILD = "20260914-1735-ai-now+oauth";

export const SLEEP_LABELS: Record<string, string> = {
  deep_sleep: "深睡",
  efficiency: "效率",
  latency: "入睡",
  rem_sleep: "REM",
  restfulness: "安稳",
  timing: "时段",
  total_sleep: "总时长",
};

export const READY_LABELS: Record<string, string> = {
  activity_balance: "活动平衡",
  body_temperature: "体温",
  hrv_balance: "HRV",
  previous_day_activity: "前日活动",
  previous_night: "前夜睡眠",
  recovery_index: "恢复指数",
  resting_heart_rate: "静息心率",
  sleep_balance: "睡眠平衡",
};

export const READY_SHORT: Record<string, string> = {
  activity_balance: "活动",
  body_temperature: "体温",
  hrv_balance: "HRV",
  previous_day_activity: "前日",
  previous_night: "前夜",
  recovery_index: "恢复",
  resting_heart_rate: "静息",
  sleep_balance: "睡平",
};

export const WDAY = ["一", "二", "三", "四", "五", "六", "日"];

export function avg(nums: unknown[]): number | null {
  const v = nums.filter((n): n is number => typeof n === "number" && !Number.isNaN(n));
  if (!v.length) return null;
  return v.reduce((a, b) => a + b, 0) / v.length;
}

export function round1(n: number | null | undefined): string {
  return n == null ? "—" : (Math.round(n * 10) / 10).toFixed(1).replace(/\.0$/, "");
}

export function round0(n: number | null | undefined): string {
  return n == null ? "—" : String(Math.round(n));
}

export function sliceDays(allDays: Day[], n: number): Day[] {
  if (!allDays.length) return [];
  return allDays.slice(Math.max(0, allDays.length - n));
}

export function shortDate(d: string | null | undefined): string {
  if (!d) return "";
  const p = d.split("-");
  return p[1] + "/" + p[2];
}

export function isWeekend(dateStr: string | null | undefined): boolean {
  if (!dateStr) return false;
  const wd = new Date(dateStr + "T00:00:00").getDay();
  return wd === 0 || wd === 6;
}

export function weekendTag(dateStr: string | null | undefined): string {
  if (!dateStr) return "";
  const wd = new Date(dateStr + "T00:00:00").getDay();
  if (wd === 6) return "六";
  if (wd === 0) return "日";
  return "";
}

export function axisLabel(dateStr: string): string {
  const base = shortDate(dateStr);
  const tag = weekendTag(dateStr);
  return tag ? base + tag : base;
}

export function wdayLabel(dateStr: string): string {
  const d = new Date(dateStr + "T00:00:00");
  return WDAY[(d.getDay() + 6) % 7];
}

export function trendDelta(series: unknown[]): number | null {
  if (series.length < 8) return null;
  const half = Math.floor(series.length / 2);
  const a = avg(series.slice(0, half));
  const b = avg(series.slice(half));
  if (a == null || b == null) return null;
  return b - a;
}

export function fmtDelta(d: number | null | undefined): string {
  if (d == null) return "";
  const sign = d > 0 ? "+" : "";
  return sign + round1(d);
}

export function rangeLabelText(n: number): string {
  if (n === 7) return "睡眠 · 准备度 · 活动 · 近一周";
  return "睡眠 · 准备度 · 活动 · 近 " + n + " 天";
}

export function rangeAvgWord(n: number): string {
  return n === 7 ? "周均" : n + " 天均";
}

export function metricTrendPhrase(name: string, delta: number | null): string {
  if (delta == null) return name + "数据不足";
  if (delta >= 2) return name + "后半程↑" + round1(delta);
  if (delta <= -2) return name + "后半程↓" + round1(Math.abs(delta));
  return name + "平稳(" + fmtDelta(delta) + ")";
}

export function readinessColor(score: number | null | undefined): string {
  if (score == null) return "#fff7ed";
  if (score >= 85) return "#f97316";
  if (score >= 75) return "#fb923c";
  if (score >= 65) return "#fdba74";
  if (score >= 50) return "#fed7aa";
  return "#ffedd5";
}

export function sparkPaths(series: unknown[]): { line: string; area: string } | null {
  const vals = series.filter((n): n is number => typeof n === "number" && !Number.isNaN(n));
  if (vals.length < 2) return null;
  const w = 120;
  const h = 56;
  let min = Math.min.apply(null, vals);
  let max = Math.max.apply(null, vals);
  if (max === min) {
    min -= 1;
    max += 1;
  }
  const pad = 2;
  const pts = vals.map((v, i) => {
    const x = pad + (i / (vals.length - 1)) * (w - pad * 2);
    const y = pad + (1 - (v - min) / (max - min)) * (h - pad * 2);
    return [x, y] as const;
  });
  const line = pts.map((p, i) => (i ? "L" : "M") + p[0].toFixed(1) + " " + p[1].toFixed(1)).join(" ");
  const area =
    line +
    " L" +
    pts[pts.length - 1][0].toFixed(1) +
    " " +
    h +
    " L" +
    pts[0][0].toFixed(1) +
    " " +
    h +
    " Z";
  return { line, area };
}

export function sortDays(days: Day[]): Day[] {
  return days.slice().sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
}

export function num(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}
