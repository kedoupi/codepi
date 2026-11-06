// 趋势页的纯函数：只做展示用的换算与汇总，不补数据。缺失永远返回 null（页面显示「未知」），不当成 0。

export type DayType = "workday" | "restday";
export type AppCategory = "AI 编程" | "AI 对话" | "工作沟通" | "会议" | "文档" | "浏览" | "私人" | "其他";
export type FocusMetrics = {
  segmentCount: number | null; totalMinutes: number | null;
  longestMinutes: number | null; communicationInterruptions: number | null;
};

export type DailyMetrics = {
  commuteToWorkMinutes: number | null; commuteHomeMinutes: number | null;
  officeActiveMinutes: number | null; officeMeetingMinutes?: number | null; homeMinutes: number | null;
  wakeMinute: number | null; leaveHomeMinute: number | null; startWorkMinute: number | null;
  leaveComputerMinute: number | null; arriveHomeMinute: number | null; returnBedroomMinute: number | null;
  officeSpanMinutes: number | null;
  statusMinutes: Record<string, number>;
  focus: FocusMetrics;
  afterWorkWorkMachineMinutes: number | null; weekendWorkMachineMinutes: number | null;
  appCategoryMinutes: Record<string, number>;
  hourlyAppCategoryMinutes: Record<string, Record<string, number>>;
  topAppName: string | null; topAppMinutes: number | null;
  otherNetworkMinutes: Record<string, number>;
  coverage: { ratio: number | null; gapReasonMinutes: Record<string, number> };
  dayType: DayType;
};

export type TrendDay = {
  date: string; dayType: DayType | null; missing: boolean; partial?: boolean;
  computedAt?: string; metrics: DailyMetrics | null;
};

export type MetricAverage = {
  days: number; dayType: DayType | "all";
  commuteToWorkMinutes: number | null; commuteHomeMinutes: number | null;
  officeActiveMinutes: number | null; meetingMinutes?: number | null; homeMinutes: number | null; officeSpanMinutes: number | null;
  afterWorkWorkMachineMinutes: number | null; weekendWorkMachineMinutes: number | null;
  topAppMinutes: number | null;
  statusMinutes: Record<string, number>; appCategoryMinutes: Record<string, number>;
  focus: FocusMetrics;
};

export type TrendsPayload = {
  range: 7 | 30; from: string; to: string; days_available: number;
  days: TrendDay[];
  averages: { workday: MetricAverage; restday: MetricAverage };
  week_comparison: { current: MetricAverage; previous: MetricAverage; current_from: string; previous_from: string; previous_to: string };
};

export type AnomaliesPayload = {
  range: number; from: string; to: string; baseline: string; days_available: number;
  anomalies: Array<{ date: string; dayType: DayType; sampleDays: number; reasons: Array<{ metric: string; actual: number; average: number; delta: number }> }>;
  insufficient_sample: Array<{ date: string; dayType: DayType; sampleDays: number; reason: string }>;
};

export type QualityPayload = {
  range: number; from: string; to: string; days_available: number;
  days: Array<{
    date: string; missing: boolean; coverage: number | null; tier: "high" | "medium" | "low" | "unknown";
    gapReasonMinutes: Record<string, number | null>;
  }>;
};

/** 趋势图里的状态分组：家里暂不区分卧室与客厅（用户 2026-11-04 决定），统一并成「在家」。 */
export const STATUS_GROUPS = [
  { key: "home", label: "在家", statuses: ["bedroom", "living_room", "home"] },
  { key: "office_active", label: "公司 · 在电脑前", statuses: ["office_active"] },
  { key: "office_away", label: "公司 · 离座", statuses: ["office_away"] },
  { key: "office_meeting", label: "公司 · 开会", statuses: ["office_meeting"] },
  { key: "commute", label: "通勤", statuses: ["commute"] },
  { key: "other_network", label: "其他网络", statuses: ["other_network"] },
  { key: "unknown", label: "未知", statuses: ["unknown"] },
] as const;

export const APP_CATEGORIES: AppCategory[] = ["AI 编程", "AI 对话", "工作沟通", "会议", "文档", "浏览", "私人", "其他"];

export const MOMENTS = [
  { field: "leaveHomeMinute", label: "离家" },
  { field: "startWorkMinute", label: "开始办公" },
  { field: "leaveComputerMinute", label: "离开电脑" },
  { field: "arriveHomeMinute", label: "到家" },
] as const;

