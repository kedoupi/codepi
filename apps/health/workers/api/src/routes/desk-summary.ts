import { authorizeSummary, calendarDay, deskJson, emptySummary, finite, shiftDay, type DeskSummary } from "@kedoupi/shared/desk/contract";
import type { Env } from "../env";
import type { NestedDay } from "../lib/daily";

export async function handleDeskSummary(request: Request, env: Env): Promise<Response> {
  const denied = await authorizeSummary(request, env.DESK_SUMMARY_TOKEN);
  if (denied) return denied;
  if (!env.PERSONAL_OWNER_ID) return deskJson({ error: "owner_not_configured" }, 503);
  const now = new Date();
  const today = calendarDay(now);
  const week = new URL(request.url).searchParams.get("range") === "week";
  const from = shiftDay(today, week ? -6 : -89);
  // Deliberately bypass cachedDaily: its read path may refresh Oura and write data.
  const rows = await env.DB.prepare(
    "SELECT day,payload FROM daily_cache WHERE user_id=? AND day>=? AND day<=? ORDER BY day",
  ).bind(env.PERSONAL_OWNER_ID, from, today).all<{ day: string; payload: string }>();
  const state = await env.DB.prepare("SELECT synced_at,last_error FROM sync_state WHERE user_id=?")
    .bind(env.PERSONAL_OWNER_ID).first<{ synced_at: string | null; last_error: string | null }>();
  const days = rows.results.map(row => ({ ...JSON.parse(row.payload) as NestedDay, date: row.day }))
    .filter(day => finite(day.sleep?.score) !== null || finite(day.readiness?.score) !== null || finite(day.activity?.steps) !== null);
  const result: DeskSummary = emptySummary("health", week ? "最近 7 天暂无有效健康记录。" : "尚无已同步的健康记录，请进入 Health 查看连接与同步。");
  result.updatedAt = state?.synced_at ?? null;
  if (!days.length) return deskJson(result);
  const latest = days.at(-1)!;
  result.status = "ok";
  result.asOf = latest.date;
  result.stale = !!state?.last_error || !state?.synced_at
    || !Number.isFinite(Date.parse(state.synced_at)) || now.getTime() - Date.parse(state.synced_at) > 24 * 3600_000
    || latest.date < shiftDay(today, -1);
  result.notes = ["读取已同步记录；刷新工作台不会触发 Oura 同步。"];
  if (result.stale) result.notes.push("记录可能已过期，请进入 Health 检查同步状态。");
  const fields = [
    { label: "睡眠评分", get: (day: NestedDay) => finite(day.sleep?.score), unit: "分" },
    { label: "恢复评分", get: (day: NestedDay) => finite(day.readiness?.score), unit: "分" },
    { label: "步数", get: (day: NestedDay) => finite(day.activity?.steps), unit: "步" },
  ];
  for (const field of fields) {
    const values = (week ? days : [latest]).map(field.get).filter((v): v is number => v !== null);
    const mean = values.length ? values.reduce((a, b) => a + b, 0) / values.length : null;
    const value = mean === null ? "暂无数据" : `${Math.round(mean * 10) / 10} ${field.unit}`;
    result.metrics.push({ label: `${week ? "日均" : ""}${field.label}`, value });
    result.facts.push(week
      ? `${from} 至 ${today}，${field.label}有 ${values.length}/7 天有效记录，日均${value}。`
      : `${latest.date}，${field.label}：${value}。`);
    if (week && values.length >= 2) {
      const validDays = days.filter(day => field.get(day) !== null);
      const first = validDays[0], last = validDays.at(-1)!;
      const change = Math.round((field.get(last)! - field.get(first)!) * 10) / 10;
      result.facts.push(`${field.label}：${last.date} 比 ${first.date} ${change > 0 ? "增加" : change < 0 ? "减少" : "变化"} ${Math.abs(change)} ${field.unit}（窗口内首末有效记录对比）。`);
    }
  }
  if (result.stale) result.attention.push({ label: "检查健康数据同步", href: "https://health.codepi.app/" });
  return deskJson(result);
}
