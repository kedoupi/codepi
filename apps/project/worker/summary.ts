import { MCP_LIMITS } from "@kedoupi/shared/mcp/contract";
import type { SourceSummary } from "@kedoupi/shared/mcp/contract";
import { jsonBytes, shorten, taskUrl } from "./lib";
import { overview } from "./work";
import type { Env } from "./types";

const NEED_LABEL: Record<string, string> = {
  decide: "决定", attend: "到场", authorize: "授权", confirm: "确认", none: "",
};

function unavailable(note: string): SourceSummary {
  return { source: "project", status: "unavailable", asOf: null, updatedAt: null, stale: true,
    metrics: [], facts: [], notes: [note], attention: [] };
}

export async function buildSummary(env: Env, subject: string, now = new Date()): Promise<SourceSummary> {
  if (subject !== "kdp-owner") return unavailable("无权读取此项目摘要。");
  const data = await overview(env, { limit: 8 }, now);
  const lastPush = data.projects.map(project => project.last_push_at).filter(Boolean).sort().at(-1) || null;
  if (!data.projects.length || !lastPush) {
    return { source: "project", status: "empty", asOf: null, updatedAt: null, stale: false,
      metrics: [], facts: [], notes: ["还没有项目推送待办。"], attention: [] };
  }
  const stale = Date.now() - Date.parse(lastPush) > 3 * 86400_000;
  const summary: SourceSummary = {
    source: "project",
    status: "ok",
    asOf: lastPush,
    updatedAt: lastPush,
    stale,
    metrics: [
      { label: "需要你", value: String(data.counts.need_you) },
      { label: "逾期", value: String(data.counts.overdue) },
      { label: "7 天内到期", value: String(data.counts.due_7d) },
      { label: "进行中分支", value: String(data.counts.branches) },
    ],
    facts: data.projects.map(project => `${project.name}：${project.open} 条未完成，${project.need_you} 条需要你`),
    notes: stale ? ["最近一次推送超过 3 天，待办可能不是最新。"] : [],
    attention: data.need_you.map(task => ({
      label: shorten(`${task.due ? `${task.due.slice(5)} ` : ""}${NEED_LABEL[task.need_kind]}：${task.title}`, 60),
      href: taskUrl(env, task.project, task.key),
    })),
  };
  while (jsonBytes(summary) > MCP_LIMITS.overview && (summary.attention.length || summary.facts.length)) {
    if (summary.attention.length >= summary.facts.length) summary.attention.pop();
    else summary.facts.pop();
  }
  return summary;
}
