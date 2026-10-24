import { MCP_LIMITS } from "@kedoupi/shared/mcp/contract";
import { AppError, jsonBytes, maxIso, projectUrl, text } from "./lib";
import { handoffFromRow } from "./handoffs";
import type { Env, HandoffRow, ProjectRow, ProjectStatus } from "./types";
import type { Handoff } from "./types";

const REPO_PATTERN = /^[A-Za-z0-9-]+\/[A-Za-z0-9._-]+$/;
const STATUSES: readonly ProjectStatus[] = ["active", "paused", "archived"];

export interface ProjectListItem {
  id: string;
  repo: string;
  name: string;
  status: ProjectStatus;
  last_activity_at: string | null;
  url: string;
  latest_handoff: Handoff | null;
}

export interface ProjectList {
  as_of: string | null;
  projects: ProjectListItem[];
}

export interface ProjectListSummaryItem {
  id: string;
  repo: string;
  name: string;
  status: ProjectStatus;
  last_activity_at: string | null;
  url: string;
  latest_handoff: {
    task_id: string;
    status: Handoff["status"];
    next: string;
  } | null;
}

export interface ProjectListSummaryPage {
  as_of: string | null;
  projects: ProjectListSummaryItem[];
  next_offset: number | null;
  revision: string;
}

interface ProjectListSummary {
  as_of: string | null;
  projects: ProjectListSummaryItem[];
  revision: string;
}

const encoder = new TextEncoder();

async function listRevision(
  status: ProjectStatus | undefined,
  projects: ProjectListSummaryItem[],
): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    encoder.encode(JSON.stringify({ status: status ?? null, projects })),
  );
  return Array.from(new Uint8Array(digest), byte =>
    byte.toString(16).padStart(2, "0")).join("");
}

