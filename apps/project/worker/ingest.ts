import { AppError, assertKeys, nowIso, object, sha256Hex, text } from "./lib";
import { findSecret } from "./scan";
import {
  NEED_KINDS,
  WORK_STATUSES,
  type Adapter,
  type Env,
  type NeedKind,
  type WorkStatus,
} from "./types";

export const INGEST_BODY_LIMIT = 256 * 1024;
export const SNAPSHOT_KEEP = 30;
export const DONE_RETENTION_DAYS = 90;
const LIMITS = { tasks: 500, branches: 50, changelog: 100, related: 20 } as const;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const KEY = /^[A-Za-z0-9._:-]{1,64}$/;

export interface IngestTask {
  key: string;
  title: string;
  status: WorkStatus;
  category: string;
  due: string | null;
  recorded: string | null;
  what: string | null;
  impact: string | null;
  advice: string | null;
  need: string | null;
  need_kind: NeedKind;
  source: string | null;
  related: string[];
  position: number;
}

export interface IngestPayload {
  project: { name: string | null; rules_path: string | null; adapter: Adapter | null };
  source: { sha: string | null; branch: string | null };
  tasks: IngestTask[];
  branches: { name: string; ahead: number; last_commit_at: string | null; has_fragment: boolean }[];
  changelog: { date: string; title: string; summary: string | null }[];
}

export interface IngestResult {
  project: string;
  content_hash: string;
  deduplicated: boolean;
  tasks: number;
  newly_done: number;
  pushed_at: string;
}

function opt(value: unknown, code: string, max: number): string | null {
  if (value === undefined || value === null || value === "") return null;
  return text(value, code, { max });
}

function date(value: unknown, code: string): string | null {
  if (value === undefined || value === null || value === "") return null;
  // Date.parse rolls 2026-02-31 over to March; require the day to survive a round trip.
  const parsed = typeof value === "string" && DATE.test(value) ? Date.parse(`${value}T00:00:00Z`) : NaN;
  if (!Number.isFinite(parsed) || new Date(parsed).toISOString().slice(0, 10) !== value) {
    throw new AppError(code, 422);
  }
  return value as string;
}

function list(value: unknown, code: string, max: number): unknown[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value) || value.length > max) throw new AppError(code, 422);
  return value;
}

function oneOf<T extends string>(value: unknown, values: readonly T[], code: string): T {
  if (typeof value !== "string" || !values.includes(value as T)) throw new AppError(code, 422);
  return value as T;
}

function iso(value: unknown, code: string): string | null {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string" || !Number.isFinite(Date.parse(value))) throw new AppError(code, 422);
  return new Date(Date.parse(value)).toISOString().replace(/\.\d{3}Z$/, "Z");
}

async function strict<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (error) {
    // Body validation failures are 422 regardless of the helper's default status.
    if (error instanceof AppError && error.status === 400) throw new AppError(error.code, 422, error.details);
    throw error;
  }
}

function adapterOf(value: unknown): Adapter | null {
  if (value === undefined || value === null) return null;
  if (!object(value)) throw new AppError("invalid_adapter", 422);
  assertKeys(value, ["isolation", "commit", "acceptance", "merge"]);
  return {
    isolation: opt(value.isolation, "invalid_adapter", 60),
    commit: opt(value.commit, "invalid_adapter", 120),
    acceptance: list(value.acceptance, "invalid_adapter", 10)
      .map(item => text(item, "invalid_adapter", { max: 300 })!),
    merge: opt(value.merge, "invalid_adapter", 300),
  };
}

export async function taskKey(category: string, title: string): Promise<string> {
  return (await sha256Hex(`${category}\n${title}`)).slice(0, 32);
}

