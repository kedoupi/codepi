import { MCP_LIMITS } from "@kedoupi/shared/mcp/contract";
import type { SourceSummary } from "@kedoupi/shared/mcp/contract";
import { jsonBytes, maxIso, projectUrl } from "./lib";
import { handoffFromRow } from "./handoffs";
import { latestHandoffs } from "./projects";
import type { Env } from "./types";

function shorten(value: string, limit: number) {
  const points = Array.from(value);
  return points.length <= limit ? value : `${points.slice(0, Math.max(0, limit - 1)).join("")}…`;
}

export async function buildSummary(env: Env, subject: string): Promise<SourceSummary> {
  if (subject !== "kdp-owner") {
    return {
      source: "project",
      status: "unavailable",
      asOf: null,
      updatedAt: null,
      stale: true,
      metrics: [],
      facts: [],
      notes: ["无权读取此项目摘要。"],
      attention: [],
    };
  }
  const projects = (await env.DB.prepare(
    "SELECT * FROM projects ORDER BY created_at, id",
  ).all<{ id: string; name: string; status: string }>()).results;
  if (!projects.length) {
    return {
      source: "project",
      status: "empty",
      asOf: null,
      updatedAt: null,
      stale: false,
      metrics: [],
      facts: [],
      notes: ["尚未同步项目。"],
      attention: [],
    };
  }
  const since = new Date(Date.now() - 7 * 86400_000).toISOString();
  const projectIds = projects.map(project => project.id);
  const placeholders = projectIds.map(() => "?").join(",");
  const [recent, syncRows, latestByProject, openPrRows] = await Promise.all([
    env.DB.prepare("SELECT COUNT(*) AS n FROM handoffs WHERE created_at>=?")
      .bind(since).first<{ n: number }>(),
    env.DB.prepare(`SELECT s.*, p.name FROM sync_state s
      JOIN projects p ON p.id=s.project_id`).all<{
        project_id: string;
        name: string;
        source: string;
        last_ok_at: string | null;
        last_error: string | null;
      }>(),
    latestHandoffs(env, projectIds),
    env.DB.prepare(`SELECT project_id,ref,title FROM repo_events
      WHERE kind='pr' AND state='open' AND project_id IN (${placeholders})
      ORDER BY happened_at DESC`).bind(...projectIds).all<{
        project_id: string;
        ref: string;
        title: string;
      }>(),
  ]);
  const openPrsByProject = new Map<string, { ref: string; title: string }[]>();
  for (const row of openPrRows.results) {
    const pulls = openPrsByProject.get(row.project_id) || [];
    if (pulls.length < 5) pulls.push({ ref: row.ref, title: row.title });
    openPrsByProject.set(row.project_id, pulls);
  }
  const syncRowsByProject = new Map<string, typeof syncRows.results>();
  for (const row of syncRows.results) {
    const rows = syncRowsByProject.get(row.project_id) || [];
    rows.push(row);
    syncRowsByProject.set(row.project_id, rows);
  }
  const facts: string[] = [];
  const attention: SourceSummary["attention"] = [];
  let latestAt: string | null = null;
  let lastSync: string | null = null;
  let stale = false;
  for (const project of projects) {
    const latestRow = latestByProject.get(project.id);
    const handoff = latestRow ? handoffFromRow(latestRow) : null;
    latestAt = maxIso(latestAt, handoff?.at);
    facts.push(handoff
      ? `${project.name}：${handoff.at} 由 ${handoff.client} 交接，下一步：${shorten(handoff.next, 80)}`
      : `${project.name}：尚无交接记录。`);
    for (const pull of openPrsByProject.get(project.id) || []) {
      attention.push({
        label: shorten(`${project.name} · PR #${pull.ref}：${pull.title}`, 160),
        href: projectUrl(env, project.id),
      });
    }
    const rows = syncRowsByProject.get(project.id) || [];
    if (!rows.length) stale = true;
    for (const row of rows) {
      lastSync = maxIso(lastSync, row.last_ok_at);
      if (!row.last_ok_at || Date.now() - Date.parse(row.last_ok_at) > 2 * 3600_000) {
        stale = true;
      }
      if (row.last_error) {
        attention.push({
          label: shorten(`${project.name} · ${row.source}：${row.last_error}`, 140),
          href: projectUrl(env, project.id),
        });
      }
    }
  }
  const active = projects.filter(project => project.status === "active").length;
  const hasHandoffs = Boolean(latestAt);
  const summary: SourceSummary = {
    source: "project",
    status: hasHandoffs ? "ok" : "empty",
    asOf: latestAt || lastSync,
    updatedAt: lastSync,
    stale,
    metrics: [
      { label: "进行中项目", value: String(active) },
      { label: "最近 7 天交接", value: String(Number(recent?.n || 0)) },
    ],
    facts,
    notes: stale ? ["项目或 GitHub 数据超过 2 小时未成功更新。"] : [],
    attention: attention.slice(0, 8),
  };
  delete (summary as SourceSummary & { privateMetric?: unknown }).privateMetric;
  return fitSummary(summary);
}

export function fitSummary(input: SourceSummary): SourceSummary {
  const summary: SourceSummary = {
    ...input,
    metrics: [...input.metrics],
    facts: [...input.facts],
    notes: [...input.notes],
    attention: [...input.attention],
  };
  delete (summary as SourceSummary & { privateMetric?: unknown }).privateMetric;
  if (jsonBytes(summary) <= MCP_LIMITS.overview) return summary;
  summary.notes.push("摘要超过 4 KiB，已裁剪；完整内容见项目卡。");
  while (jsonBytes(summary) > MCP_LIMITS.overview && summary.facts.length > 1) {
    summary.facts.pop();
  }
  while (jsonBytes(summary) > MCP_LIMITS.overview && summary.attention.length) {
    summary.attention.pop();
  }
  if (jsonBytes(summary) > MCP_LIMITS.overview && summary.facts.length) {
    summary.facts[0] = shorten(summary.facts[0], 180);
  }
  while (jsonBytes(summary) > MCP_LIMITS.overview && summary.notes.length > 1) {
    summary.notes.shift();
  }
  if (jsonBytes(summary) > MCP_LIMITS.overview) {
    summary.notes = summary.notes.map(note => shorten(note, 180)).slice(0, 2);
    summary.metrics = summary.metrics.slice(0, 8).map(metric => ({
      label: shorten(metric.label, 60),
      value: shorten(metric.value, 80),
    }));
  }
  while (jsonBytes(summary) > MCP_LIMITS.overview && summary.metrics.length > 2) {
    summary.metrics.pop();
  }
  while (jsonBytes(summary) > MCP_LIMITS.overview && summary.notes.length) {
    summary.notes.pop();
  }
  return summary;
}
