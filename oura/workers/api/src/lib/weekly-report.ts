/** Template-generated Chinese secondary interpretation. Does not change official scores. */

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

export type DateRange = { from: string; to: string };

export type WeeklyReport = {
  summaries: string[];
  tips: string[];
  teaser: string[];
  thisPeriod: DateRange;
  lastPeriod: DateRange;
  disclaimer: string;
  avgs: { thisWeek: PeriodAvgs; lastWeek: PeriodAvgs };
};

export type CompareColumn = PeriodAvgs & {
  label: string;
  from: string;
  to: string;
  days: number;
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

export function sortDays<T extends { date: string }>(days: T[]): T[] {
  return [...days].sort((a, b) => a.date.localeCompare(b.date));
}

export function splitRollingWeeks<T extends { date: string }>(
  days: T[],
): { thisWeek: T[]; lastWeek: T[] } {
  const sorted = sortDays(days);
  return {
    thisWeek: sorted.slice(-7),
    lastWeek: sorted.slice(-14, -7),
  };
}

export function sliceLast<T>(days: T[], n: number): T[] {
  if (!days.length) return [];
  return days.slice(Math.max(0, days.length - n));
}

export function windowAverages(days: InsightDay[]): PeriodAvgs {
  return {
    sleep: avg(days.map((d) => d.sleep?.score)),
    readiness: avg(days.map((d) => d.readiness?.score)),
    activity: avg(days.map((d) => d.activity?.score)),
    steps: avg(days.map((d) => d.activity?.steps)),
  };
}

export function rangeOf(days: InsightDay[]): DateRange {
  const sorted = sortDays(days);
  return { from: sorted[0]?.date ?? "", to: sorted[sorted.length - 1]?.date ?? "" };
}

function phraseScore(name: string, cur: number | null, prev: number | null): string {
  if (cur == null) return `本周${name}数据不足，暂无法对照上周。`;
  if (prev == null) {
    return `本周${name}均分 ${round1(cur)}，上周样本不足，先看本周官方分数即可。`;
  }
  const d = cur - prev;
  if (Math.abs(d) < 0.5) return `本周${name}均分 ${round1(cur)}，与上周基本持平。`;
  if (d > 0) return `本周${name}均分 ${round1(cur)}，较上周升高 ${round1(d)} 分。`;
  return `本周${name}均分 ${round1(cur)}，较上周下降 ${round1(Math.abs(d))} 分。`;
}

function phraseActivity(cur: PeriodAvgs, prev: PeriodAvgs): string {
  if (cur.activity == null && cur.steps == null) {
    return "本周活动数据不足，暂无法对照上周。";
  }
  const scoreBit =
    cur.activity == null ? "活动分数不足" : `活动均分 ${round1(cur.activity)}`;
  const stepBit = cur.steps == null ? "" : `、日均步数约 ${round0(cur.steps)}`;
  if (prev.activity == null && prev.steps == null) {
    return `本周${scoreBit}${stepBit}，上周样本不足。`;
  }
  const parts: string[] = [`本周${scoreBit}${stepBit}`];
  if (cur.activity != null && prev.activity != null) {
    const d = cur.activity - prev.activity;
    if (Math.abs(d) < 0.5) parts.push("活动分与上周基本持平");
    else if (d > 0) parts.push(`活动分较上周升高 ${round1(d)}`);
    else parts.push(`活动分较上周下降 ${round1(Math.abs(d))}`);
  }
  if (cur.steps != null && prev.steps != null) {
    const d = cur.steps - prev.steps;
    if (Math.abs(d) >= 300) {
      parts.push(d > 0 ? `步数多了约 ${round0(d)}` : `步数少了约 ${round0(Math.abs(d))}`);
    }
  }
  return `${parts.join("，")}。`;
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
      if (typeof v !== "number") continue;
      const cur = sums.get(k) ?? { sum: 0, n: 0 };
      cur.sum += v;
      cur.n += 1;
      sums.set(k, cur);
    }
  }
  let best: { key: string; label: string; val: number } | null = null;
  for (const [key, { sum, n }] of sums) {
    if (!n) continue;
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
): string[] {
  const tips: string[] = [];
  const sleepDrop = cur.sleep != null && prev.sleep != null ? cur.sleep - prev.sleep : 0;
  const readyDrop =
    cur.readiness != null && prev.readiness != null ? cur.readiness - prev.readiness : 0;
  const stepDrop = cur.steps != null && prev.steps != null ? cur.steps - prev.steps : 0;

  if (sleepDrop <= -2) {
    tips.push("本周睡眠均分低于上周，建议固定入睡时间，睡前一小时减弱光与咖啡因。");
  } else if (sleepDrop >= 2) {
    tips.push("本周睡眠好于上周，把当前作息再保持几天，对照官方睡眠分即可。");
  }

  if (readyDrop <= -2) {
    tips.push("准备度走弱，优先保证前夜睡眠与体温稳定，暂缓把高强度训练叠在低分日。");
  }

  if (stepDrop <= -800) {
    tips.push("活动量低于上周，可用通勤或饭后步行做保底，不必一次补齐官方活动分。");
  }

  const weakSleep = weakestContributor(thisWeek, "sleep", SLEEP_LABELS);
  if (weakSleep && weakSleep.val < 70 && tips.length < 3) {
    tips.push(
      `本周睡眠较弱项是「${weakSleep.label}」（均 ${round0(weakSleep.val)}），对照官方贡献项调整即可。`,
    );
  }

  const weakReady = weakestContributor(thisWeek, "readiness", READY_LABELS);
  if (weakReady && weakReady.val < 70 && tips.length < 3) {
    tips.push(
      `准备度较弱项是「${weakReady.label}」（均 ${round0(weakReady.val)}），先休息与睡眠，再看官方准备度。`,
    );
  }

  if (!tips.length) {
    tips.push("三项官方分数本周与上周接近，保持作息即可；本解读只是对照说明，不是诊断。");
  }

  return tips.slice(0, 3);
}