export async function parseIngest(body: Record<string, unknown>): Promise<IngestPayload> {
  return strict(async () => {
    assertKeys(body, ["schema", "generated_at", "project", "source", "tasks", "branches", "changelog"]);
    if (body.schema !== "workbench.v1") throw new AppError("unsupported_schema", 422);
    const project = body.project === undefined ? {} : body.project;
    if (!object(project)) throw new AppError("invalid_project", 422);
    assertKeys(project, ["name", "rules_path", "adapter"]);
    const source = body.source === undefined ? {} : body.source;
    if (!object(source)) throw new AppError("invalid_source", 422);
    assertKeys(source, ["sha", "branch"]);
    const sha = opt(source.sha, "invalid_source", 40);
    if (sha && !/^[0-9a-f]{7,40}$/.test(sha)) throw new AppError("invalid_source", 422);

    // A missing list would mark every open task done; an empty list must be explicit.
    if (!Array.isArray(body.tasks)) throw new AppError("invalid_tasks", 422);
    const seen = new Set<string>();
    const tasks: IngestTask[] = [];
    const rawTasks = list(body.tasks, "invalid_tasks", LIMITS.tasks);
    for (const [position, raw] of rawTasks.entries()) {
      if (!object(raw)) throw new AppError("invalid_task", 422);
      assertKeys(raw, ["key", "title", "status", "category", "due", "recorded", "what", "impact",
        "advice", "need", "need_kind", "source", "related"]);
      const title = text(raw.title, "invalid_task_title", { max: 200 })!;
      const category = text(raw.category, "invalid_task_category", { max: 60 })!;
      let key = opt(raw.key, "invalid_task_key", 64);
      if (key && !KEY.test(key)) throw new AppError("invalid_task_key", 422);
      key ||= await taskKey(category, title);
      if (seen.has(key)) throw new AppError("duplicate_task", 422);
      seen.add(key);
      tasks.push({
        key,
        title,
        category,
        status: oneOf(raw.status, WORK_STATUSES, "invalid_task_status"),
        due: date(raw.due, "invalid_task_due"),
        recorded: date(raw.recorded, "invalid_task_recorded"),
        what: opt(raw.what, "invalid_task_text", 2000),
        impact: opt(raw.impact, "invalid_task_text", 2000),
        advice: opt(raw.advice, "invalid_task_text", 2000),
        need: opt(raw.need, "invalid_task_text", 500),
        need_kind: raw.need_kind === undefined ? "none" : oneOf(raw.need_kind, NEED_KINDS, "invalid_need_kind"),
        source: opt(raw.source, "invalid_task_source", 300),
        related: list(raw.related, "invalid_task_related", LIMITS.related)
          .map(item => text(item, "invalid_task_related", { max: 300 })!),
        position,
      });
    }

    const branchNames = new Set<string>();
    const branches = list(body.branches, "invalid_branches", LIMITS.branches).map(raw => {
      if (!object(raw)) throw new AppError("invalid_branch", 422);
      assertKeys(raw, ["name", "ahead", "last_commit_at", "has_fragment"]);
      const name = text(raw.name, "invalid_branch", { max: 200 })!;
      if (branchNames.has(name)) throw new AppError("duplicate_branch", 422);
      branchNames.add(name);
      const ahead = raw.ahead === undefined ? 0 : raw.ahead;
      if (typeof ahead !== "number" || !Number.isInteger(ahead) || ahead < 0 || ahead > 100000) {
        throw new AppError("invalid_branch", 422);
      }
      if (raw.has_fragment !== undefined && typeof raw.has_fragment !== "boolean") {
        throw new AppError("invalid_branch", 422);
      }
      return { name, ahead, last_commit_at: iso(raw.last_commit_at, "invalid_branch"), has_fragment: raw.has_fragment === true };
    });

    const changelog = list(body.changelog, "invalid_changelog", LIMITS.changelog).map(raw => {
      if (!object(raw)) throw new AppError("invalid_changelog", 422);
      assertKeys(raw, ["date", "title", "summary"]);
      return {
        date: date(raw.date, "invalid_changelog")!,
        title: text(raw.title, "invalid_changelog", { max: 200 })!,
        summary: opt(raw.summary, "invalid_changelog", 500),
      };
    });
    for (const entry of changelog) if (!entry.date) throw new AppError("invalid_changelog", 422);

    return {
      project: {
        name: opt(project.name, "invalid_project", 120),
        rules_path: opt(project.rules_path, "invalid_project", 300),
        adapter: adapterOf(project.adapter),
      },
      source: { sha, branch: opt(source.branch, "invalid_source", 200) },
      tasks,
      branches,
      changelog,
    };
  });
}

/** Rejects credential-shaped text anywhere in the raw body. Reports only the field path. */
export function assertNoSecrets(body: unknown) {
  const hit = findSecret(body);
  if (hit) throw new AppError("secret_detected", 422, { field: hit });
}

export async function authenticateIngest(env: Env, projectId: string, header: string | undefined): Promise<void> {
  const match = header?.match(/^Bearer ([A-Za-z0-9_-]{20,200})$/);
  if (!match) throw new AppError("invalid_token", 401);
  const hash = await sha256Hex(match[1]);
  const row = await env.DB.prepare(
    "SELECT project_id FROM ingest_tokens WHERE project_id=? AND token_hash=?",
  ).bind(projectId, hash).first<{ project_id: string }>();
  // Unknown project and wrong token are indistinguishable to the caller.
  if (!row) throw new AppError("invalid_token", 401);
}

function canonical(payload: IngestPayload) {
  return JSON.stringify(payload);
}

