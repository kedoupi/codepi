import { AppError, newToken, nowIso, projectUrl, sha256Hex, text } from "./lib";
import { PROJECT_STATUSES, type Adapter, type Env, type ProjectRow, type ProjectStatus, type ProjectSummary } from "./types";

const ID_PATTERN = /^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/;
const REPO_PATTERN = /^[A-Za-z0-9-]+\/[A-Za-z0-9._-]+$/;

export function isProjectStatus(value: unknown): value is ProjectStatus {
  return typeof value === "string" && PROJECT_STATUSES.includes(value as ProjectStatus);
}

/** Accepts the project id or its `owner/repo`, case-insensitively for the repo. */
export async function resolveProject(env: Env, ref: string): Promise<ProjectRow> {
  const clean = text(ref, "project_required", { max: 200 })!;
  const row = await env.DB.prepare(
    "SELECT * FROM projects WHERE id=? OR lower(repo)=lower(?) LIMIT 1",
  ).bind(clean, clean).first<ProjectRow>();
  if (!row) throw new AppError("project_not_found", 404);
  return row;
}

export function adapterOf(row: ProjectRow): Adapter | null {
  if (!row.adapter_json) return null;
  try {
    return JSON.parse(row.adapter_json) as Adapter;
  } catch {
    return null;
  }
}

async function issueToken(env: Env, projectId: string): Promise<string> {
  const token = newToken();
  await env.DB.prepare(`INSERT INTO ingest_tokens (project_id,token_hash,created_at,last_used_at)
    VALUES (?,?,?,NULL)
    ON CONFLICT(project_id) DO UPDATE SET token_hash=excluded.token_hash,
      created_at=excluded.created_at, last_used_at=NULL`)
    .bind(projectId, await sha256Hex(token), nowIso()).run();
  return token;
}

export async function createProject(env: Env, input: { id: unknown; name: unknown; repo: unknown }) {
  const id = text(input.id, "invalid_project_id", { max: 64 })!;
  if (!ID_PATTERN.test(id)) throw new AppError("invalid_project_id", 400);
  const name = text(input.name, "invalid_name", { max: 120 })!;
  const repo = input.repo === undefined || input.repo === null || input.repo === ""
    ? null
    : text(input.repo, "invalid_repo", { max: 200 });
  if (repo && !REPO_PATTERN.test(repo)) throw new AppError("invalid_repo", 400);
  const now = nowIso();
  const inserted = await env.DB.prepare(`INSERT INTO projects (id,name,repo,status,created_at,updated_at)
    VALUES (?,?,?,'active',?,?) ON CONFLICT DO NOTHING RETURNING id`)
    .bind(id, name, repo, now, now).first<{ id: string }>();
  if (!inserted) throw new AppError("project_exists", 409);
  return { project: id, token: await issueToken(env, id) };
}

export async function rotateToken(env: Env, project: ProjectRow) {
  return { project: project.id, token: await issueToken(env, project.id) };
}

export async function tokenInfo(env: Env, projectId: string) {
  return env.DB.prepare("SELECT created_at, last_used_at FROM ingest_tokens WHERE project_id=?")
    .bind(projectId).first<{ created_at: string; last_used_at: string | null }>();
}

export async function updateProject(env: Env, project: ProjectRow, changes: { status?: ProjectStatus; name?: string }) {
  const row = await env.DB.prepare(`UPDATE projects SET status=COALESCE(?,status), name=COALESCE(?,name),
    updated_at=? WHERE id=? RETURNING *`)
    .bind(changes.status ?? null, changes.name ?? null, nowIso(), project.id).first<ProjectRow>();
  if (!row) throw new AppError("project_not_found", 404);
  return row;
}

export async function projectSummaries(env: Env, status?: ProjectStatus): Promise<ProjectSummary[]> {
  const rows = await env.DB.prepare(`SELECT p.*,
      (SELECT COUNT(*) FROM tasks t WHERE t.project_id=p.id AND t.done_at IS NULL) AS open,
      (SELECT COUNT(*) FROM tasks t WHERE t.project_id=p.id AND t.done_at IS NULL AND t.need_kind<>'none') AS need_you,
      (SELECT COUNT(*) FROM branches b WHERE b.project_id=p.id) AS branch_count
    FROM projects p ${status ? "WHERE p.status=?" : ""}
    ORDER BY CASE p.status WHEN 'active' THEN 0 WHEN 'paused' THEN 1 ELSE 2 END, p.created_at, p.id`)
    .bind(...(status ? [status] : []))
    .all<ProjectRow & { open: number; need_you: number; branch_count: number }>();
  return rows.results.map(row => ({
    id: row.id,
    name: row.name,
    repo: row.repo,
    status: row.status,
    last_push_at: row.last_push_at,
    open: Number(row.open),
    need_you: Number(row.need_you),
    branches: Number(row.branch_count),
    url: projectUrl(env, row.id),
  }));
}
