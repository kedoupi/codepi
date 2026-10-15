import type { Row } from "../../worker/dashboard-types";

export function reportCategory(kind: unknown): string {
  const text = String(kind ?? "");
  return ["盘前分析", "盘后复盘", "风控体检", "深度分析", "财报", "复盘"].find(k => text.includes(k)) || "历史研究";
}

export function reportAction(action: unknown, hidden: boolean): string {
  const text = String(action || "历史报告未记录行动");
  return !hidden || ["执行预设节点", "只观察", "无操作", "历史报告未记录行动"].includes(text)
    ? text : "当时行动已隐藏，显示金额后查看";
}

const actions: Record<string, string> = {
  GOOGL_trim: "按规范减仓至目标权重",
  GOOGL_force: "按规范执行强制减仓",
  NVDA_stop_buy: "停买，保留现有持仓；停买不是卖出信号",
  NVDA_max: "不加仓",
  NVDA_price_pause: "不得新开定投",
  XLV_max: "不加仓",
  tech_max: "不加科技，VOO 本身仍可买",
  cash_min: "月投减额或暂停，保留现金缓冲",
};

export function ruleAction(row: Row, hidden: boolean): string {
  if (!hidden) return String(row.action || (row.triggered === null ? "无对应阈值" : "未触发动作"));
  if (row.triggered !== true) return row.triggered === null ? "无对应阈值" : "未触发动作";
  return actions[String(row.rule_id)] || "已触发规则，请按规范处理；详细说明已隐藏";
}

export function privateWarning(value: string): string {
  if (/情绪疲劳锁/.test(value)) return "情绪疲劳锁：48 小时冷静期，禁止卖出或调仓，完成书面三问。";
  if (/硬刹车/.test(value)) return "月投现金硬刹车：暂停原定金额月投，按规范减额或跳过并核对现金。";
  return "本批次有待核对的数据提醒，显示金额后可查看详细说明。";
}
