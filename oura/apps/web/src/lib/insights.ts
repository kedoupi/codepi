import { SLEEP_LABELS, avg, fmtDelta, round0, round1, trendDelta } from "./format";
import type { Day } from "./types";

export function buildInsights(days30: Day[], days90: Day[]): string[] {
  const items: string[] = [];
  const s30 = avg(days30.map((d) => d.sleep && d.sleep.score));
  const r30 = avg(days30.map((d) => d.readiness && d.readiness.score));
  const steps30 = avg(days30.map((d) => d.activity && d.activity.steps));
  const s90 = avg(days90.map((d) => d.sleep && d.sleep.score));
  const r90 = avg(days90.map((d) => d.readiness && d.readiness.score));

  const sleepTrend = trendDelta(days30.map((d) => d.sleep && d.sleep.score));
  const readyTrend = trendDelta(days30.map((d) => d.readiness && d.readiness.score));
  const actTrend = trendDelta(days30.map((d) => d.activity && d.activity.score));

  if (s30 != null && r30 != null) {
    items.push("近 30 天睡眠均值 " + round1(s30) + "，准备度均值 " + round1(r30) + "。");
  }
  if (sleepTrend != null) {
    if (sleepTrend >= 2)
      items.push("近半程睡眠得分相对前半程提升 " + round1(sleepTrend) + "，恢复趋势向好。");
    else if (sleepTrend <= -2)
      items.push(
        "近半程睡眠得分相对前半程下降 " +
          round1(Math.abs(sleepTrend)) +
          "，建议关注入睡与总时长。",
      );
    else items.push("近 30 天睡眠得分整体平稳（半程差 " + fmtDelta(sleepTrend) + "）。");
  }
  if (readyTrend != null) {
    if (readyTrend >= 2) items.push("准备度近半程上升 " + round1(readyTrend) + "，恢复状态改善。");
    else if (readyTrend <= -2)
      items.push(
        "准备度近半程下降 " +
          round1(Math.abs(readyTrend)) +
          "，留意体温与前夜睡眠贡献项。",
      );
  }
  if (steps30 != null) {
    items.push(
      "近 30 天日均步数约 " +
        round0(steps30) +
        " 步" +
        (actTrend != null && Math.abs(actTrend) >= 2
          ? "，活动得分半程差 " + fmtDelta(actTrend) + "。"
          : "。"),
    );
  }
  if (s30 != null && s90 != null) {
    const d = s30 - s90;
    if (Math.abs(d) >= 1.5) {
      items.push(
        "近 30 天睡眠相对 90 天均值" +
          (d > 0 ? "偏高 " : "偏低 ") +
          round1(Math.abs(d)) +
          " 分。",
      );
    } else {
      items.push("近 30 天与 90 天睡眠均值接近（差 " + fmtDelta(d) + "）。");
    }
  }
  if (r30 != null && r90 != null && Math.abs(r30 - r90) >= 1.5) {
    items.push(
      "准备度 30 天相对 90 天" +
        (r30 > r90 ? "偏高 " : "偏低 ") +
        round1(Math.abs(r30 - r90)) +
        " 分。",
    );
  }

  const latest = days90[days90.length - 1];
  if (latest && latest.sleep && latest.sleep.contributors) {
    const c = latest.sleep.contributors;
    const ranked = Object.keys(SLEEP_LABELS)
      .map((k) => ({ k, v: c[k] }))
      .filter((x) => typeof x.v === "number")
      .sort((a, b) => (a.v as number) - (b.v as number));
    if (ranked.length) {
      const weak = ranked[0];
      items.push(
        "最新睡眠最弱项是「" + SLEEP_LABELS[weak.k] + "」（" + Math.round(weak.v as number) + "）。",
      );
    }
  }
  if (latest && latest.readiness && typeof latest.readiness.temperature_deviation === "number") {
    const td = latest.readiness.temperature_deviation;
    if (Math.abs(td) >= 0.2) {
      items.push(
        "最新体温偏差 " +
          (td > 0 ? "+" : "") +
          td.toFixed(2) +
          "°C，可结合准备度体温项一并看。",
      );
    }
  }
  return items.slice(0, 6);
}
