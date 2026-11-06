import { AppError, jsonBytes, text, today } from "./lib";
import { resolveProject } from "./projects";
import type { Env, NeedKind, TaskBrief, TaskRow } from "./types";

export type TodayWho = "you" | "agent";

export interface AgentChecks {
  count: number;
  last_at: string;
  last_note: string;
  today: boolean;
}

export interface TodayItem extends TaskBrief {
  carried: boolean;
  who: TodayWho;
  checks?: AgentChecks;
}

interface TodayRow extends TaskRow {
  picked_day: string | null;
  picked_by: "owner" | "agent" | null;
  removed_day: string | null;
  owner_done_at: string | null;
  owner_deleted_at: string | null;
  check_count: number;
  last_checked_at: string | null;
  last_checked_note: string | null;
  checked_today: number;
}

export interface DeletedItem {
  project: string;
  key: string;
  title: string;
  deleted_at: string;
}

interface TodayTaskRef {
  project: string;
  key: string;
}

export interface AgentTodayRef extends TodayTaskRef {
  note: string;
}

function agentRef(value: AgentTodayRef): AgentTodayRef {
  const target = ref(value.project, value.key);
  return { ...target, note: text(value.note, "invalid_note", { min: 1, max: 200 })! };
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

function checkInfo(row: TodayRow): AgentChecks | undefined {
  if (!row.check_count || !row.last_checked_at || !row.last_checked_note) return undefined;
  return {
    count: Number(row.check_count),
    last_at: row.last_checked_at,
    last_note: row.last_checked_note,
    today: Boolean(row.checked_today),
  };
}

function item(row: TodayRow, day: string): TodayItem {
  const checks = checkInfo(row);
  return { ...brief(row), carried: row.picked_day !== null && row.picked_day < day, who: who(row.need_kind), ...(checks ? { checks } : {}) };
}

function poolItem(row: TodayRow): TaskBrief & { checks?: AgentChecks } {
  const checks = checkInfo(row);
  return { ...brief(row), ...(checks ? { checks } : {}) };
}

async function rowsForToday(env: Env, projectId: string | undefined, day: string): Promise<TodayRow[]> {
  const scope = projectId ? "t.project_id=?" : "p.status<>'archived'";
  return (await env.DB.prepare(`WITH checks AS (
      SELECT project_id, task_key, COUNT(*) AS check_count, MAX(checked_at) AS last_checked_at,
        MAX(CASE WHEN checked_day=? THEN 1 ELSE 0 END) AS checked_today
      FROM agent_checked GROUP BY project_id, task_key
    )
    SELECT t.*, tp.picked_day, tp.picked_by, tp.removed_day,
      od.done_at AS owner_done_at, ox.deleted_at AS owner_deleted_at,
      c.check_count, c.last_checked_at,
      (SELECT note FROM agent_checked ac
        WHERE ac.project_id=t.project_id AND ac.task_key=t.key
        ORDER BY ac.checked_at DESC LIMIT 1) AS last_checked_note,
      c.checked_today
    FROM tasks t JOIN projects p ON p.id=t.project_id
    LEFT JOIN today_picks tp ON tp.project_id=t.project_id AND tp.task_key=t.key
    LEFT JOIN owner_done od ON od.project_id=t.project_id AND od.task_key=t.key
    LEFT JOIN owner_deleted ox ON ox.project_id=t.project_id AND ox.task_key=t.key
    LEFT JOIN checks c ON c.project_id=t.project_id AND c.task_key=t.key
    WHERE ${scope}
    ORDER BY t.project_id, t.position, t.key`).bind(day, ...(projectId ? [projectId] : [])).all<TodayRow>()).results;
}

/** Build the owner board for one Beijing calendar day. */
export async function todayView(env: Env, now = new Date(), projectId?: string) {
  const day = today(now);
  const rows = await rowsForToday(env, projectId, day);
  const open = rows.filter(row => !row.done_at && !row.owner_done_at && !row.owner_deleted_at);
  const selected = open.filter(row => row.picked_day !== null && row.removed_day === null);
  const selectedKeys = new Set(selected.map(row => `${row.project_id}\0${row.key}`));
  const pool = open.filter(row => !selectedKeys.has(`${row.project_id}\0${row.key}`));
  const doneKeys = new Set<string>();
  const done = rows.filter(row => {
    if (row.owner_deleted_at) return false;
    const taskDoneToday = row.done_at !== null && today(new Date(row.done_at)) === day;
    const ownerDoneToday = row.owner_done_at !== null && today(new Date(row.owner_done_at)) === day;
    if (!taskDoneToday && !ownerDoneToday) return false;
    const key = `${row.project_id}\0${row.key}`;
    if (doneKeys.has(key)) return false;
    doneKeys.add(key);
    return true;
  });
  const deleted = rows.filter(row => row.owner_deleted_at !== null && row.done_at === null)
    .map(row => ({ project: row.project_id, key: row.key, title: row.title, deleted_at: row.owner_deleted_at! }));
  selected.sort(byDueAndPosition);
  pool.sort(byDueAndPosition);
  done.sort(byDueAndPosition);
  const todayItems = selected.map(row => item(row, day));
  const poolItems = pool.map(row => poolItem(row));
  const doneItems = done.map(row => brief(row));
  return {
    today: todayItems,
    pool: poolItems,
    done: doneItems,
    deleted,
    counts: {
      today: todayItems.length, pool: poolItems.length, done: doneItems.length, deleted: deleted.length,
      checked: poolItems.filter(task => task.checks?.today).length,
    },
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
  if (await env.DB.prepare("SELECT 1 FROM owner_deleted WHERE project_id=? AND task_key=?")
    .bind(projectId, task.key).first()) return { written: 0 };
  const day = today(now);
  const existing = await env.DB.prepare("SELECT picked_by, removed_day FROM today_picks WHERE project_id=? AND task_key=?")
    .bind(projectId, task.key).first<{ picked_by: "owner" | "agent"; removed_day: string | null }>();
  if (pickedBy === "agent" && existing?.removed_day === day) return { written: 0 };
  if (existing?.picked_by === "owner" && pickedBy === "agent") return { written: 0 };
  if (existing?.picked_by === pickedBy && existing.removed_day === null) return { written: 0 };
  const createdAt = now.toISOString().replace(/\.\d{3}Z$/, "Z");
  const conflictWhere = pickedBy === "agent" ? " WHERE today_picks.picked_by <> 'owner'" : "";
  const result = await env.DB.prepare(`INSERT INTO today_picks (project_id, task_key, picked_day, picked_by, removed_day, created_at)
    VALUES (?, ?, ?, ?, NULL, ?)
    ON CONFLICT(project_id, task_key) DO UPDATE SET picked_day=excluded.picked_day,
      picked_by=excluded.picked_by, removed_day=NULL${conflictWhere}`).bind(
        projectId, task.key, day, pickedBy, createdAt).run();
  return { written: Number(result.meta?.changes || 0) };
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

export async function deleteToday(env: Env, project: unknown, key: unknown, now = new Date()) {
  const target = ref(project, key);
  const { projectId, task } = await taskFor(env, target);
  const deleted = await env.DB.prepare("SELECT 1 FROM owner_deleted WHERE project_id=? AND task_key=?")
    .bind(projectId, task.key).first();
  if (deleted) return { written: 0 };
  if (task.done_at) throw new AppError("task_done", 422);
  const ownerDone = await env.DB.prepare("SELECT 1 FROM owner_done WHERE project_id=? AND task_key=?")
    .bind(projectId, task.key).first();
  if (ownerDone) throw new AppError("task_done", 422);
  const picked = await env.DB.prepare("SELECT removed_day FROM today_picks WHERE project_id=? AND task_key=?")
    .bind(projectId, task.key).first<{ removed_day: string | null }>();
  if (picked?.removed_day === null) throw new AppError("task_in_today", 422, { hint: "请先退回池子" });
  const deletedAt = now.toISOString().replace(/\.\d{3}Z$/, "Z");
  const result = await env.DB.prepare(`INSERT INTO owner_deleted (project_id, task_key, deleted_at)
    VALUES (?, ?, ?) ON CONFLICT(project_id, task_key) DO NOTHING`).bind(projectId, task.key, deletedAt).run();
  return { written: Number(result.meta?.changes || 0) };
}

export function fitToday<T extends { today: unknown[]; pool: unknown[]; done: unknown[]; deleted: unknown[] }>(value: T, budget: number) {
  const result = { ...value, today: [...value.today], pool: [...value.pool], done: [...value.done], deleted: [...value.deleted] } as T & { truncated?: string[] };
  const truncated = new Set<string>();
  while (jsonBytes(result) > budget) {
    const key = (["pool", "done", "deleted", "today"] as const).find(name => result[name].length > 0);
    if (!key) break;
    result[key].pop();
    truncated.add(key);
    result.truncated = [...truncated];
  }
  return result;
}

async function validateAgentRefs(env: Env, refs: TodayTaskRef[]) {
  const rows = await env.DB.prepare(`WITH requested AS (
      SELECT json_extract(value,'$.project') AS project_ref,
        json_extract(value,'$.key') AS requested_key
      FROM json_each(?)
    )
    SELECT r.project_ref, r.requested_key, p.id AS project_id, t.key AS found_key
    FROM requested r
    LEFT JOIN projects p ON p.id=r.project_ref OR lower(p.repo)=lower(r.project_ref)
    LEFT JOIN tasks t ON t.project_id=p.id AND t.key=r.requested_key`).bind(JSON.stringify(refs)).all<{
      project_ref: string;
      requested_key: string;
      project_id: string | null;
      found_key: string | null;
    }>();
  if (rows.results.length !== refs.length || rows.results.some(row => !row.project_id || !row.found_key)) {
    throw new AppError("task_not_found", 404);
  }
  return rows.results.map(row => ({ project_id: row.project_id!, key: row.found_key! }));
}

export async function pickAgentToday(env: Env, refs: TodayTaskRef[], now = new Date()) {
  const targets = await validateAgentRefs(env, refs);
  if (!targets.length) return { written: 0 };
  const day = today(now);
  const createdAt = now.toISOString().replace(/\.\d{3}Z$/, "Z");
  const result = await env.DB.prepare(`INSERT INTO today_picks
      (project_id, task_key, picked_day, picked_by, removed_day, created_at)
    SELECT json_extract(value,'$.project_id'), json_extract(value,'$.key'), ?, 'agent', NULL, ?
    FROM json_each(?)
    WHERE EXISTS (
      SELECT 1 FROM tasks t
      WHERE t.project_id=json_extract(value,'$.project_id')
        AND t.key=json_extract(value,'$.key') AND t.done_at IS NULL
    ) AND NOT EXISTS (
      SELECT 1 FROM owner_done d
      WHERE d.project_id=json_extract(value,'$.project_id')
        AND d.task_key=json_extract(value,'$.key')
    ) AND NOT EXISTS (
      SELECT 1 FROM owner_deleted x
      WHERE x.project_id=json_extract(value,'$.project_id')
        AND x.task_key=json_extract(value,'$.key')
    )
    ON CONFLICT(project_id, task_key) DO UPDATE SET picked_day=excluded.picked_day,
      picked_by=excluded.picked_by, removed_day=NULL
    WHERE today_picks.picked_by <> 'owner'
      AND ((today_picks.removed_day IS NULL AND today_picks.picked_by <> 'agent')
        OR (today_picks.removed_day IS NOT NULL AND today_picks.removed_day <> ?))`).bind(
          day, createdAt, JSON.stringify(targets), day).run();
  return { written: Number(result.meta?.changes || 0) };
}

export async function checkAgentToday(env: Env, refs: AgentTodayRef[], now = new Date()) {
  const cleanRefs = refs.map(agentRef);
  const targets = await validateAgentRefs(env, cleanRefs);
  if (!targets.length) return { written: 0, skipped: 0 };
  const targetRows = targets.map((target, index) => ({ ...target, note: cleanRefs[index].note }));
  const statuses = await env.DB.prepare(`SELECT json_extract(value,'$.project_id') AS project_id,
      json_extract(value,'$.key') AS task_key, t.done_at,
      od.done_at AS owner_done_at, ox.deleted_at AS owner_deleted_at
    FROM json_each(?) v
    JOIN tasks t ON t.project_id=json_extract(v.value,'$.project_id')
      AND t.key=json_extract(v.value,'$.key')
    LEFT JOIN owner_done od ON od.project_id=t.project_id AND od.task_key=t.key
    LEFT JOIN owner_deleted ox ON ox.project_id=t.project_id AND ox.task_key=t.key`).bind(JSON.stringify(targetRows)).all<{
      project_id: string;
      task_key: string;
      done_at: string | null;
      owner_done_at: string | null;
      owner_deleted_at: string | null;
    }>();
  const skipped = statuses.results.filter(row => row.done_at || row.owner_done_at || row.owner_deleted_at).length;
  const eligible = targetRows.filter(target => !statuses.results.some(row =>
    row.project_id === target.project_id && row.task_key === target.key &&
    (row.done_at || row.owner_done_at || row.owner_deleted_at)));
  if (!eligible.length) return { written: 0, skipped };
  const day = today(now);
  const checkedAt = now.toISOString().replace(/\.\d{3}Z$/, "Z");
  const result = await env.DB.prepare(`INSERT INTO agent_checked
      (project_id, task_key, checked_day, note, checked_at)
    SELECT json_extract(value,'$.project_id'), json_extract(value,'$.key'), ?,
      json_extract(value,'$.note'), ? FROM json_each(?) WHERE true
    ON CONFLICT(project_id, task_key, checked_day) DO UPDATE SET note=excluded.note, checked_at=excluded.checked_at`)
    .bind(day, checkedAt, JSON.stringify(eligible)).run();
  await env.DB.prepare(`UPDATE today_picks SET removed_day=?
    WHERE removed_day IS NULL AND EXISTS (
      SELECT 1 FROM json_each(?) v
      WHERE today_picks.project_id=json_extract(v.value,'$.project_id')
        AND today_picks.task_key=json_extract(v.value,'$.key')
    )`).bind(day, JSON.stringify(eligible)).run();
  return { written: Number(result.meta?.changes || 0), skipped };
}

export { ref as todayRef };
