import { MCP_LIMITS } from "@kedoupi/shared/mcp/contract";
import { AppError, HANDOFF_NOTICE, jsonBytes, maxIso, object, projectUrl } from "./lib";
import { latestHandoff, latestPerTask, recentHandoffs } from "./handoffs";
import type {
  CardFieldRow,
  CardTaskStatus,
  Env,
  Field,
  ProjectCard,
  ProjectRow,
  RepoEventRow,
  SyncSource,
  SyncStateRow,
  TaskNoteRow,
} from "./types";
import type { Event } from "./types";

const FIELDS = ["goal", "scope", "conventions", "pitfalls"] as const;
const SOURCES: readonly SyncSource[] = ["commits", "pulls", "issues", "agents_md", "tasks"];
const PAGE_FORMAT = "project_card_json_v1" as const;
const encoder = new TextEncoder();
const decoder = new TextDecoder("utf-8", { fatal: true, ignoreBOM: false });

function fieldRow(rows: CardFieldRow[], field: typeof FIELDS[number]): Field {
  const row = rows.find(item => item.field === field);
  if (!row) {
    return { value: null, auto_value: null, source: "none", agents_md_changed: false };
  }
  const value = row.edited_value ?? row.auto_value;
  return {
    value,
    auto_value: row.auto_value,
    source: row.edited_value !== null ? "edited" : row.auto_value !== null ? "agents_md" : "none",
    agents_md_changed: row.edited_value !== null &&
      row.edited_base_sha !== row.auto_sha,
  };
}

function eventOf(row: RepoEventRow): Event {
  return {
    ref: row.ref,
    title: row.title,
    state: row.state,
    author: row.author,
    at: row.merged_at ?? row.happened_at,
    url: row.url,
  };
}

function activeTask(row: TaskNoteRow): ProjectCard["active_tasks"][number] {
  return {
    path: row.path,
    title: row.title,
    status_line: row.status_line,
    status: row.status as CardTaskStatus,
  };
}

export async function buildCard(
  env: Env,
  project: ProjectRow,
  opts: { handoffs?: number; taskId?: string } = {},
): Promise<ProjectCard> {
  const handoffLimit = opts.handoffs ?? 5;
  const fields = (await env.DB.prepare(
    "SELECT * FROM card_fields WHERE project_id=?",
  ).bind(project.id).all<CardFieldRow>()).results;
  const progress = await latestHandoff(env, project.id, opts.taskId);
  const taskProgress = (await latestPerTask(env, project.id))
    .filter(item => opts.taskId === undefined || item.task_id === opts.taskId);
  const handoffs = await recentHandoffs(
    env, project.id, handoffLimit, progress?.id, opts.taskId,
  );
  const commits = (await env.DB.prepare(`SELECT * FROM repo_events
    WHERE project_id=? AND kind='commit' ORDER BY happened_at DESC, ref DESC LIMIT 10`)
    .bind(project.id).all<RepoEventRow>()).results;
  const openPrs = (await env.DB.prepare(`SELECT * FROM repo_events
    WHERE project_id=? AND kind='pr' AND state='open'
    ORDER BY happened_at DESC, ref DESC LIMIT 10`)
    .bind(project.id).all<RepoEventRow>()).results;
  const mergedSince = new Date(Date.now() - 14 * 86400_000).toISOString();
  const mergedPrs = (await env.DB.prepare(`SELECT * FROM repo_events
    WHERE project_id=? AND kind='pr' AND state='merged'
      AND merged_at IS NOT NULL AND merged_at>=?
    ORDER BY merged_at DESC, ref DESC LIMIT 5`)
    .bind(project.id, mergedSince).all<RepoEventRow>()).results;
  const openIssues = (await env.DB.prepare(`SELECT * FROM repo_events
    WHERE project_id=? AND kind='issue' AND state='open'
    ORDER BY happened_at DESC, ref DESC LIMIT 10`)
    .bind(project.id).all<RepoEventRow>()).results;
  const tasks = (await env.DB.prepare(`SELECT * FROM task_notes
    WHERE project_id=? ORDER BY updated_at DESC, path DESC LIMIT 30`)
    .bind(project.id).all<TaskNoteRow>()).results
    .filter(row => row.status !== "done")
    .slice(0, 10);
  const syncRows = (await env.DB.prepare(
    "SELECT * FROM sync_state WHERE project_id=?",
  ).bind(project.id).all<SyncStateRow>()).results;
  const sync = Object.fromEntries(SOURCES.map(source => {
    const row = syncRows.find(item => item.source === source);
    return [source, { last_ok_at: row?.last_ok_at ?? null, error: row?.last_error ?? null }];
  })) as ProjectCard["sync"];
  const asOf = maxIso(
    project.updated_at,
    progress?.at,
    ...syncRows.map(row => row.last_ok_at),
    ...commits.map(row => row.happened_at),
  ) || new Date(0).toISOString();

  return {
    as_of: asOf,
    project: {
      id: project.id,
      repo: project.repo,
      name: project.name,
      status: project.status,
      default_branch: project.default_branch,
      url: projectUrl(env, project.id),
    },
    goal: fieldRow(fields, "goal"),
    scope: fieldRow(fields, "scope"),
    conventions: fieldRow(fields, "conventions"),
    pitfalls: fieldRow(fields, "pitfalls"),
    progress,
    task_progress: taskProgress,
    recent_handoffs: handoffs,
    recent_commits: commits.map(row => ({
      sha: row.ref,
      title: row.title,
      author: row.author,
      at: row.happened_at,
      url: row.url,
    })),
    open_prs: openPrs.map(eventOf),
    recently_merged: mergedPrs.map(eventOf),
    open_issues: openIssues.map(eventOf),
    active_tasks: tasks.map(activeTask),
    sync,
    notice: HANDOFF_NOTICE,
  };
}