export type Segment = { key: string; label: string; value: number };

export function isNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

/** 一天按状态分组的分钟数；没有汇总的日子返回 null。 */
export function statusGroups(statusMinutes: Record<string, number> | null | undefined): Segment[] | null {
  if (!statusMinutes || !Object.keys(statusMinutes).length) return null;
  return STATUS_GROUPS.map(group => ({
    key: group.key,
    label: group.label,
    value: group.statuses.reduce((sum, status) => sum + (isNumber(statusMinutes[status]) ? statusMinutes[status] : 0), 0),
  }));
}

export function categorySegments(minutes: Record<string, number> | null | undefined): Segment[] | null {
  if (!minutes) return null;
  return APP_CATEGORIES.map(category => ({ key: category, label: category, value: isNumber(minutes[category]) ? minutes[category] : 0 }));
}

export function clockText(minute: number | null | undefined): string {
  if (!isNumber(minute)) return "未知";
  const rounded = Math.round(minute);
  const hours = Math.floor(rounded / 60) % 24;
  return `${String(hours).padStart(2, "0")}:${String(rounded % 60).padStart(2, "0")}`;
}

export function durationText(minutes: number | null | undefined): string {
  if (!isNumber(minutes)) return "未知";
  const rounded = Math.round(minutes);
  const hours = Math.floor(rounded / 60);
  const rest = rounded % 60;
  if (!hours) return `${rest} 分钟`;
  return rest ? `${hours} 小时 ${rest} 分钟` : `${hours} 小时`;
}

/** 表格里用的紧凑写法：「1时17分」「45分」。 */
export function shortDuration(minutes: number | null | undefined): string {
  if (!isNumber(minutes)) return "未知";
  const rounded = Math.round(minutes);
  const hours = Math.floor(rounded / 60);
  return hours ? `${hours}时${String(rounded % 60).padStart(2, "0")}分` : `${rounded}分`;
}

export function hoursText(minutes: number | null | undefined): string {
  if (!isNumber(minutes)) return "未知";
  return `${(minutes / 60).toFixed(1)} 小时`;
}

export function shortDate(date: string): string {
  const [, month, day] = date.split("-").map(Number);
  return `${month}/${day}`;
}

const WEEKDAYS = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];
export function weekdayText(date: string): string {
  return WEEKDAYS[new Date(`${date}T00:00:00Z`).getUTCDay()];
}

export function dayTypeText(value: DayType | null | undefined): string {
  return value === "workday" ? "工作日" : value === "restday" ? "休息日" : "未知";
}

export function average(values: Array<number | null | undefined>): number | null {
  const usable = values.filter(isNumber);
  return usable.length ? usable.reduce((sum, value) => sum + value, 0) / usable.length : null;
}

/** 已汇总、且已经过完的日子（今天只展示不参与统计）。 */
export function completeDays(days: TrendDay[]): Array<TrendDay & { metrics: DailyMetrics }> {
  return days.filter((day): day is TrendDay & { metrics: DailyMetrics } => !day.missing && !day.partial && day.metrics !== null);
}

export type MomentStats = { label: string; field: string; min: number | null; max: number | null; avg: number | null; days: number };

export function momentStats(days: TrendDay[]): MomentStats[] {
  const complete = completeDays(days);
  return MOMENTS.map(({ field, label }) => {
    const values = complete.map(day => day.metrics[field]).filter(isNumber);
    return {
      label, field,
      min: values.length ? Math.min(...values) : null,
      max: values.length ? Math.max(...values) : null,
      avg: average(values),
      days: values.length,
    };
  });
}

/** 一天里每小时各 App 类别的平均分钟，只平均有公司电脑数据的日子。 */
export function hourlyCategoryAverage(days: TrendDay[]): Array<{ hour: string; segments: Segment[]; days: number }> {
  const withOffice = completeDays(days).filter(day => isNumber(day.metrics.officeActiveMinutes));
  return Array.from({ length: 24 }, (_, index) => {
    const hour = String(index).padStart(2, "0");
    return {
      hour,
      days: withOffice.length,
      segments: APP_CATEGORIES.map(category => ({
        key: category,
        label: category,
        value: withOffice.length
          ? withOffice.reduce((sum, day) => sum + (day.metrics.hourlyAppCategoryMinutes[hour]?.[category] ?? 0), 0) / withOffice.length
          : 0,
      })),
    };
  });
}

