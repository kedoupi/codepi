import { addDays, AppError, jsonBytes, projectUrl, sha256Hex, taskUrl, today } from "./lib";
import { latestPerTask, taskHandoffs } from "./handoffs";
import { adapterOf, projectSummaries, resolveProject, tokenInfo } from "./projects";
import type {
  BranchRow,
  ChangelogRow,
  Env,
  NeedKind,
  ProjectRow,
  TaskBrief,
  TaskDetail,
  TaskRow,
  WorkStatus,
} from "./types";

export interface TaskFilter {
  project?: string;
  status?: WorkStatus;
  need?: NeedKind | "any";
  category?: string;
  dueWithinDays?: number;
  includeDone?: boolean;
}

function brief(row: TaskRow): TaskBrief {
  return {
    project: row.project_id,
    key: row.key,
    title: row.title,
    status: row.status,
    category: row.category,
    due: row.due,
    need_kind: row.need_kind,
    done_at: row.done_at,
  };
}

function related(value: string | null): string[] {
  if (!value) return [];
  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : [];
  } catch {
    return [];
  }
}

function detail(row: TaskRow): TaskDetail {
  return {
    ...brief(row),
    what: row.what,
    impact: row.impact,
    advice: row.advice,
    need: row.need,
    source: row.source,
    related: related(row.related_json),
    recorded: row.recorded,
    first_seen: row.first_seen,
    last_seen: row.last_seen,
  };
}

/** Open tasks first by due date (none last), then those needing the owner, then list order. */
function byUrgency(a: TaskRow, b: TaskRow) {
  if (a.due !== b.due) {
    if (!a.due) return 1;
    if (!b.due) return -1;
    return a.due < b.due ? -1 : 1;
  }
  const an = a.need_kind === "none" ? 1 : 0;
  const bn = b.need_kind === "none" ? 1 : 0;
  if (an !== bn) return an - bn;
  return byIdentity(a, b);
}

/** Total order tie-break so pages and revisions never depend on SQLite row order. */
function byIdentity(a: TaskRow, b: TaskRow) {
  if (a.project_id !== b.project_id) return a.project_id < b.project_id ? -1 : 1;
  if (a.position !== b.position) return a.position - b.position;
  return a.key < b.key ? -1 : a.key > b.key ? 1 : 0;
}

export async function listTasks(env: Env, filter: TaskFilter = {}, now = new Date()): Promise<TaskRow[]> {
  const where: string[] = [];
  const params: unknown[] = [];
  if (filter.project) {
    // Naming a project reads it even when archived; the cross-project views leave archived projects out.
    const project = await resolveProject(env, filter.project);
    where.push("t.project_id=?");
    params.push(project.id);
  } else {
    where.push("p.status<>'archived'");
  }
  if (!filter.includeDone) where.push("t.done_at IS NULL");
  if (filter.status) {
    where.push("t.status=?");
    params.push(filter.status);
  }
  if (filter.need === "any") where.push("t.need_kind<>'none'");
  else if (filter.need) {
    where.push("t.need_kind=?");
    params.push(filter.need);
  }
  if (filter.category) {
    where.push("t.category=?");
    params.push(filter.category);
  }
  if (filter.dueWithinDays !== undefined) {
    where.push("t.due IS NOT NULL AND t.due<=?");
    params.push(addDays(today(now), filter.dueWithinDays));
  }
  const rows = await env.DB.prepare(`SELECT t.* FROM tasks t JOIN projects p ON p.id=t.project_id
    WHERE ${where.join(" AND ")} ORDER BY t.project_id, t.position, t.key`).bind(...params).all<TaskRow>();
  const open = rows.results.filter(row => !row.done_at).sort(byUrgency);
  const done = rows.results.filter(row => row.done_at)
    .sort((a, b) => (a.done_at! !== b.done_at! ? (a.done_at! < b.done_at! ? 1 : -1) : byIdentity(a, b)));
  return [...open, ...done];
}

