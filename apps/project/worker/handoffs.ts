import type { TaskStatus } from "@kedoupi/shared/mcp/contract";
import { TASK_STATUSES } from "@kedoupi/shared/mcp/contract";
import { AppError, assertKeys, isCommitSha, isFullSha, nowIso, oneOf, text } from "./lib";
import type { Env, Handoff, HandoffRow, HandoffStatus } from "./types";

const HANDOFF_KEYS = [
  "project",
  "task_id",
  "status",
  "summary",
  "next",
  "blockers",
  "files",
  "branch",
  "base_sha",
  "commit",
  "pr",
  "request_id",
] as const;

export interface HandoffInput {
  projectId: string;
  taskId: string;
  status: HandoffStatus;
  clientId: string;
  clientName: string | null;
  via: "mcp" | "web";
  summary: string;
  next: string;
  blockers: string | null;
  files: string[];
  branch: string;
  baseSha: string;
  commit: string | null;
  pr: string | null;
  requestId: string | null;
}

export interface SaveHandoffResult {
  handoff: Handoff;
  deduplicated: boolean;
}

function optionalText(value: unknown, code: string, max: number): string | null {
  if (value === undefined || value === null || value === "") return null;
  return text(value, code, { max, optional: true });
}

function normalizePr(value: unknown): string | null {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string") throw new AppError("invalid_arguments", 400);
  const result = value.trim();
  if (!result || result.length > 500 || result.includes("\u0000")) {
    throw new AppError("invalid_arguments", 400);
  }
  return result;
}

function normalizeFiles(value: unknown): string[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value) || value.length > 50) throw new AppError("invalid_arguments", 400);
  return value.map(item => {
    const path = text(item, "invalid_arguments", { max: 300 });
    return path!;
  });
}

export function parseHandoffInput(
  args: Record<string, unknown>,
  opts: { projectId: string; clientId: string; clientName?: string; via: "mcp" | "web" },
): HandoffInput {
  assertKeys(args, HANDOFF_KEYS);
  const clientId = text(opts.clientId, "client_required", { max: 200 });
  if (!clientId) throw new AppError("client_required", 400);
  const clientName = opts.clientName
    ? text(opts.clientName, "invalid_client_name", { max: 80, optional: true })
    : null;
  const taskId = text(args.task_id, "invalid_task_id", { max: 200 })!;
  const status = oneOf(args.status, TASK_STATUSES, "invalid_status");
  const summary = text(args.summary, "invalid_summary", { max: 2000 })!;
  const next = text(args.next, "invalid_next", { max: 2000 })!;
  const blockers = optionalText(args.blockers, "invalid_blockers", 2000);
  const branch = text(args.branch, "invalid_branch", { max: 200 })!;
  const baseSha = text(args.base_sha, "invalid_base_sha", { max: 40 })!;
  if (!isFullSha(baseSha)) throw new AppError("invalid_base_sha", 400);
  const commit = optionalText(args.commit, "invalid_commit", 40);
  if (commit && !isCommitSha(commit)) throw new AppError("invalid_commit", 400);
  const requestId = optionalText(args.request_id, "invalid_request_id", 100);
  return {
    projectId: opts.projectId,
    taskId,
    status,
    clientId,
    clientName,
    via: opts.via,
    summary,
    next,
    blockers,
    files: normalizeFiles(args.files),
    branch,
    baseSha,
    commit,
    pr: normalizePr(args.pr),
    requestId,
  };
}

export function handoffFromRow(row: HandoffRow): Handoff {
  return {
    id: row.id,
    task_id: row.task_id,
    status: row.status,
    client: row.client_name || row.client_id,
    summary: row.summary,
    next: row.next,
    blockers: row.blockers,
    files: parseFiles(row.files),
    branch: row.branch,
    base_sha: row.base_sha,
    commit: row.commit_sha,
    pr: row.pr,
    at: row.created_at,
  };
}

function parseFiles(value: string | null): string[] {
  if (!value) return [];
  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed)
      ? parsed.filter((item): item is string => typeof item === "string")
      : [];
  } catch {
    return [];
  }
}

function sameRequest(existing: HandoffRow, input: HandoffInput) {
  return existing.task_id === input.taskId &&
    existing.status === input.status &&
    existing.summary === input.summary &&
    existing.next === input.next &&
    existing.blockers === input.blockers &&
    existing.files === JSON.stringify(input.files) &&
    existing.branch === input.branch &&
    existing.base_sha === input.baseSha &&
    existing.commit_sha === input.commit &&
    existing.pr === input.pr;
}

async function byRequest(env: Env, input: HandoffInput) {
  if (!input.requestId) return null;
  return env.DB.prepare(
    "SELECT * FROM handoffs WHERE project_id=? AND client_id=? AND request_id=?",
  ).bind(input.projectId, input.clientId, input.requestId).first<HandoffRow>();
}