/** 每天用得最多的 App：统计每个 App 当了几天「第一」，以及那几天合计用了多久。 */
export function topApps(days: TrendDay[], limit = 5): Array<{ name: string; days: number; minutes: number }> {
  const byName = new Map<string, { days: number; minutes: number }>();
  for (const day of completeDays(days)) {
    if (!day.metrics.topAppName || !isNumber(day.metrics.topAppMinutes)) continue;
    const current = byName.get(day.metrics.topAppName) ?? { days: 0, minutes: 0 };
    current.days += 1;
    current.minutes += day.metrics.topAppMinutes;
    byName.set(day.metrics.topAppName, current);
  }
  return [...byName.entries()]
    .map(([name, value]) => ({ name, ...value }))
    .sort((left, right) => right.days - left.days || right.minutes - left.minutes)
    .slice(0, limit);
}

export function sumMaps(maps: Array<Record<string, number | null | undefined> | null | undefined>): Array<{ name: string; minutes: number }> {
  const totals = new Map<string, number>();
  for (const map of maps) {
    for (const [name, value] of Object.entries(map ?? {})) {
      if (isNumber(value)) totals.set(name, (totals.get(name) ?? 0) + value);
    }
  }
  return [...totals.entries()].map(([name, minutes]) => ({ name, minutes })).sort((left, right) => right.minutes - left.minutes);
}

export type ComparisonRow = { label: string; current: number | null; previous: number | null; delta: number | null; kind: "duration" | "count" };

export function weekComparisonRows(comparison: TrendsPayload["week_comparison"]): ComparisonRow[] {
  const { current, previous } = comparison;
  const rows: Array<[string, number | null, number | null, "duration" | "count"]> = [
    ["上班通勤（上限）", current.commuteToWorkMinutes, previous.commuteToWorkMinutes, "duration"],
    ["下班通勤（上限）", current.commuteHomeMinutes, previous.commuteHomeMinutes, "duration"],
    ["在电脑前", current.officeActiveMinutes, previous.officeActiveMinutes, "duration"],
    ["开会", current.meetingMinutes ?? null, previous.meetingMinutes ?? null, "duration"],
    ["在公司（首末操作）", current.officeSpanMinutes, previous.officeSpanMinutes, "duration"],
    ["专注总时长", current.focus.totalMinutes, previous.focus.totalMinutes, "duration"],
    ["专注段数", current.focus.segmentCount, previous.focus.segmentCount, "count"],
  ];
  return rows.map(([label, now, before, kind]) => ({
    label, current: now, previous: before, kind,
    delta: isNumber(now) && isNumber(before) ? now - before : null,
  }));
}

export function deltaText(delta: number | null, kind: "duration" | "count"): string {
  if (!isNumber(delta)) return "无法比较";
  const rounded = kind === "count" ? Math.round(delta * 10) / 10 : Math.round(delta);
  if (rounded === 0) return "持平";
  const sign = rounded > 0 ? "多" : "少";
  return kind === "count" ? `${sign} ${Math.abs(rounded)}` : `${sign} ${shortDuration(Math.abs(rounded))}`;
}

export const GAP_REASONS: Record<string, string> = {
  home_scan_missing: "家中扫描没扫到",
  phone_scan_missing: "手机没响应扫描",
  work_machine_missing: "工作机没上报",
};

export const TIER_LABELS: Record<string, string> = {
  high: "可信（≥99%）",
  medium: "大致可信（95–99%）",
  low: "缺口较多（<95%）",
  unknown: "没有汇总",
};

export function percentText(ratio: number | null | undefined): string {
  return isNumber(ratio) ? `${(ratio * 100).toFixed(ratio >= 0.995 && ratio < 1 ? 1 : 0)}%` : "未知";
}

/** 「和平时比」里一条原因的大白话。时刻类指标说早/晚，通勤类说长/短。 */
export function anomalyReasonText(reason: { metric: string; actual: number; average: number; delta: number }): string {
  const amount = durationText(Math.abs(reason.delta));
  if (reason.metric.includes("通勤")) {
    const percent = reason.average > 0 ? Math.round((reason.delta / reason.average) * 100) : null;
    return `${reason.metric} ${durationText(reason.actual)}，比平时（${durationText(reason.average)}）长 ${amount}${percent === null ? "" : `（+${percent}%）`}`;
  }
  return `${reason.metric} ${clockText(reason.actual)}，比平时（${clockText(reason.average)}）${reason.delta > 0 ? "晚" : "早"} ${amount}`;
}