function base64UrlEncode(value: string) {
  const bytes = encoder.encode(value);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function base64UrlDecode(value: string) {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/") +
    "=".repeat((4 - value.length % 4) % 4);
  return decoder.decode(Uint8Array.from(atob(padded), char => char.charCodeAt(0)));
}

interface PageCursor {
  v: 1;
  format: typeof PAGE_FORMAT;
  project: string;
  index: number;
  sha256: string;
}

function encodeCursor(projectId: string, index: number, sha256: string) {
  const value: PageCursor = {
    v: 1,
    format: PAGE_FORMAT,
    project: projectId,
    index,
    sha256,
  };
  return base64UrlEncode(JSON.stringify(value));
}

function decodeCursor(projectId: string, value: string): PageCursor {
  try {
    const parsed: unknown = JSON.parse(base64UrlDecode(value));
    if (!object(parsed)) throw new Error("invalid");
    const cursor = parsed as Partial<PageCursor>;
    if (cursor.v !== 1 || cursor.format !== PAGE_FORMAT || cursor.project !== projectId ||
      !Number.isSafeInteger(cursor.index) || (cursor.index ?? -1) < 0 ||
      typeof cursor.sha256 !== "string" || !/^[0-9a-f]{64}$/.test(cursor.sha256)) {
      throw new Error("invalid");
    }
    return cursor as PageCursor;
  } catch {
    throw new AppError("invalid_cursor", 400);
  }
}

async function sha256(value: string) {
  const digest = await crypto.subtle.digest("SHA-256", encoder.encode(value));
  return Array.from(new Uint8Array(digest), byte =>
    byte.toString(16).padStart(2, "0")).join("");
}

function pageWrapper(
  card: ProjectCard,
  projectId: string,
  canonical: string,
  points: string[],
  index: number,
  count: number,
  cursor: string | null,
  digest: string,
) {
  const chunk = points.slice(index, index + count).join("");
  const nextIndex = index + count;
  const complete = nextIndex >= points.length;
  const nextCursor = complete
    ? null
    : encodeCursor(projectId, nextIndex, digest);
  return {
    as_of: card.as_of,
    project: card.project,
    pagination: {
      format: PAGE_FORMAT,
      encoding: "utf-8" as const,
      cursor,
      next_cursor: nextCursor,
      total_bytes: encoder.encode(canonical).byteLength,
      chunk_bytes: encoder.encode(chunk).byteLength,
      chunk,
      complete,
    },
  };
}

export async function projectGetPage(
  card: ProjectCard,
  cursor?: string | null,
): Promise<Record<string, unknown>> {
  const limit = MCP_LIMITS.detail;
  if (jsonBytes(card) <= limit) {
    if (cursor) throw new AppError("cursor_stale", 409);
    return card as unknown as Record<string, unknown>;
  }
  const canonical = JSON.stringify(card);
  const points = Array.from(canonical);
  const digest = await sha256(canonical);
  let index = 0;
  if (cursor) {
    const parsed = decodeCursor(card.project.id, cursor);
    if (parsed.sha256 !== digest) throw new AppError("cursor_stale", 409);
    index = parsed.index;
  }
  if (index >= points.length) throw new AppError("cursor_stale", 409);
  let low = 1;
  let high = points.length - index;
  let best = 1;
  const smallest = pageWrapper(
    card, card.project.id, canonical, points, index, 1, cursor || null, digest,
  );
  if (jsonBytes(smallest) > limit) throw new AppError("page_too_large", 500);
  while (low <= high) {
    const middle = Math.floor((low + high) / 2);
    const candidate = pageWrapper(
      card, card.project.id, canonical, points, index, middle, cursor || null, digest,
    );
    if (jsonBytes(candidate) <= limit) {
      best = middle;
      low = middle + 1;
    } else {
      high = middle - 1;
    }
  }
  return pageWrapper(
    card, card.project.id, canonical, points, index, best, cursor || null, digest,
  ) as unknown as Record<string, unknown>;
}
