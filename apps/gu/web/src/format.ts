import type { Row } from "../../worker/dashboard-types";

// change_pct from the Python quote provider is already in percentage points.
export function marketChange(value: unknown): string {
  return typeof value === "number" && Number.isFinite(value)
    ? `${value > 0 ? "+" : ""}${value.toFixed(2)}%`
    : "—";
}

export function percent(value: unknown, digits = 1): string {
  return typeof value === "number" && Number.isFinite(value)
    ? new Intl.NumberFormat("zh-CN", { style: "percent", minimumFractionDigits: digits, maximumFractionDigits: digits }).format(value)
    : "—";
}

export function weight(row: Record<string, unknown>): unknown {
  return typeof row.weight_raw === "number" ? row.weight_raw : row.weight;
}

export function ruleCurrent(row: Record<string, unknown>): string {
  if (row.current_unit === "ratio" && typeof row.current_value === "number") return percent(row.current_value);
  if (row.current_unit === "USD" && typeof row.current_value === "number") return `$${row.current_value.toFixed(2)}`;
  return String(row.current ?? "未记录");
}

export function reportCategory(kind: unknown): string {
  const text = String(kind ?? "");
  return ["盘前分析", "盘后复盘", "风控体检", "深度分析", "财报", "复盘"].find(k => text.includes(k)) || "历史研究";
}

export function reportAction(action: unknown): string {
  return String(action || "历史报告未记录行动");
}

export function ruleAction(row: Row): string {
  return String(row.action || (row.triggered === null ? "无对应阈值" : "未触发动作"));
}

export function elapsed(value: unknown, now = Date.now()): string {
  const age = now - Date.parse(String(value));
  if (!Number.isFinite(age)) return "时间未记录";
  if (age < -300_000) return "时间晚于当前设备，请核对";
  const minutes = Math.max(0, Math.floor(age / 60_000));
  return minutes < 1 ? "刚刚生成" : minutes < 60 ? `${minutes} 分钟前生成`
    : minutes < 1440 ? `${Math.floor(minutes / 60)} 小时前生成` : `${Math.floor(minutes / 1440)} 天前生成`;
}