export async function taskPage(env: Env, filter: TaskFilter, offset: number, limit: number, revision?: string) {
  const rows = (await listTasks(env, filter)).map(brief);
  const current = await sha256Hex(JSON.stringify({ filter, rows }));
  if ((offset > 0 && revision === undefined) || (revision !== undefined && revision !== current)) {
    throw new AppError("cursor_stale", 409);
  }
  const tasks: TaskBrief[] = [];
  const budget = 11 * 1024;
  let index = offset;
  while (index < rows.length && tasks.length < limit) {
    if (tasks.length && jsonBytes({ tasks: [...tasks, rows[index]] }) > budget) break;
    tasks.push(rows[index]);
    index++;
  }
  return {
    as_of: new Date().toISOString(),
    total: rows.length,
    tasks,
    next_offset: index < rows.length ? index : null,
    revision: current,
  };
}

export async function getTask(env: Env, projectRef: string, key: string, handoffLimit = 10) {
  const project = await resolveProject(env, projectRef);
  const row = await env.DB.prepare("SELECT * FROM tasks WHERE project_id=? AND key=?")
    .bind(project.id, key).first<TaskRow>();
  if (!row) throw new AppError("task_not_found", 404);
  return {
    project: { id: project.id, name: project.name },
    task: detail(row),
    handoffs: await taskHandoffs(env, project.id, key, handoffLimit),
    url: taskUrl(env, project.id, key),
  };
}

async function branchRows(env: Env, projectId?: string) {
  const rows = await env.DB.prepare(`SELECT b.* FROM branches b JOIN projects p ON p.id=b.project_id
    WHERE p.status<>'archived' ${projectId ? "AND b.project_id=?" : ""}
    ORDER BY b.last_commit_at DESC, b.name`).bind(...(projectId ? [projectId] : [])).all<BranchRow>();
  return rows.results.map(row => ({
    project: row.project_id,
    name: row.name,
    ahead: row.ahead,
    last_commit_at: row.last_commit_at,
    has_fragment: row.has_fragment === 1,
  }));
}

export async function overview(env: Env, opts: { limit: number; dated?: boolean }, now = new Date()) {
  const day = today(now);
  const soon = addDays(day, 7);
  const weekAgo = new Date(now.getTime() - 7 * 86400_000).toISOString();
  const rows = await listTasks(env, { includeDone: true }, now);
  const open = rows.filter(row => !row.done_at);
  const needYou = open.filter(row => row.need_kind !== "none");
  const overdue = open.filter(row => row.due && row.due < day);
  const dueSoon = open.filter(row => row.due && row.due <= soon);
  const done = rows.filter(row => row.done_at && row.done_at >= weekAgo);
  const branches = await branchRows(env);
  return {
    as_of: now.toISOString(),
    today: day,
    counts: {
      open: open.length,
      need_you: needYou.length,
      overdue: overdue.length,
      due_7d: dueSoon.length,
      branches: branches.length,
      done_7d: done.length,
    },
    need_you: needYou.slice(0, opts.limit).map(brief),
    due_soon: dueSoon.slice(0, opts.limit).map(brief),
    // Every open task with a due date, for the browser countdown chart only.
    ...(opts.dated ? { dated: open.filter(row => row.due).slice(0, opts.limit).map(brief) } : {}),
    recently_done: done.slice(0, opts.limit).map(brief),
    branches: branches.slice(0, opts.limit),
    projects: (await projectSummaries(env)).filter(project => project.status !== "archived"),
  };
}

