/** Template-generated Chinese secondary interpretation. Does not change official scores. */
import { calendarDay, calendarWindow, shiftDay, DISPLAY_TIME_ZONE } from "../../../../shared/dates.ts";

export type InsightDay = {
  date: string;
  sleep?: {
    score?: number | null;
    contributors?: Record<string, number | null | undefined>;
  } | null;
  readiness?: {
    score?: number | null;
    contributors?: Record<string, number | null | undefined>;
  } | null;
  activity?: {
    score?: number | null;
    steps?: number | null;
  } | null;
};

export type PeriodAvgs = {
  sleep: number | null;
  readiness: number | null;
  activity: number | null;
  steps: number | null;
};
export type SampleCounts = Record<keyof PeriodAvgs, number>;
export const MIN_COMPARISON_DAYS = 3;

export type DateRange = { from: string; to: string };

export type WeeklyReport = {
  summaries: string[];
  tips: string[];
  teaser: string[];
  thisPeriod: DateRange;
  lastPeriod: DateRange;
  disclaimer: string;
  avgs: { thisWeek: PeriodAvgs; lastWeek: PeriodAvgs };
  sampleCounts: { thisWeek: SampleCounts; lastWeek: SampleCounts };
};

export type CompareColumn = PeriodAvgs & {
  label: string;
  from: string;
  to: string;
  days: number;
  samples: SampleCounts;
};

export type CompareReport = {
  mode: "week" | "range";
  left: CompareColumn;
  right: CompareColumn;
};

export const DISCLAIMER_ZH = "非医疗建议";
export const TEASER_LINE_COUNT = 3;

const SLEEP_LABELS: Record<string, string> = {
  deep_sleep: "深睡",
  efficiency: "效率",
  latency: "入睡",
  rem_sleep: "REM",
  restfulness: "安稳",
  timing: "时段",
  total_sleep: "总时长",
};

const READY_LABELS: Record<string, string> = {
  activity_balance: "活动平衡",
  body_temperature: "体温",
  hrv_balance: "HRV",
  previous_day_activity: "前日活动",
  previous_night: "前夜睡眠",
  recovery_index: "恢复指数",
  resting_heart_rate: "静息心率",
  sleep_balance: "睡眠平衡",
};

export function avg(nums: unknown[]): number | null {
  const v = nums.filter((n): n is number => typeof n === "number" && Number.isFinite(n));
  if (!v.length) return null;
  return v.reduce((a, b) => a + b, 0) / v.length;
}

export function round1(n: number | null | undefined): string {
  return n == null ? "—" : (Math.round(n * 10) / 10).toFixed(1).replace(/\.0$/, "");
}

export function round0(n: number | null | undefined): string {
  return n == null ? "—" : String(Math.round(n));
}

export function sortDays<T extends { date: string }>(days: T[]): T[] {
  return [...days].sort((a, b) => a.date.localeCompare(b.date));
}

export function splitRollingWeeks<T extends { date: string }>(
  days: T[],
  end = calendarDay(),
): { thisWeek: T[]; lastWeek: T[] } {
  return {
    thisWeek: daysInWindow(days, calendarWindow(7, end)),
    lastWeek: daysInWindow(days, calendarWindow(7, shiftDay(end, -7))),
  };
}

export function daysInWindow<T extends { date: string }>(days: T[], range: DateRange): T[] {
  // Count calendar days once, even when a caller supplies duplicate records.
  return sortDays([...new Map(days.filter(day => day.date >= range.from && day.date <= range.to)
    .map(day => [day.date, day])).values()]);
}

function metricValues(days: InsightDay[], key: keyof PeriodAvgs): number[] {
  return days.map(day => key === "steps" ? day.activity?.steps : day[key]?.score)
    .filter((value): value is number => typeof value === "number" && Number.isFinite(value)
      && value >= 0 && (key === "steps" || value <= 100));
}

export function sampleCounts(days: InsightDay[]): SampleCounts {
  return {
    sleep: metricValues(days, "sleep").length,
    readiness: metricValues(days, "readiness").length,
    activity: metricValues(days, "activity").length,
    steps: metricValues(days, "steps").length,
  };
}

export function windowAverages(days: InsightDay[]): PeriodAvgs {
  return {
    sleep: avg(metricValues(days, "sleep")),
    readiness: avg(metricValues(days, "readiness")),
    activity: avg(metricValues(days, "activity")),
    steps: avg(metricValues(days, "steps")),
  };
}

