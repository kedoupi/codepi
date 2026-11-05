import { AppError, jsonBytes, today } from "./lib";
import { resolveProject } from "./projects";
import type { Env, NeedKind, TaskBrief, TaskRow } from "./types";

export type TodayWho = "you" | "agent";

export interface TodayItem extends TaskBrief {
  carried: boolean;
  who: TodayWho;
}

interface TodayRow extends TaskRow {
  picked_day: string | null;
  picked_by: "owner" | "agent" | null;
  removed_day: string | null;
  owner_done_at: string | null;
}

interface TodayTaskRef {
  project: string;
  key: string;
}

function who(needKind: NeedKind): TodayWho {
  return ["attend", "decide", "confirm"].includes(needKind) ? "you" : "agent";
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

function byDueAndPosition(a: TodayRow, b: TodayRow): number {
  if (a.due !== b.due) {
    if (!a.due) return 1;
    if (!b.due) return -1;
    return a.due < b.due ? -1 : 1;
  }
  if (a.position !== b.position) return a.position - b.position;
  if (a.project_id !== b.project_id) return a.project_id < b.project_id ? -1 : 1;
  return a.key < b.key ? -1 : a.key > b.key ? 1 : 0;
}

function item(row: TodayRow, day: string): TodayItem {
  return { ...brief(row), carried: row.picked_day !== null && row.picked_day < day, who: who(row.need_kind) };
}

async function rowsForToday(env: Env, projectId?: string): Promise<TodayRow[]> {
  const scope = projectId ? "t.project_id=?" : "p.status<>'archived'";
  return (await env.DB.prepare(`SELECT t.*, tp.picked_day, tp.picked_by, tp.removed_day,
      od.done_at AS owner_done_at
    FROM tasks t JOIN projects p ON p.id=t.project_id
    LEFT JOIN today_picks tp ON tp.project_id=t.project_id AND tp.task_key=t.key
    LEFT JOIN owner_done od ON od.project_id=t.project_id AND od.task_key=t.key
    WHERE ${scope}
    ORDER BY t.project_id, t.position, t.key`).bind(...(projectId ? [projectId] : [])).all<TodayRow>()).results;
}

/** Build the owner board for one Beijing calendar day. */
export async function todayView(env: Env, now = new Date(), projectId?: string) {
  const day = today(now);
  const rows = await rowsForToday(env, projectId);
  const open = rows.filter(row => !row.done_at && !row.owner_done_at);
  const selected = open.filter(row => row.picked_day !== null && row.removed_day !== day);
  const selectedKeys = new Set(selected.map(row => `${row.project_id}\0${row.key}`));
  const pool = open.filter(row => !selectedKeys.has(`${row.project_id}\0${row.key}`));
  const doneKeys = new Set<string>();
  const done = rows.filter(row => {
    const taskDoneToday = row.done_at !== null && today(new Date(row.done_at)) === day;
    const ownerDoneToday = row.owner_done_at !== null && today(new Date(row.owner_done_at)) === day;
    if (!taskDoneToday && !ownerDoneToday) return false;
    const key = `${row.project_id}\0${row.key}`;
    if (doneKeys.has(key)) return false;
    doneKeys.add(key);
    return true;
  });
  selected.sort(byDueAndPosition);
  pool.sort(byDueAndPosition);
  done.sort(byDueAndPosition);
  const todayItems = selected.map(row => item(row, day));
  const poolItems = pool.map(row => brief(row));
  const doneItems = done.map(row => brief(row));
  return {
    today: todayItems,
    pool: poolItems,
    done: doneItems,
    counts: { today: todayItems.length, pool: poolItems.length, done: doneItems.length },
    date: day,
  };
}

async function taskFor(env: Env, ref: TodayTaskRef): Promise<{ projectId: string; task: TaskRow }> {
  const project = await resolveProject(env, ref.project);
  const task = await env.DB.prepare("SELECT * FROM tasks WHERE project_id=? AND key=?")
    .bind(project.id, ref.key).first<TaskRow>();
  if (!task) throw new AppError("task_not_found", 404);
  return { projectId: project.id, task };
}

function ref(project: unknown, key: unknown): TodayTaskRef {
  if (typeof project !== "string" || !project.trim() || project.length > 200 ||
    typeof key !== "string" || !key.trim() || key.length > 64) {
    throw new AppError("invalid_arguments", 400);
  }
  return { project: project.trim(), key: key.trim() };
}

/** Pick a task for the owner or agent. Existing owner picks always win. */
export async function pickToday(env: Env, project: unknown, key: unknown, pickedBy: "owner" | "agent", now = new Date()) {
  const target = ref(project, key);
  const { projectId, task } = await taskFor(env, target);
  if (task.done_at) return { written: 0 };
  const ownerDone = await env.DB.prepare("SELECT 1 FROM owner_done WHERE project_id=? AND task_key=?")
    .bind(projectId, task.key).first();
  if (ownerDone) return { written: 0 };
  const day = today(now);
  const existing = await env.DB.prepare("SELECT picked_by, removed_day FROM today_picks WHERE project_id=? AND task_key=?")
    .bind(projectId, task.key).first<{ picked_by: "owner" | "agent"; removed_day: string | null }>();
  if (existing?.removed_day === day) return { written: 0 };
  if (existing?.picked_by === "owner" && pickedBy === "agent") return { written: 0 };
  if (existing?.picked_by === pickedBy && existing.removed_day === null) return { written: 0 };
  const createdAt = now.toISOString().replace(/\.\d{3}Z$/, "Z");
  await env.DB.prepare(`INSERT INTO today_picks (project_id, task_key, picked_day, picked_by, removed_day, created_at)
    VALUES (?, ?, ?, ?, NULL, ?)
    ON CONFLICT(project_id, task_key) DO UPDATE SET picked_day=excluded.picked_day,
      picked_by=excluded.picked_by, removed_day=NULL`).bind(projectId, task.key, day, pickedBy, createdAt).run();
  return { written: 1 };
}

export async function unpickToday(env: Env, project: unknown, key: unknown, now = new Date()) {
  const target = ref(project, key);
  const { projectId, task } = await taskFor(env, target);
  const day = today(now);
  const existing = await env.DB.prepare("SELECT picked_by FROM today_picks WHERE project_id=? AND task_key=?")
    .bind(projectId, task.key).first<{ picked_by: "owner" | "agent" }>();
  if (!existing) return { written: 0 };
  if (existing.picked_by === "agent") {
    await env.DB.prepare("UPDATE today_picks SET removed_day=? WHERE project_id=? AND task_key=?")
      .bind(day, projectId, task.key).run();
  } else {
    await env.DB.prepare("DELETE FROM today_picks WHERE project_id=? AND task_key=?").bind(projectId, task.key).run();
  }
  return { written: 1 };
}

export async function markOwnerDone(env: Env, project: unknown, key: unknown, now = new Date()) {
  const target = ref(project, key);
  const { projectId, task } = await taskFor(env, target);
  if (who(task.need_kind) !== "you") throw new AppError("owner_only", 422);
  const doneAt = now.toISOString().replace(/\.\d{3}Z$/, "Z");
  const result = await env.DB.prepare(`INSERT INTO owner_done (project_id, task_key, done_at)
    VALUES (?, ?, ?) ON CONFLICT(project_id, task_key) DO NOTHING`).bind(projectId, task.key, doneAt).run();
  return { written: Number(result.meta?.changes || 0) };
}

export function fitToday<T extends { today: unknown[]; pool: unknown[]; done: unknown[] }>(value: T, budget: number) {
  const result = { ...value, today: [...value.today], pool: [...value.pool], done: [...value.done] } as T & { truncated?: string[] };
  const truncated = new Set<string>();
  while (jsonBytes(result) > budget) {
    const key = (["today", "pool", "done"] as const)
      .filter(name => result[name].length > 0)
      .sort((a, b) => result[b].length - result[a].length)[0];
    if (!key) break;
    result[key].pop();
    truncated.add(key);
    result.truncated = [...truncated];
  }
  return result;
}

export async function pickAgentToday(env: Env, refs: TodayTaskRef[], now = new Date()) {
  let written = 0;
  for (const target of refs) written += (await pickToday(env, target.project, target.key, "agent", now)).written;
  return { written };
}

export { ref as todayRef };