export async function projectCard(env: Env, project: ProjectRow, opts: { changelog: number; handoffs: number; token: boolean }) {
  const [counts, branches, changelog, handoffs, token] = await Promise.all([
    env.DB.prepare(`SELECT status, need_kind, done_at FROM tasks WHERE project_id=?`)
      .bind(project.id).all<{ status: WorkStatus; need_kind: NeedKind; done_at: string | null }>(),
    branchRows(env, project.id),
    env.DB.prepare("SELECT * FROM changelog_entries WHERE project_id=? ORDER BY position LIMIT ?")
      .bind(project.id, opts.changelog).all<ChangelogRow>(),
    latestPerTask(env, project.id, opts.handoffs),
    opts.token ? tokenInfo(env, project.id) : Promise.resolve(null),
  ]);
  const weekAgo = new Date(Date.now() - 7 * 86400_000).toISOString();
  const byStatus: Record<string, number> = { decide: 0, doing: 0, bug: 0, verify: 0, idea: 0 };
  let needYou = 0;
  let done7d = 0;
  for (const row of counts.results) {
    if (row.done_at) {
      if (row.done_at >= weekAgo) done7d++;
      continue;
    }
    byStatus[row.status] = (byStatus[row.status] || 0) + 1;
    if (row.need_kind !== "none") needYou++;
  }
  return {
    project: {
      id: project.id,
      name: project.name,
      repo: project.repo,
      status: project.status,
      rules_path: project.rules_path,
      adapter: adapterOf(project),
      source_sha: project.source_sha,
      source_branch: project.source_branch,
      last_push_at: project.last_push_at,
      url: projectUrl(env, project.id),
    },
    counts: { by_status: byStatus, need_you: needYou, done_7d: done7d },
    branches,
    changelog: changelog.results.map(row => ({ date: row.date, title: row.title, summary: row.summary })),
    handoffs,
    ...(opts.token ? { token: token ? { created_at: token.created_at, last_used_at: token.last_used_at } : null } : {}),
  };
}

export async function activityLog(env: Env, opts: { days: number; project?: string }, now = new Date()) {
  const since = addDays(today(now), -opts.days);
  const project = opts.project ? await resolveProject(env, opts.project) : null;
  const scope = project ? "AND c.project_id=?" : "";
  const [entries, done] = await Promise.all([
    env.DB.prepare(`SELECT c.* FROM changelog_entries c JOIN projects p ON p.id=c.project_id
      WHERE p.status<>'archived' AND c.date>=? ${scope} ORDER BY c.date DESC, c.project_id, c.position LIMIT 300`)
      .bind(since, ...(project ? [project.id] : [])).all<ChangelogRow>(),
    env.DB.prepare(`SELECT t.* FROM tasks t JOIN projects p ON p.id=t.project_id
      WHERE p.status<>'archived' AND t.done_at IS NOT NULL AND t.done_at>=? ${scope.replace("c.", "t.")}
      ORDER BY t.done_at DESC LIMIT 200`)
      .bind(`${since}T00:00:00Z`, ...(project ? [project.id] : [])).all<TaskRow>(),
  ]);
  const items = [
    ...entries.results.map(row => ({ kind: "change" as const, project: row.project_id, date: row.date,
      title: row.title, summary: row.summary, at: null as string | null })),
    ...done.results.map(row => ({ kind: "done" as const, project: row.project_id, date: today(new Date(row.done_at!)),
      title: row.title, summary: null, at: row.done_at })),
  ].sort((a, b) => (a.date === b.date ? (a.kind === b.kind ? 0 : a.kind === "done" ? -1 : 1) : a.date < b.date ? 1 : -1));
  return { as_of: now.toISOString(), since, items };
}

/** Drops trailing items from the named arrays until the value fits the byte budget. */
export function fit<T extends Record<string, unknown>>(value: T, arrays: (keyof T)[], budget: number): T & { truncated?: string[] } {
  const result = { ...value } as T & { truncated?: string[] };
  const truncated = new Set<string>();
  for (const key of arrays) result[key] = [...(result[key] as unknown[])] as T[keyof T];
  while (jsonBytes(result) > budget) {
    const key = arrays
      .filter(name => (result[name] as unknown[]).length > 0)
      .sort((a, b) => (result[b] as unknown[]).length - (result[a] as unknown[]).length)[0];
    if (!key) break;
    (result[key] as unknown[]).pop();
    truncated.add(String(key));
    result.truncated = [...truncated];
  }
  return result;
}
