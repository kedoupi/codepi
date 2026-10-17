import type { Dashboard, Row } from "../../../worker/dashboard-types";

/** Dashboard snapshot as served by /api/dashboard. */
export type Snapshot = { batch_id: string; received_at: string; data: Dashboard };

export const number = (v: unknown, digits = 2) =>
  typeof v === "number" && Number.isFinite(v)
    ? v.toLocaleString("zh-CN", { maximumFractionDigits: digits })
    : "—";

export const money = (v: unknown) =>
  typeof v === "number" && Number.isFinite(v) ? `${(v / 10000).toFixed(2)} 万` : "—";

export const time = (v: unknown) => {
  const date = new Date(String(v));
  return Number.isFinite(date.getTime())
    ? new Intl.DateTimeFormat("zh-CN", {
        timeZone: "Asia/Shanghai",
        dateStyle: "medium",
        timeStyle: "short",
        hour12: false,
      }).format(date)
    : "未记录";
};

export const signed = (pct: (v: unknown) => string) => (v: unknown) =>
  typeof v === "number" ? `${v > 0 ? "+" : ""}${pct(v)}` : "—";

// 三态：负数红、正数绿、非数值（null / "—"）落中性灰。
// 旧实现在缺失值时也落进 positive 绿色，会把「行情暂时取不到」伪装成上涨。
export const tone = (v: unknown) => {
  if (typeof v !== "number" || !Number.isFinite(v)) return "neutral";
  return v < 0 ? "negative" : v > 0 ? "positive" : "neutral";
};

/** 行情时刻文案：价格时刻与来源市场时间是两个概念，不能混写。 */
export function quoteInfo(p: Row, formatTime: (v: unknown) => string = time) {
  if (p.quote_time)
    return `已确认价格时刻 ${formatTime(p.quote_time)} · ${String(p.quote_session === "regular" ? "常规时段" : "阶段未确认")}`;
  return `${String(p.quote_date || "估值，待核实")} · 价格时刻未确认${p.market_time_iso ? `；来源市场时间 ${formatTime(p.market_time_iso)}（不等于价格时刻）` : ""}`;
}