function phraseScore(name: string, cur: number | null, prev: number | null, n: number, previousN: number): string {
  const coverage = `有效样本 ${n}/7 天，此前 ${previousN}/7 天`;
  const value = cur == null ? `近 7 天${name}暂无有效分数` : `近 7 天${name}均分 ${round1(cur)}`;
  if (n < MIN_COMPARISON_DAYS || previousN < MIN_COMPARISON_DAYS || cur == null || prev == null)
    return `${value}（${coverage}）；样本不足，两期各至少 ${MIN_COMPARISON_DAYS} 天才比较。`;
  const d = cur - prev;
  const change = Math.abs(d) < 0.5 ? "与此前 7 天基本持平"
    : `较此前 7 天${d > 0 ? "升高" : "下降"} ${round1(Math.abs(d))} 分`;
  return `${value}（${coverage}），${change}。`;
}

function phraseActivity(cur: PeriodAvgs, prev: PeriodAvgs, n: SampleCounts, previousN: SampleCounts): string {
  const score = phraseScore("活动", cur.activity, prev.activity, n.activity, previousN.activity);
  const steps = cur.steps == null ? "日均步数暂无数据" : `日均步数约 ${round0(cur.steps)}`;
  const parts = [`${steps}（有效样本 ${n.steps}/7 天，此前 ${previousN.steps}/7 天）`];
  if (n.steps >= MIN_COMPARISON_DAYS && previousN.steps >= MIN_COMPARISON_DAYS && cur.steps != null && prev.steps != null) {
    const d = cur.steps - prev.steps;
    parts.push(Math.abs(d) < 300 ? "步数与此前 7 天接近" : `较此前 7 天${d > 0 ? "多" : "少"}约 ${round0(Math.abs(d))} 步`);
  } else parts.push("步数样本不足，暂不比较");
  return `${score}${parts.join("，")}。`;
}

function weakestContributor(
  days: InsightDay[],
  kind: "sleep" | "readiness",
  labels: Record<string, string>,
): { key: string; label: string; val: number } | null {
  const sums = new Map<string, { sum: number; n: number }>();
  for (const day of days) {
    const c = kind === "sleep" ? day.sleep?.contributors : day.readiness?.contributors;
    if (!c) continue;
    for (const [k, v] of Object.entries(c)) {
      if (typeof v !== "number" || !Number.isFinite(v) || v < 0 || v > 100) continue;
      const cur = sums.get(k) ?? { sum: 0, n: 0 };
      cur.sum += v;
      cur.n += 1;
      sums.set(k, cur);
    }
  }
  let best: { key: string; label: string; val: number } | null = null;
  for (const [key, { sum, n }] of sums) {
    if (n < MIN_COMPARISON_DAYS) continue;
    const val = sum / n;
    if (!best || val < best.val) {
      best = { key, label: labels[key] ?? key, val };
    }
  }
  return best;
}

export function buildTips(
  thisWeek: InsightDay[],
  cur: PeriodAvgs,
  prev: PeriodAvgs,
  counts: { thisWeek: SampleCounts; lastWeek: SampleCounts },
): string[] {
  const tips: string[] = [];
  if (cur.sleep == null && cur.readiness == null && cur.activity == null && cur.steps == null) {
    return ["当前区间没有足够的官方数据，请先同步 Oura，再查看变化。"];
  }
  const comparable = (key: keyof PeriodAvgs) => counts.thisWeek[key] >= MIN_COMPARISON_DAYS
    && counts.lastWeek[key] >= MIN_COMPARISON_DAYS && cur[key] != null && prev[key] != null;
  const difference = (key: keyof PeriodAvgs) => comparable(key) ? cur[key]! - prev[key]! : null;
  const sleepDrop = difference("sleep");
  const readyDrop = difference("readiness");
  const stepDrop = difference("steps");

  if (sleepDrop != null && sleepDrop <= -2) {
    tips.push("近 7 天睡眠均分低于此前 7 天，可以查看逐日睡眠与作息记录，了解变化发生在哪几天。");
  } else if (sleepDrop != null && sleepDrop >= 2) {
    tips.push("近 7 天睡眠均分高于此前 7 天，可结合睡眠时长与作息记录继续观察。");
  }

  if (readyDrop != null && readyDrop <= -2) {
    tips.push("近 7 天准备度均分低于此前 7 天，可回看低分日的睡眠和官方贡献项。");
  }

  if (stepDrop != null && stepDrop <= -800) {
    tips.push("近 7 天日均步数低于此前 7 天，可结合逐日步数查看活动量的变化。");
  }

  const weakSleep = weakestContributor(thisWeek, "sleep", SLEEP_LABELS);
  if (weakSleep && weakSleep.val < 70 && tips.length < 3) {
    tips.push(
      `近 7 天睡眠较弱项是「${weakSleep.label}」（均 ${round0(weakSleep.val)}），可查看官方贡献项记录。`,
    );
  }

  const weakReady = weakestContributor(thisWeek, "readiness", READY_LABELS);
  if (weakReady && weakReady.val < 70 && tips.length < 3) {
    tips.push(
      `准备度较弱项是「${weakReady.label}」（均 ${round0(weakReady.val)}），先休息与睡眠，再看官方准备度。`,
    );
  }

  if (!tips.length) {
    const scores = ["sleep", "readiness", "activity"] as const;
    tips.push(scores.every(key => comparable(key) && Math.abs(difference(key)!) < 2)
      ? "三项官方分数近 7 天与此前 7 天接近，可继续观察逐日变化；本解读不是诊断。"
      : scores.some(key => !comparable(key))
        ? "部分指标的两期样本不足，先查看已有记录；两期各积累至少 3 天有效数据后再比较。"
        : "各项指标的变化不同，可分别查看逐日记录和官方贡献项。");
  }

  return tips.slice(0, 3);
}

