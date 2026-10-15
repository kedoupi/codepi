import type { Row } from "../../worker/dashboard-types";
import { escapeHtml as e } from "./markdown";

export function overviewRules(rows: Row[]) {
  const force = rows.some(r => r.rule_id === "GOOGL_force" && r.triggered === true);
  return rows.filter(r => (r.triggered || ["critical", "near"].includes(String(r.proximity)))
    && !(force && r.rule_id === "GOOGL_trim"))
    .sort((a, b) => Number(b.triggered === true) - Number(a.triggered === true));
}

export function accountAlerts(warnings: unknown, rules: Row[] = []) {
  const alerts = String(warnings || "").split(" / ").filter(w => /情绪疲劳锁|硬刹车|^\s*⚠/.test(w))
    .filter(w => !rules.some(r => r.triggered === true && w.includes(String(r.item)) && w.includes("已触发")));
  if (!alerts.length) return "";
  return `<section class="notice" role="alert" aria-label="重要风控提醒"><strong>重要风控提醒</strong>
    <ul class="warnings">${alerts.map(w => `<li>${e(w)}</li>`).join("")}</ul></section>`;
}

export function proximityRequirement(proximity: unknown) {
  if (proximity === "critical") return "当天出书面临近分析；3 个交易日内出书面决策";
  if (proximity === "near") return "当天出书面临近分析";
  return "";
}