export async function saveHandoff(env: Env, input: HandoffInput): Promise<SaveHandoffResult> {
  const existing = await byRequest(env, input);
  if (existing) {
    if (!sameRequest(existing, input)) throw new AppError("request_id_conflict", 409);
    return { handoff: handoffFromRow(existing), deduplicated: true };
  }
  const id = crypto.randomUUID();
  const createdAt = nowIso();
  const inserted = await env.DB.prepare(`INSERT INTO handoffs
    (id,project_id,task_id,status,client_id,client_name,via,summary,next,blockers,
     files,branch,base_sha,commit_sha,pr,request_id,created_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    ON CONFLICT DO NOTHING
    RETURNING *`).bind(
    id,
    input.projectId,
    input.taskId,
    input.status,
    input.clientId,
    input.clientName,
    input.via,
    input.summary,
    input.next,
    input.blockers,
    JSON.stringify(input.files),
    input.branch,
    input.baseSha,
    input.commit,
    input.pr,
    input.requestId,
    createdAt,
  ).first<HandoffRow>();
  if (inserted) return { handoff: handoffFromRow(inserted), deduplicated: false };

  const raced = await byRequest(env, input);
  if (raced) {
    if (!sameRequest(raced, input)) throw new AppError("request_id_conflict", 409);
    return { handoff: handoffFromRow(raced), deduplicated: true };
  }
  throw new AppError("handoff_write_failed", 503);
}

export async function latestHandoff(
  env: Env,
  projectId: string,
  taskId?: string,
): Promise<Handoff | null> {
  const row = await env.DB.prepare(`SELECT * FROM handoffs
    WHERE project_id=?${taskId === undefined ? "" : " AND task_id=?"}
    ORDER BY created_at DESC, rowid DESC LIMIT 1`)
    .bind(...(taskId === undefined ? [projectId] : [projectId, taskId]))
    .first<HandoffRow>();
  return row ? handoffFromRow(row) : null;
}

export async function latestPerTask(env: Env, projectId: string): Promise<{
  task_id: string;
  status: HandoffStatus;
  latest: Handoff;
}[]> {
  const rows = await env.DB.prepare(`SELECT h.* FROM handoffs h
    WHERE h.project_id=?
      AND NOT EXISTS (
        SELECT 1 FROM handoffs n
        WHERE n.project_id=h.project_id AND n.task_id=h.task_id
          AND (n.created_at>h.created_at OR (n.created_at=h.created_at AND n.rowid>h.rowid))
      )
    ORDER BY h.created_at DESC, h.rowid DESC`).bind(projectId).all<HandoffRow>();
  return rows.results.map(row => ({
    task_id: row.task_id,
    status: row.status,
    latest: handoffFromRow(row),
  }));
}

export async function recentHandoffs(
  env: Env,
  projectId: string,
  limit: number,
  excludeId?: string,
  taskId?: string,
): Promise<Handoff[]> {
  const conditions = ["project_id=?"];
  const params: unknown[] = [projectId];
  if (excludeId) {
    conditions.push("id<>?");
    params.push(excludeId);
  }
  if (taskId) {
    conditions.push("task_id=?");
    params.push(taskId);
  }
  params.push(limit);
  const rows = await env.DB.prepare(`SELECT * FROM handoffs
    WHERE ${conditions.join(" AND ")}
    ORDER BY created_at DESC, rowid DESC LIMIT ?`)
    .bind(...params)
    .all<HandoffRow>();
  return rows.results.map(handoffFromRow);
}

export async function handoffPage(
  env: Env,
  projectId: string,
  opts: { before?: string | null; beforeId?: string | null; limit: number },
): Promise<{ handoffs: Handoff[]; next_before: string | null; next_before_id: string | null }> {
  let before = opts.before || null;
  if (before) {
    const parsed = Date.parse(before);
    if (!Number.isFinite(parsed)) throw new AppError("invalid_before", 400);
    // Project timestamps are stored at whole-second precision.
    before = new Date(parsed).toISOString().replace(/\.\d{3}Z$/, "Z");
  }
  const beforeId = opts.beforeId || null;
  const rows = before
    ? await env.DB.prepare(`SELECT * FROM handoffs
        WHERE project_id=? AND (created_at<? OR (created_at=? AND id<?))
        ORDER BY created_at DESC, id DESC LIMIT ?`)
        .bind(projectId, before, before, beforeId || "\uffff", opts.limit)
        .all<HandoffRow>()
    : await env.DB.prepare(`SELECT * FROM handoffs
        WHERE project_id=? ORDER BY created_at DESC, id DESC LIMIT ?`)
        .bind(projectId, opts.limit)
        .all<HandoffRow>();
  const last = rows.results.at(-1);
  return {
    handoffs: rows.results.map(handoffFromRow),
    next_before: rows.results.length === opts.limit && last ? last.created_at : null,
    next_before_id: rows.results.length === opts.limit && last ? last.id : null,
  };
}

export async function recentHandoffCount(env: Env, since: string, projectId?: string) {
  const row = projectId
    ? await env.DB.prepare(
      "SELECT COUNT(*) AS n FROM handoffs WHERE project_id=? AND created_at>=?",
    ).bind(projectId, since).first<{ n: number }>()
    : await env.DB.prepare(
      "SELECT COUNT(*) AS n FROM handoffs WHERE created_at>=?",
    ).bind(since).first<{ n: number }>();
  return Number(row?.n || 0);
}

export function isTaskStatus(value: unknown): value is TaskStatus {
  return typeof value === "string" && TASK_STATUSES.includes(value as TaskStatus);
}