export function projectIdOf(repo: string) {
  return repo.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

export function isProjectStatus(value: unknown): value is ProjectStatus {
  return typeof value === "string" && STATUSES.includes(value as ProjectStatus);
}

export function configuredRepos(env: Env): Set<string> {
  const repos = new Set<string>();
  for (const raw of (env.PROJECT_REPOS || "").split(",")) {
    const repo = raw.trim();
    if (repo && REPO_PATTERN.test(repo)) repos.add(repo.toLowerCase());
  }
  return repos;
}

export function isConfiguredForSync(env: Env, repo: string): boolean {
  return configuredRepos(env).has(repo.toLowerCase());
}

export async function ensureProjects(env: Env): Promise<void> {
  if (!env.PROJECT_REPOS) return;
  const seen = new Set<string>();
  for (const raw of env.PROJECT_REPOS.split(",")) {
    const repo = raw.trim();
    if (!repo) continue;
    if (!REPO_PATTERN.test(repo)) {
      console.warn(JSON.stringify({ event: "project_repo_invalid" }));
      continue;
    }
    const id = projectIdOf(repo);
    if (!id || seen.has(id)) {
      console.warn(JSON.stringify({ event: "project_repo_id_collision" }));
      continue;
    }
    seen.add(id);
    const name = repo.slice(repo.indexOf("/") + 1);
    await env.DB.prepare(`INSERT INTO projects (id,repo,name)
      VALUES (?,?,?)
      ON CONFLICT(repo) DO NOTHING`).bind(id, repo, name).run();
  }
}

export async function allProjects(env: Env, status?: ProjectStatus): Promise<ProjectRow[]> {
  await ensureProjects(env);
  const rows = status
    ? await env.DB.prepare("SELECT * FROM projects WHERE status=? ORDER BY created_at, id")
      .bind(status).all<ProjectRow>()
    : await env.DB.prepare("SELECT * FROM projects ORDER BY created_at, id").all<ProjectRow>();
  return rows.results;
}

export async function resolveProject(env: Env, ref: string): Promise<ProjectRow> {
  const clean = text(ref, "project_required", { max: 200 })!;
  await ensureProjects(env);
  const projects = (await env.DB.prepare("SELECT * FROM projects").all<ProjectRow>()).results;
  const lower = clean.toLowerCase();
  const exact = projects.filter(project => project.id.toLowerCase() === lower);
  const matches = exact.length
    ? exact
    : projects.filter(project => {
      const [owner, name] = project.repo.toLowerCase().split("/");
      return project.repo.toLowerCase() === lower ||
        project.name.toLowerCase() === lower ||
        (name === lower && owner === "kedoupi");
    });
  if (matches.length === 1) return matches[0];
  throw new AppError("project_not_found", 404);
}

export async function activeProjects(env: Env): Promise<ProjectRow[]> {
  const repos = configuredRepos(env);
  return (await allProjects(env, "active")).filter(project =>
    repos.has(project.repo.toLowerCase()));
}

export async function latestHandoffs(
  env: Env,
  projectIds: string[],
): Promise<Map<string, HandoffRow>> {
  const latest = new Map<string, HandoffRow>();
  if (!projectIds.length) return latest;
  const placeholders = projectIds.map(() => "?").join(",");
  const rows = await env.DB.prepare(`SELECT * FROM handoffs
    WHERE project_id IN (${placeholders}) ORDER BY created_at DESC, rowid DESC`)
    .bind(...projectIds).all<HandoffRow>();
  for (const row of rows.results) {
    if (!latest.has(row.project_id)) latest.set(row.project_id, row);
  }
  return latest;
}

export async function activityByProject(
  env: Env,
  projectIds: string[],
): Promise<Map<string, string | null>> {
  const activity = new Map<string, string | null>();
  if (!projectIds.length) return activity;
  const placeholders = projectIds.map(() => "?").join(",");
  const rows = await env.DB.prepare(`SELECT project_id, MAX(happened_at) AS at
    FROM repo_events WHERE project_id IN (${placeholders}) GROUP BY project_id`)
    .bind(...projectIds).all<{ project_id: string; at: string | null }>();
  for (const row of rows.results) activity.set(row.project_id, row.at);
  return activity;
}

function lastActivity(
  project: ProjectRow,
  latestAt: string | null,
  eventAt: string | null,
) {
  return maxIso(project.updated_at, latestAt, eventAt);
}

function sortProjectItems<T extends {
  status: ProjectStatus;
  last_activity_at: string | null;
  name: string;
}>(items: T[]): T[] {
  const rank: Record<ProjectStatus, number> = { active: 0, paused: 1, archived: 2 };
  return items.sort((a, b) => rank[a.status] - rank[b.status] ||
    (Date.parse(b.last_activity_at || "") || 0) - (Date.parse(a.last_activity_at || "") || 0) ||
    a.name.localeCompare(b.name, "zh-CN"));
}

function asOfOf(items: { last_activity_at: string | null }[]) {
  return items.reduce<string | null>((latest, item) =>
    maxIso(latest, item.last_activity_at), null);
}

export async function listProjects(
  env: Env,
  status?: ProjectStatus,
): Promise<ProjectList> {
  const projects = await allProjects(env, status);
  const [latestByProject, eventAtByProject] = await Promise.all([
    latestHandoffs(env, projects.map(project => project.id)),
    activityByProject(env, projects.map(project => project.id)),
  ]);
  const items: ProjectListItem[] = projects.map(project => {
    const latestRow = latestByProject.get(project.id);
    const latest = latestRow ? handoffFromRow(latestRow) : null;
    return {
      id: project.id,
      repo: project.repo,
      name: project.name,
      status: project.status,
      last_activity_at: lastActivity(
        project,
        latest?.at ?? null,
        eventAtByProject.get(project.id) ?? null,
      ),
      url: projectUrl(env, project.id),
      latest_handoff: latest,
    };
  });
  sortProjectItems(items);
  return {
    as_of: asOfOf(items),
    projects: items,
  };
}

function briefNext(value: string) {
  const compact = value.replace(/\s+/g, " ").trim();
  const characters = Array.from(compact);
  return characters.length > 160
    ? `${characters.slice(0, 157).join("")}...`
    : compact;
}

export async function listProjectSummaries(
  env: Env,
  status?: ProjectStatus,
): Promise<ProjectListSummary> {
  const projects = await allProjects(env, status);
  const [latestByProject, eventAtByProject] = await Promise.all([
    latestHandoffs(env, projects.map(project => project.id)),
    activityByProject(env, projects.map(project => project.id)),
  ]);
  const items: ProjectListSummaryItem[] = projects.map(project => {
    const latest = latestByProject.get(project.id);
    return {
      id: project.id,
      repo: project.repo,
      name: project.name,
      status: project.status,
      last_activity_at: lastActivity(
        project,
        latest?.created_at ?? null,
        eventAtByProject.get(project.id) ?? null,
      ),
      url: projectUrl(env, project.id),
      latest_handoff: latest
        ? {
          task_id: latest.task_id,
          status: latest.status,
          next: briefNext(latest.next),
        }
        : null,
    };
  });
  sortProjectItems(items);
  return {
    as_of: asOfOf(items),
    projects: items,
    revision: await listRevision(status, items),
  };
}

export function projectListPage(
  list: ProjectListSummary,
  offset: number,
  limit: number,
): ProjectListSummaryPage {
  const all = list.projects;
  const end = Math.min(offset + limit, all.length);
  let count = 0;
  for (let index = offset; index < end; index++) {
    const nextOffset = index + 1 < all.length ? index + 1 : null;
    const candidate: ProjectListSummaryPage = {
      as_of: list.as_of,
      projects: all.slice(offset, index + 1),
      next_offset: nextOffset,
      revision: list.revision,
    };
    if (jsonBytes({ ok: true, data: candidate }) > MCP_LIMITS.detail) break;
    count++;
  }
  if (count === 0 && offset < all.length) throw new AppError("page_too_large", 500);
  const nextOffset = offset + count < all.length ? offset + count : null;
  return {
    as_of: list.as_of,
    projects: all.slice(offset, offset + count),
    next_offset: nextOffset,
    revision: list.revision,
  };
}

export async function updateProject(
  env: Env,
  project: ProjectRow,
  update: { status?: ProjectStatus; name?: string },
): Promise<ProjectRow> {
  if (update.status !== undefined) {
    await env.DB.prepare("UPDATE projects SET status=?, updated_at=? WHERE id=?")
      .bind(update.status, new Date().toISOString(), project.id).run();
  }
  if (update.name !== undefined) {
    const name = text(update.name, "invalid_name", { max: 120 })!;
    await env.DB.prepare("UPDATE projects SET name=?, updated_at=? WHERE id=?")
      .bind(name, new Date().toISOString(), project.id).run();
  }
  const row = await env.DB.prepare("SELECT * FROM projects WHERE id=?")
    .bind(project.id).first<ProjectRow>();
  if (!row) throw new AppError("project_not_found", 404);
  return row;
}

export async function projectLatestHandoff(env: Env, projectId: string) {
  return (await latestHandoffs(env, [projectId])).get(projectId) ?? null;
}