export async function applyIngest(env: Env, projectId: string, payload: IngestPayload): Promise<IngestResult> {
  const contentHash = await sha256Hex(canonical(payload));
  const pushedAt = nowIso();
  const last = await env.DB.prepare(
    "SELECT content_hash FROM snapshots WHERE project_id=? ORDER BY id DESC LIMIT 1",
  ).bind(projectId).first<{ content_hash: string }>();
  const cutoff = new Date(Date.now() - DONE_RETENTION_DAYS * 86400_000).toISOString();
  const pruneDone = env.DB.prepare("DELETE FROM tasks WHERE project_id=? AND done_at IS NOT NULL AND done_at<?")
    .bind(projectId, cutoff);
  if (last?.content_hash === contentHash) {
    await env.DB.batch([
      env.DB.prepare("UPDATE projects SET last_push_at=? WHERE id=?").bind(pushedAt, projectId),
      env.DB.prepare("UPDATE ingest_tokens SET last_used_at=? WHERE project_id=?").bind(pushedAt, projectId),
      pruneDone,
    ]);
    return { project: projectId, content_hash: contentHash, deduplicated: true, tasks: payload.tasks.length,
      newly_done: 0, pushed_at: pushedAt };
  }

  const keys = JSON.stringify(payload.tasks.map(task => task.key));
  const doneCount = await env.DB.prepare(`SELECT COUNT(*) AS n FROM tasks
    WHERE project_id=?1 AND done_at IS NULL AND key NOT IN (SELECT value FROM json_each(?2))`)
    .bind(projectId, keys).first<{ n: number }>();
  const tasksJson = JSON.stringify(payload.tasks.map(task => ({ ...task, related: JSON.stringify(task.related) })));
  const project = payload.project;

  await env.DB.batch([
    env.DB.prepare(`UPDATE tasks SET done_at=?3
      WHERE project_id=?1 AND done_at IS NULL AND key NOT IN (SELECT value FROM json_each(?2))`)
      .bind(projectId, keys, pushedAt),
    env.DB.prepare(`INSERT INTO tasks (project_id,key,title,status,category,due,recorded,what,impact,advice,
        need,need_kind,source,related_json,position,first_seen,last_seen,done_at)
      SELECT ?1, json_extract(value,'$.key'), json_extract(value,'$.title'), json_extract(value,'$.status'),
        json_extract(value,'$.category'), json_extract(value,'$.due'), json_extract(value,'$.recorded'),
        json_extract(value,'$.what'), json_extract(value,'$.impact'), json_extract(value,'$.advice'),
        json_extract(value,'$.need'), json_extract(value,'$.need_kind'), json_extract(value,'$.source'),
        json_extract(value,'$.related'), json_extract(value,'$.position'), ?3, ?3, NULL
      FROM json_each(?2) WHERE true
      ON CONFLICT(project_id,key) DO UPDATE SET title=excluded.title, status=excluded.status,
        category=excluded.category, due=excluded.due, recorded=excluded.recorded, what=excluded.what,
        impact=excluded.impact, advice=excluded.advice, need=excluded.need, need_kind=excluded.need_kind,
        source=excluded.source, related_json=excluded.related_json, position=excluded.position,
        last_seen=excluded.last_seen, done_at=NULL`)
      .bind(projectId, tasksJson, pushedAt),
    env.DB.prepare("DELETE FROM branches WHERE project_id=?").bind(projectId),
    env.DB.prepare(`INSERT INTO branches (project_id,name,ahead,last_commit_at,has_fragment)
      SELECT ?1, json_extract(value,'$.name'), json_extract(value,'$.ahead'),
        json_extract(value,'$.last_commit_at'), json_extract(value,'$.has_fragment')
      FROM json_each(?2)`)
      .bind(projectId, JSON.stringify(payload.branches.map(b => ({ ...b, has_fragment: b.has_fragment ? 1 : 0 })))),
    env.DB.prepare("DELETE FROM changelog_entries WHERE project_id=?").bind(projectId),
    env.DB.prepare(`INSERT INTO changelog_entries (project_id,position,date,title,summary)
      SELECT ?1, key, json_extract(value,'$.date'), json_extract(value,'$.title'), json_extract(value,'$.summary')
      FROM json_each(?2)`)
      .bind(projectId, JSON.stringify(payload.changelog)),
    env.DB.prepare(`INSERT INTO snapshots (project_id,content_hash,source_sha,pushed_at,task_count,done_count)
      VALUES (?,?,?,?,?,?)`)
      .bind(projectId, contentHash, payload.source.sha, pushedAt, payload.tasks.length, Number(doneCount?.n || 0)),
    env.DB.prepare(`DELETE FROM snapshots WHERE project_id=?1 AND id NOT IN
      (SELECT id FROM snapshots WHERE project_id=?1 ORDER BY id DESC LIMIT ?2)`)
      .bind(projectId, SNAPSHOT_KEEP),
    pruneDone,
    // The display name belongs to the web page (set at creation, renamed there); a push never overwrites it.
    env.DB.prepare(`UPDATE projects SET rules_path=?2, adapter_json=?3,
        source_sha=?4, source_branch=?5, last_push_at=?6, updated_at=?6 WHERE id=?1`)
      .bind(projectId, project.rules_path, project.adapter ? JSON.stringify(project.adapter) : null,
        payload.source.sha, payload.source.branch, pushedAt),
    env.DB.prepare("UPDATE ingest_tokens SET last_used_at=? WHERE project_id=?").bind(pushedAt, projectId),
  ]);
  return { project: projectId, content_hash: contentHash, deduplicated: false, tasks: payload.tasks.length,
    newly_done: Number(doneCount?.n || 0), pushed_at: pushedAt };
}