export function buildWeeklyReport(days: InsightDay[], end = calendarDay()): WeeklyReport {
  const { thisWeek, lastWeek } = splitRollingWeeks(days, end);
  const thisAvgs = windowAverages(thisWeek);
  const lastAvgs = windowAverages(lastWeek);
  const counts = { thisWeek: sampleCounts(thisWeek), lastWeek: sampleCounts(lastWeek) };
  const summaries = [
    phraseScore("睡眠", thisAvgs.sleep, lastAvgs.sleep, counts.thisWeek.sleep, counts.lastWeek.sleep),
    phraseScore("准备度", thisAvgs.readiness, lastAvgs.readiness, counts.thisWeek.readiness, counts.lastWeek.readiness),
    phraseActivity(thisAvgs, lastAvgs, counts.thisWeek, counts.lastWeek),
  ];
  return {
    summaries,
    tips: buildTips(thisWeek, thisAvgs, lastAvgs, counts),
    teaser: summaries.slice(0, TEASER_LINE_COUNT),
    thisPeriod: calendarWindow(7, end),
    lastPeriod: calendarWindow(7, shiftDay(end, -7)),
    disclaimer: DISCLAIMER_ZH,
    avgs: { thisWeek: thisAvgs, lastWeek: lastAvgs },
    sampleCounts: counts,
  };
}

export function comparisonColumn(days: InsightDay[], label: string, count: number, end: string): CompareColumn {
  const range = calendarWindow(count, end);
  const rows = daysInWindow(days, range);
  return {
    label, ...range,
    days: rows.filter(day => Object.values(windowAverages([day])).some(value => value != null)).length,
    ...windowAverages(rows), samples: sampleCounts(rows),
  };
}

export function buildCompareReport(
  days: InsightDay[],
  mode: "week" | "range",
  end = calendarDay(),
): CompareReport {
  if (mode === "range") {
    return {
      mode,
      left: comparisonColumn(days, "近 7 天", 7, end),
      right: comparisonColumn(days, "近 30 天", 30, end),
    };
  }
  return {
    mode,
    left: comparisonColumn(days, "近 7 天", 7, end),
    right: comparisonColumn(days, "此前 7 天", 7, shiftDay(end, -7)),
  };
}

export function weeklyForAccess(report: WeeklyReport, fullAccess: boolean) {
  return {
    ok: true as const,
    locked: !fullAccess,
    disclaimer: report.disclaimer,
    thisPeriod: report.thisPeriod,
    lastPeriod: report.lastPeriod,
    summaries: report.summaries,
    teaser: report.teaser,
    tips: fullAccess ? report.tips : [],
    avgs: fullAccess ? report.avgs : null,
    sampleCounts: report.sampleCounts,
    minComparisonDays: MIN_COMPARISON_DAYS,
    timezone: DISPLAY_TIME_ZONE,
    bodyLocale: "zh" as const,
  };
}

export function compareForAccess(report: CompareReport, fullAccess: boolean) {
  return {
    ok: true as const,
    locked: !fullAccess,
    mode: report.mode,
    left: fullAccess ? report.left : null,
    right: fullAccess ? report.right : null,
    timezone: DISPLAY_TIME_ZONE,
    bodyLocale: "zh" as const,
  };
}