export function buildWeeklyReport(days: InsightDay[]): WeeklyReport {
  const { thisWeek, lastWeek } = splitRollingWeeks(days);
  const thisAvgs = windowAverages(thisWeek);
  const lastAvgs = windowAverages(lastWeek);
  const summaries = [
    phraseScore("睡眠", thisAvgs.sleep, lastAvgs.sleep),
    phraseScore("准备度", thisAvgs.readiness, lastAvgs.readiness),
    phraseActivity(thisAvgs, lastAvgs),
  ];
  return {
    summaries,
    tips: buildTips(thisWeek, thisAvgs, lastAvgs),
    teaser: summaries.slice(0, TEASER_LINE_COUNT),
    thisPeriod: rangeOf(thisWeek),
    lastPeriod: rangeOf(lastWeek),
    disclaimer: DISCLAIMER_ZH,
    avgs: { thisWeek: thisAvgs, lastWeek: lastAvgs },
  };
}

export function buildCompareReport(
  days: InsightDay[],
  mode: "week" | "range",
): CompareReport {
  const sorted = sortDays(days);
  if (mode === "range") {
    const d7 = sliceLast(sorted, 7);
    const d30 = sliceLast(sorted, 30);
    return {
      mode,
      left: { label: "近 7 天", ...rangeOf(d7), days: d7.length, ...windowAverages(d7) },
      right: { label: "近 30 天", ...rangeOf(d30), days: d30.length, ...windowAverages(d30) },
    };
  }
  const { thisWeek, lastWeek } = splitRollingWeeks(sorted);
  return {
    mode,
    left: {
      label: "本周",
      ...rangeOf(thisWeek),
      days: thisWeek.length,
      ...windowAverages(thisWeek),
    },
    right: {
      label: "上周",
      ...rangeOf(lastWeek),
      days: lastWeek.length,
      ...windowAverages(lastWeek),
    },
  };
}

export function paywallWeekly(report: WeeklyReport, subscribed: boolean) {
  return {
    ok: true as const,
    subscribed,
    locked: !subscribed,
    disclaimer: report.disclaimer,
    thisPeriod: report.thisPeriod,
    lastPeriod: report.lastPeriod,
    summaries: report.summaries,
    teaser: report.teaser,
    tips: subscribed ? report.tips : [],
    avgs: subscribed ? report.avgs : null,
    bodyLocale: "zh" as const,
  };
}

export function paywallCompare(report: CompareReport, subscribed: boolean) {
  return {
    ok: true as const,
    subscribed,
    locked: !subscribed,
    mode: report.mode,
    left: subscribed ? report.left : null,
    right: subscribed ? report.right : null,
    bodyLocale: "zh" as const,
  };
}
