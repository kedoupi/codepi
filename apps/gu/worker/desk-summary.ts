import { authorizeSummary, deskJson, emptySummary, finite, type DeskSummary } from "@kedoupi/shared/desk/contract";
import type { Dashboard, Env } from "./types";
import { readWorkspace } from "./workspace";

export async function handleDeskSummary(request: Request, env: Env): Promise<Response> {
  const denied = await authorizeSummary(request, env.DESK_SUMMARY_TOKEN);
  if (denied) return denied;
  const workspace = await readWorkspace(env);
  if (workspace.active) {
    const oldest = workspace.valuation.oldest_date;
    const summary: DeskSummary = {
      source: "gu", status: "ok", asOf: oldest, updatedAt: workspace.updated_at,
      stale: !oldest || Date.now() - Date.parse(oldest) > 36 * 3600_000,
      metrics: [{ label: "持仓记录", value: String(workspace.data.account.holdings.length) },
        { label: "待补估值", value: String(workspace.valuation.missing) }],
      facts: [`线上账户版本 ${workspace.revision}；${workspace.data.reports.length} 份研究报告。`],
      notes: workspace.valuation.warnings,
      attention: [{ label: "查看和核对线上账户", href: "https://gu.codepi.app/#workspace" }],
    };
    if (workspace.valuation.total_usd !== null)
      summary.privateMetric = { label: "已录入参考估值 · 美元", value: workspace.valuation.total_usd };
    return deskJson(summary);
  }
  const row = await env.DB.prepare(`SELECT b.generated_at,b.received_at,b.payload FROM dashboard_batches b
    JOIN dashboard_current c ON c.batch_id=b.id WHERE c.singleton=1`)
    .first<{ generated_at: string; received_at: string; payload: string }>();
  if (!row) return deskJson(emptySummary("gu", "尚未同步投资数据。"));
  const data = JSON.parse(row.payload) as Dashboard;
  const account = data.account?.[0];
  if (!account || account.data_mode === "demo") return deskJson(emptySummary("gu", "暂无可用于摘要的真实投资批次。"));
  const force = data.risk.some(rule => rule.rule_id === "GOOGL_force" && rule.triggered === true);
  const rules = data.risk.filter(rule => !(force && rule.rule_id === "GOOGL_trim"));
  const triggered = rules.filter(rule => rule.triggered === true);
  const near = rules.filter(rule => rule.triggered !== true && ["critical", "near"].includes(String(rule.proximity)));
  const stale = !Number.isFinite(Date.parse(row.generated_at)) || Date.now() - Date.parse(row.generated_at) > 36 * 3600_000;
  const result: DeskSummary = {
    source: "gu", status: "ok", asOf: row.generated_at, updatedAt: row.received_at, stale,
    metrics: [{ label: "已触发规则", value: String(triggered.length) }, { label: "临近规则", value: String(near.length) }],
    facts: [`当前批次中，${triggered.length} 项规则已触发，${near.length} 项临近边界。`],
    notes: ["只描述当前批次，无法据此计算最近 7 天收益或变化。", "组合单日与月度跌幅等历史条件未评估；规则计数不代表全面风险结论。"],
    attention: [...triggered, ...near].slice(0, 4).map(rule => ({
      label: `${rule.triggered === true ? "已触发" : "临近"}：${String(rule.item || rule.rule_id || "投资规则").slice(0, 100)}`,
      href: "https://gu.codepi.app/#positions",
    })),
  };
  if (stale) {
    result.notes.push("投资批次已超过 36 小时或时间未知，请核对数据时效。");
    result.attention.push({ label: "核对投资数据批次", href: "https://gu.codepi.app/" });
  }
  const total = finite(account.total_usd);
  if (total !== null) result.privateMetric = { label: "估算总资产 · 美元", value: total.toLocaleString("zh-CN", { maximumFractionDigits: 2 }) };
  return deskJson(result);
}
