import type { NeedKind, ProjectSummary, WorkStatus } from "./types";

export const STATUS_ORDER: WorkStatus[] = ["decide", "doing", "bug", "verify", "idea"];
export const STATUS_LABEL: Record<WorkStatus, string> = {
  decide: "待决定", doing: "执行", bug: "缺陷", verify: "待确认", idea: "想法",
};
export const NEED_LABEL: Record<NeedKind, string> = {
  decide: "决定", attend: "到场", authorize: "授权", confirm: "确认", none: "无需你",
};
export const NEED_ORDER: NeedKind[] = ["attend", "decide", "authorize", "confirm", "none"];
export const HANDOFF_LABEL: Record<string, string> = {
  in_progress: "进行中", blocked: "受阻", ready_for_review: "待审查", done: "完成",
};

/** Whole days from `today` (YYYY-MM-DD, owner's calendar) to `due`. */
export function daysUntil(due: string, today: string): number {
  return Math.round((Date.parse(`${due}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86400_000);
}

export function dueText(due: string, today: string): string {
  const n = daysUntil(due, today);
  if (n < 0) return `逾期 ${-n} 天`;
  if (n === 0) return "今天";
  if (n === 1) return "明天";
  return `${n} 天后`;
}

export type DueTone = "late" | "soon" | "near" | "far";
export function dueTone(due: string, today: string): DueTone {
  const n = daysUntil(due, today);
  if (n < 0) return "late";
  if (n <= 3) return "soon";
  if (n <= 7) return "near";
  return "far";
}

export function monthDay(day: string): string {
  return `${Number(day.slice(5, 7))}/${Number(day.slice(8, 10))}`;
}

const WEEK = "日一二三四五六";
export function longDay(day: string): string {
  const date = new Date(`${day}T00:00:00Z`);
  return `${Number(day.slice(5, 7))} 月 ${Number(day.slice(8, 10))} 日 周${WEEK[date.getUTCDay()]}`;
}

function beijingDate(day: string) {
  return new Date(`${day}T00:00:00+08:00`);
}

export function weekday(day: string): string {
  return new Intl.DateTimeFormat("zh-CN", { weekday: "short", timeZone: "Asia/Shanghai" }).format(beijingDate(day));
}

export function longDate(day: string): string {
  return new Intl.DateTimeFormat("zh-CN", { month: "long", day: "numeric", timeZone: "Asia/Shanghai" }).format(beijingDate(day));
}

export function shortTime(value: string | null): string {
  if (!value) return "—";
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime())) return "—";
  return new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai", month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false,
  }).format(parsed);
}

export function ago(value: string | null, now = Date.now()): string {
  if (!value) return "从未";
  const minutes = Math.round((now - Date.parse(value)) / 60000);
  if (!Number.isFinite(minutes)) return "—";
  if (minutes < 1) return "刚刚";
  if (minutes < 60) return `${minutes} 分钟前`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `${hours} 小时前`;
  return `${Math.round(hours / 24)} 天前`;
}

/** Stable colour slot per project, by registry order, so filters never repaint survivors. */
export function projectSlot(projects: ProjectSummary[], id: string): number {
  const index = projects.findIndex(project => project.id === id);
  return index < 0 ? 0 : index % 5;
}

/** Stable colour slot per category within the board, by first appearance. */
export function categorySlots(categories: string[]): Map<string, number> {
  const slots = new Map<string, number>();
  for (const category of categories) if (!slots.has(category)) slots.set(category, slots.size % 5);
  return slots;
}
