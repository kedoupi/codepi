import { addDays, AppError, today } from "./lib";
import { resolveProject } from "./projects";
import type { ChangelogRow, Env, TaskRow } from "./types";

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const MAX_ROWS = 500;

export interface JournalCard {
  project: string;
  title: string;
  summary: string | null;
  at: string | null;
}

export interface JournalCheck extends JournalCard {
  note: string;
}

export interface JournalDay {
  date: string;
  count: number;
  counts: { completed: number; changed: number };
  released: JournalCard[];
  completed: JournalCard[];
  checked: JournalCheck[];
  other: JournalCard[];
}

export interface JournalResult {
  as_of: string;
  week: { start: string; end: string };
  summary: { completed: number; released: number; checked: number };
  days: JournalDay[];
  truncated: boolean;
}

type ChangeRow = ChangelogRow & { project_name: string };
type CheckRow = { project_id: string; task_key: string; checked_day: string; note: string; checked_at: string; title: string; project_name: string };

function monday(day: string) {
  const date = new Date(`${day}T00:00:00Z`);
  const offset = (date.getUTCDay() + 6) % 7;
  return addDays(day, -offset);
}

function utcStart(day: string) {
  return new Date(`${day}T00:00:00+08:00`).toISOString();
}

function normalize(value: string, project?: { id: string; name: string }) {
  let title = value.trim();
  if (project) {
    const prefix = [project.name, project.id]
      .filter(Boolean)
      .map(item => item.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
      .join("|");
    if (prefix) title = title.replace(new RegExp(`^\\s*(?:${prefix})(?:\\s*[:：\\-—|/]\\s*|\\s+)`, "iu"), "");
  }
  return title.toLocaleLowerCase().replace(/[\p{P}\p{S}\s]+/gu, "");
}

function release(title: string) {
  return /上线|发布|部署/u.test(title);
}

function card(project: string, title: string, summary: string | null, at: string | null): JournalCard {
  return { project, title, summary, at };
}

function dedupeChanges(rows: ChangeRow[], projects: Map<string, { id: string; name: string }>, releases: boolean) {
  const result: JournalCard[] = [];
  const seen = new Map<string, number>();
  for (const row of rows) {
    const key = normalize(row.title, projects.get(row.project_id));
    if (!key) continue;
    if (!releases) {
      const same = `${row.project_id}\0${key}`;
      if (seen.has(same)) continue;
      seen.set(same, result.length);
      result.push(card(row.project_id, row.title, row.summary, null));
      continue;
    }
    const exact = result.findIndex(item => normalize(item.title, projects.get(item.project)) === key);
    if (exact >= 0) continue;
    const contained = key.length >= 6 || result.some(item => normalize(item.title, projects.get(item.project)).length >= 6)
      ? result.findIndex(item => {
        const other = normalize(item.title, projects.get(item.project));
        return Math.min(key.length, other.length) >= 6 && (key.includes(other) || other.includes(key));
      })
      : -1;
    if (contained >= 0) continue;
    result.push(card(row.project_id, row.title, row.summary, null));
  }
  return result;
}

export async function journal(env: Env, week?: string, projectRef?: string, now = new Date()): Promise<JournalResult> {
  const requested = week ?? today(now);
  if (!DATE.test(requested)) throw new AppError("invalid_arguments", 400);
  const start = monday(requested);
  const end = addDays(start, 6);
  const after = addDays(end, 1);
  const project = projectRef ? await resolveProject(env, projectRef) : null;
  const scope = (alias: string) => project ? `${alias}.project_id=?` : "p.status<>'archived'";
  const projectParams = project ? [project.id] : [];
  const [projectRows, changes, tasks, ownerDone, checks] = await Promise.all([
    env.DB.prepare(`SELECT id, name FROM projects ${project ? "WHERE id=?" : "WHERE status<>'archived'"}`)
      .bind(...(project ? [project.id] : [])).all<{ id: string; name: string }>(),
    env.DB.prepare(`SELECT c.*, p.name AS project_name FROM changelog_entries c JOIN projects p ON p.id=c.project_id
      WHERE ${scope("c")} AND c.date>=? AND c.date<=? ORDER BY c.date, c.project_id, c.position LIMIT ?`)
      .bind(...projectParams, start, end, MAX_ROWS + 1).all<ChangeRow>(),
    env.DB.prepare(`SELECT t.*, p.name AS project_name FROM tasks t JOIN projects p ON p.id=t.project_id
      WHERE ${scope("t")} AND t.done_at IS NOT NULL AND t.done_at>=? AND t.done_at<?
      ORDER BY t.done_at, t.project_id, t.position LIMIT ?`)
      .bind(...projectParams, utcStart(start), utcStart(after), MAX_ROWS + 1).all<TaskRow & { project_name: string }>(),
    env.DB.prepare(`SELECT od.project_id, od.task_key, od.done_at FROM owner_done od JOIN projects p ON p.id=od.project_id
      WHERE ${scope("od")} AND od.done_at>=? AND od.done_at<?
      ORDER BY od.done_at, od.project_id, od.task_key LIMIT ?`)
      .bind(...projectParams, utcStart(start), utcStart(after), MAX_ROWS + 1).all<{ project_id: string; task_key: string; done_at: string }>(),
    env.DB.prepare(`SELECT ac.*, t.title, p.name AS project_name FROM agent_checked ac
      JOIN projects p ON p.id=ac.project_id LEFT JOIN tasks t ON t.project_id=ac.project_id AND t.key=ac.task_key
      WHERE ${scope("ac")} AND ac.checked_day>=? AND ac.checked_day<=?
      ORDER BY ac.checked_day, ac.project_id, ac.checked_at LIMIT ?`)
      .bind(...projectParams, start, end, MAX_ROWS + 1).all<CheckRow>(),
  ]);
  const changeRows = changes.results.slice(0, MAX_ROWS);
  const taskRows = tasks.results.slice(0, MAX_ROWS);
  const ownerDoneRows = ownerDone.results.slice(0, MAX_ROWS);
  const checkRows = checks.results.slice(0, MAX_ROWS);

  const projectMap = new Map(projectRows.results.map(item => [item.id, item]));
  const deleted = await env.DB.prepare(`SELECT od.project_id, od.task_key FROM owner_deleted od JOIN projects p ON p.id=od.project_id
    WHERE ${scope("od")}`).bind(...projectParams).all<{ project_id: string; task_key: string }>();
  const deletedKeys = new Set(deleted.results.map(item => `${item.project_id}\0${item.task_key}`));
  const done = new Map<string, JournalCard>();
  for (const row of taskRows) {
    const key = `${row.project_id}\0${row.key}`;
    if (deletedKeys.has(key)) continue;
    done.set(key, card(row.project_id, row.title, null, row.done_at));
  }
  for (const row of ownerDoneRows) {
    const key = `${row.project_id}\0${row.task_key}`;
    if (deletedKeys.has(key) || done.has(key)) continue;
    const task = await env.DB.prepare("SELECT title FROM tasks WHERE project_id=? AND key=?").bind(row.project_id, row.task_key).first<{ title: string }>();
    if (task) done.set(key, card(row.project_id, task.title, null, row.done_at));
  }

  const days = new Map<string, JournalDay>();
  for (let index = 0; index < 7; index++) {
    const date = addDays(start, index);
    days.set(date, { date, count: 0, counts: { completed: 0, changed: 0 }, released: [], completed: [], checked: [], other: [] });
  }
  const changesByDay = new Map<string, ChangeRow[]>();
  for (const row of changeRows) {
    const list = changesByDay.get(row.date) ?? [];
    list.push(row);
    changesByDay.set(row.date, list);
  }
  for (const [date, rows] of changesByDay) {
    const day = days.get(date)!;
    const releaseRows = rows.filter(row => release(row.title));
    const otherRows = rows.filter(row => !release(row.title));
    day.released = dedupeChanges(releaseRows, projectMap, true);
    day.other = dedupeChanges(otherRows, projectMap, false);
    day.counts.changed = day.released.length + day.other.length;
  }
  for (const [, item] of done) {
    const date = today(new Date(item.at!));
    const day = days.get(date);
    if (day) day.completed.push(item);
  }
  for (const row of checkRows) {
    const day = days.get(row.checked_day);
    if (!day || !row.title) continue;
    day.checked.push({ project: row.project_id, title: row.title, summary: null, at: row.checked_at, note: row.note });
  }
  for (const day of days.values()) {
    day.counts.completed = day.completed.length;
    day.count = day.counts.completed + day.counts.changed;
  }
  return {
    as_of: now.toISOString(),
    week: { start, end },
    summary: {
      completed: [...days.values()].reduce((sum, day) => sum + day.counts.completed, 0),
      released: [...days.values()].reduce((sum, day) => sum + day.released.length, 0),
      checked: [...days.values()].reduce((sum, day) => sum + day.checked.length, 0),
    },
    days: [...days.values()],
    truncated: changes.results.length > MAX_ROWS || tasks.results.length > MAX_ROWS || ownerDone.results.length > MAX_ROWS || checks.results.length > MAX_ROWS,
  };
}
