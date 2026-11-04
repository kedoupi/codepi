import { TASK_STATUSES } from "@kedoupi/shared/mcp/contract";
import { AppError, assertKeys, isCommitSha, isFullSha, nowIso, oneOf, text } from "./lib";
import type { Env, Handoff, HandoffRow, HandoffStatus } from "./types";

const HANDOFF_KEYS = [
  "project", "task", "status", "summary", "next", "blockers", "files",
  "branch", "base_sha", "commit", "pr", "request_id",
] as const;

export interface HandoffInput {
  projectId: string;
  task: string;
  status: HandoffStatus;
  clientId: string;
  clientName: string | null;
  via: "mcp" | "web";
  summary: string;
  next: string;
  blockers: string | null;
  files: string[];
  branch: string | null;
  baseSha: string | null;
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

function normalizeFiles(value: unknown): string[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value) || value.length > 50) throw new AppError("invalid_arguments", 400);
  return value.map(item => text(item, "invalid_arguments", { max: 300 })!);
}

/**
 * `task` is a pushed task key or a free task id (≤200 chars) for work that is
 * not on a pushed list. Branch and base SHA are optional so repositories
 * without a remote can still record handoffs.
 */
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
  const baseSha = optionalText(args.base_sha, "invalid_base_sha", 40);
  if (baseSha && !isFullSha(baseSha)) throw new AppError("invalid_base_sha", 400);
  const commit = optionalText(args.commit, "invalid_commit", 40);
  if (commit && !isCommitSha(commit)) throw new AppError("invalid_commit", 400);
  return {
    projectId: opts.projectId,
    task: text(args.task, "invalid_task", { max: 200 })!,
    status: oneOf(args.status, TASK_STATUSES, "invalid_status"),
    clientId,
    clientName,
    via: opts.via,
    summary: text(args.summary, "invalid_summary", { max: 2000 })!,
    next: text(args.next, "invalid_next", { max: 2000 })!,
    blockers: optionalText(args.blockers, "invalid_blockers", 2000),
    files: normalizeFiles(args.files),
    branch: optionalText(args.branch, "invalid_branch", 200),
    baseSha,
    commit,
    pr: optionalText(args.pr, "invalid_pr", 500),
    requestId: optionalText(args.request_id, "invalid_request_id", 100),
  };
}

function parseFiles(value: string | null): string[] {
  if (!value) return [];
  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : [];
  } catch {
    return [];
  }
}

export function handoffFromRow(row: HandoffRow): Handoff {
  return {
    id: row.id,
    task: row.task_key,
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

function sameRequest(existing: HandoffRow, input: HandoffInput) {
  return existing.task_key === input.task &&
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
  const inserted = await env.DB.prepare(`INSERT INTO handoffs
    (id,project_id,task_key,status,client_id,client_name,via,summary,next,blockers,
     files,branch,base_sha,commit_sha,pr,request_id,created_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    ON CONFLICT DO NOTHING
    RETURNING *`).bind(
    crypto.randomUUID(), input.projectId, input.task, input.status, input.clientId, input.clientName,
    input.via, input.summary, input.next, input.blockers, JSON.stringify(input.files), input.branch,
    input.baseSha, input.commit, input.pr, input.requestId, nowIso(),
  ).first<HandoffRow>();
  if (inserted) return { handoff: handoffFromRow(inserted), deduplicated: false };
  const raced = await byRequest(env, input);
  if (raced) {
    if (!sameRequest(raced, input)) throw new AppError("request_id_conflict", 409);
    return { handoff: handoffFromRow(raced), deduplicated: true };
  }
  throw new AppError("handoff_write_failed", 503);
}

export async function taskHandoffs(env: Env, projectId: string, task: string, limit: number): Promise<Handoff[]> {
  const rows = await env.DB.prepare(`SELECT * FROM handoffs WHERE project_id=? AND task_key=?
    ORDER BY created_at DESC, rowid DESC LIMIT ?`).bind(projectId, task, limit).all<HandoffRow>();
  return rows.results.map(handoffFromRow);
}

/** Latest handoff per task for one project, newest first. */
export async function latestPerTask(env: Env, projectId: string, limit: number): Promise<Handoff[]> {
  const rows = await env.DB.prepare(`SELECT * FROM (
      SELECT h.*, h.rowid AS handoff_rowid,
        ROW_NUMBER() OVER (PARTITION BY h.task_key ORDER BY h.created_at DESC, h.rowid DESC) AS task_rank
      FROM handoffs h WHERE h.project_id=?
    ) WHERE task_rank=1 ORDER BY created_at DESC, handoff_rowid DESC LIMIT ?`)
    .bind(projectId, limit).all<HandoffRow>();
  return rows.results.map(handoffFromRow);
}
