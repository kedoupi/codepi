import {
  AppError,
  MAX_PAGE_BYTES,
  escapeLike,
  fitPage,
  isoNow,
  parseTags,
  ulid,
} from "./lib";
import type {
  ImportView,
  MemoryFilters,
  MemoryKind,
  MemoryStatus,
  MemoryView,
  Overview,
  Page,
  ProfileProposalView,
  ProfileView,
  ProposalStatus,
  TimelineDetail,
  TimelineFilters,
  TimelineKind,
  TimelineStatus,
  TimelineView,
} from "./models";
import type { Env } from "./types";
import { IMPORT_SESSION_TOTALS } from "./imports";

const DATA_PAGE_BYTES = MAX_PAGE_BYTES - 512;

type MemoryRow = {
  id: string;
  status: MemoryStatus;
  kind: MemoryKind;
  text: string;
  tags: string;
  source_client: string;
  source_name: string | null;
  import_id: string | null;
  import_item_index: number | null;
  created_at: string;
  updated_at: string;
  reviewed_at: string | null;
};

type TimelineRow = Omit<TimelineView, "body_excerpt" | "kind" | "status"> & {
  kind: TimelineKind;
  status: TimelineStatus;
  body_excerpt: string;
};

type ProfileRow = ProfileView;

function memoryView(row: MemoryRow): MemoryView {
  return { ...row, tags: parseTags(row.tags) };
}

export async function listMemories(
  env: Env,
  filters: MemoryFilters,
  limit: number,
  offset = 0,
): Promise<Page<MemoryView>> {
  const where: string[] = [];
  const params: unknown[] = [];
  if (filters.status) {
    where.push("m.status = ?");
    params.push(filters.status);
  }
  if (filters.kind) {
    where.push("m.kind = ?");
    params.push(filters.kind);
  }
  if (filters.source) {
    where.push("m.source_client = ?");
    params.push(filters.source);
  }
  if (filters.query) {
    const pattern = `%${escapeLike(filters.query)}%`;
    where.push(`(m.text LIKE ? ESCAPE '\\' OR EXISTS (
      SELECT 1 FROM json_each(m.tags) j WHERE j.value LIKE ? ESCAPE '\\'
    ))`);
    params.push(pattern, pattern);
  }
  for (const tag of filters.tags ?? []) {
    where.push("EXISTS (SELECT 1 FROM json_each(m.tags) j WHERE j.value = ?)");
    params.push(tag);
  }
  if (filters.status === "pending" && filters.reviewableOnly) {
    where.push("(m.import_id IS NULL OR EXISTS (SELECT 1 FROM imports i WHERE i.id = m.import_id))");
  }
  const clause = where.length ? `WHERE ${where.join(" AND ")}` : "";
  const rows = await env.DB.prepare(`SELECT m.id,m.status,m.kind,m.text,m.tags,m.source_client,
      m.source_name,m.import_id,m.import_item_index,m.created_at,m.updated_at,m.reviewed_at
    FROM memories m ${clause}
    ORDER BY m.updated_at DESC, m.id DESC
    LIMIT ? OFFSET ?`)
    .bind(...params, limit + 1, offset)
    .all<MemoryRow>();
  const page = fitPage(rows.results.map(memoryView), limit, offset,
    DATA_PAGE_BYTES);
  return page;
}

export async function createPendingMemory(
  env: Env,
  input: {
    text: string;
    kind: MemoryKind;
    tags: string[];
    sourceClient: string;
    sourceName: string | null;
    importId?: string;
    importItemIndex?: number;
  },
): Promise<MemoryView> {
  const id = ulid();
  const now = isoNow();
  const tags = JSON.stringify(input.tags);
  await env.DB.prepare(`INSERT INTO memories
    (id,status,kind,text,tags,source_client,source_name,import_id,import_item_index,created_at,updated_at,reviewed_at)
    VALUES (?, 'pending', ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)`)
    .bind(id, input.kind, input.text, tags, input.sourceClient, input.sourceName,
      input.importId ?? null, input.importItemIndex ?? null, now, now)
    .run();
  return {
    id,
    status: "pending",
    kind: input.kind,
    text: input.text,
    tags: input.tags,
    source_client: input.sourceClient,
    source_name: input.sourceName,
    import_id: input.importId ?? null,
    import_item_index: input.importItemIndex ?? null,
    created_at: now,
    updated_at: now,
    reviewed_at: null,
  };
}

export async function reviewMemory(
  env: Env,
  id: string,
  action: "approve" | "edit_approve" | "reject",
  edit?: { text: string; kind: MemoryKind; tags: string[] },
): Promise<MemoryView | null> {
  const now = isoNow();
  const reviewable = "AND (import_id IS NULL OR EXISTS (SELECT 1 FROM imports i WHERE i.id = memories.import_id))";
  const row = action === "edit_approve" && edit
    ? await env.DB.prepare(`UPDATE memories
        SET status='active',text=?,kind=?,tags=?,updated_at=?,reviewed_at=?
        WHERE id=? AND status='pending' ${reviewable}
        RETURNING *`)
      .bind(edit.text, edit.kind, JSON.stringify(edit.tags), now, now, id)
      .first<MemoryRow>()
    : await env.DB.prepare(`UPDATE memories
        SET status=?,updated_at=?,reviewed_at=?
        WHERE id=? AND status='pending' ${reviewable}
        RETURNING *`)
      .bind(action === "approve" ? "active" : "rejected", now, now, id)
      .first<MemoryRow>();
  return row ? memoryView(row) : null;
}

export async function editActiveMemory(
  env: Env,
  id: string,
  edit: { text: string; kind: MemoryKind; tags: string[] },
): Promise<MemoryView | null> {
  const row = await env.DB.prepare(`UPDATE memories
    SET text=?,kind=?,tags=?,updated_at=?
    WHERE id=? AND status='active'
    RETURNING *`)
    .bind(edit.text, edit.kind, JSON.stringify(edit.tags), isoNow(), id)
    .first<MemoryRow>();
  return row ? memoryView(row) : null;
}

export async function archiveActiveMemory(env: Env, id: string): Promise<MemoryView | null> {
  const row = await env.DB.prepare(`UPDATE memories
    SET status='archived',updated_at=?
    WHERE id=? AND status='active'
    RETURNING *`)
    .bind(isoNow(), id)
    .first<MemoryRow>();
  return row ? memoryView(row) : null;
}

export async function reviewImportMemories(
  env: Env,
  importId: string,
  action: "approve" | "reject",
): Promise<number> {
  const finished = await env.DB.prepare("SELECT id FROM imports WHERE id=?").bind(importId).first();
  if (!finished) throw new AppError("import_not_finished", 409);
  const now = isoNow();
  const result = await env.DB.prepare(`UPDATE memories
    SET status=?,updated_at=?,reviewed_at=?
    WHERE import_id=? AND status='pending'
      AND EXISTS (SELECT 1 FROM imports i WHERE i.id = memories.import_id)`)
    .bind(action === "approve" ? "active" : "rejected", now, now, importId)
    .run();
  return Number(result.meta.changes ?? 0);
}

export async function listTimeline(
  env: Env,
  filters: TimelineFilters,
  limit: number,
  offset = 0,
): Promise<Page<TimelineView>> {
  const where: string[] = [];
  const params: unknown[] = [];
  if (filters.status) {
    where.push("status = ?");
    params.push(filters.status);
  }
  if (filters.kind) {
    where.push("kind = ?");
    params.push(filters.kind);
  }
  if (filters.query) {
    const pattern = `%${escapeLike(filters.query)}%`;
    where.push("(title LIKE ? ESCAPE '\\' OR org LIKE ? ESCAPE '\\' OR body LIKE ? ESCAPE '\\')");
    params.push(pattern, pattern, pattern);
  }
  if (filters.from) {
    where.push(`CASE WHEN ended_on IS NULL THEN '9999-12-31'
      WHEN length(ended_on)=4 THEN ended_on || '-12-31'
      WHEN length(ended_on)=7 THEN date(ended_on || '-01','+1 month','-1 day')
      ELSE ended_on END >= ?`);
    params.push(filters.from);
  }
  if (filters.to) {
    where.push("COALESCE(started_on, ended_on, '') <= ?");
    params.push(filters.to);
  }
  const clause = where.length ? `WHERE ${where.join(" AND ")}` : "";
  const rows = await env.DB.prepare(`SELECT id,status,kind,title,org,started_on,ended_on,
      substr(COALESCE(body, ''), 1, 500) AS body_excerpt,
      source_client,source_name,created_at,updated_at,reviewed_at
    FROM timeline ${clause}
    ORDER BY COALESCE(started_on, '') DESC, updated_at DESC, id DESC
    LIMIT ? OFFSET ?`)
    .bind(...params, limit + 1, offset)
    .all<TimelineRow>();
  return fitPage(rows.results, limit, offset,
    DATA_PAGE_BYTES);
}

export async function timelineDetail(env: Env, id: string): Promise<TimelineDetail | null> {
  const row = await env.DB.prepare(`SELECT id,status,kind,title,org,started_on,ended_on,body,
      source_client,source_name,created_at,updated_at,reviewed_at
    FROM timeline WHERE id=?`).bind(id).first<Omit<TimelineDetail, "kind" | "status"> & {
      kind: TimelineKind;
      status: TimelineStatus;
    }>();
  return row ?? null;
}

export type TimelineInput = {
  kind: TimelineKind;
  title: string;
  org: string | null;
  startedOn: string | null;
  endedOn: string | null;
  body: string | null;
};

export async function createTimeline(
  env: Env,
  input: TimelineInput,
  status: "active" | "pending",
  sourceClient: string,
  sourceName: string | null,
): Promise<string> {
  const id = ulid();
  const now = isoNow();
  await env.DB.prepare(`INSERT INTO timeline
    (id,status,kind,title,org,started_on,ended_on,body,source_client,source_name,created_at,updated_at,reviewed_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,NULL)`)
    .bind(id, status, input.kind, input.title, input.org, input.startedOn, input.endedOn,
      input.body, sourceClient, sourceName, now, now)
    .run();
  return id;
}

export async function reviewTimeline(
  env: Env,
  id: string,
  action: "approve" | "edit_approve" | "reject",
  edit?: TimelineInput,
): Promise<boolean> {
  const now = isoNow();
  const statement = action === "edit_approve" && edit
    ? env.DB.prepare(`UPDATE timeline
        SET status='active',kind=?,title=?,org=?,started_on=?,ended_on=?,body=?,updated_at=?,reviewed_at=?
        WHERE id=? AND status='pending'`)
      .bind(edit.kind, edit.title, edit.org, edit.startedOn, edit.endedOn, edit.body, now, now, id)
    : env.DB.prepare(`UPDATE timeline SET status=?,updated_at=?,reviewed_at=?
        WHERE id=? AND status='pending'`)
      .bind(action === "approve" ? "active" : "rejected", now, now, id);
  const result = await statement.run();
  return Number(result.meta.changes ?? 0) === 1;
}

export async function editActiveTimeline(env: Env, id: string, input: TimelineInput): Promise<boolean> {
  const result = await env.DB.prepare(`UPDATE timeline
    SET kind=?,title=?,org=?,started_on=?,ended_on=?,body=?,updated_at=?
    WHERE id=? AND status='active'`)
    .bind(input.kind, input.title, input.org, input.startedOn, input.endedOn, input.body, isoNow(), id)
    .run();
  return Number(result.meta.changes ?? 0) === 1;
}

export async function archiveActiveTimeline(env: Env, id: string): Promise<boolean> {
  const result = await env.DB.prepare(`UPDATE timeline
    SET status='archived',updated_at=?
    WHERE id=? AND status='active'`)
    .bind(isoNow(), id)
    .run();
  return Number(result.meta.changes ?? 0) === 1;
}

export async function listProfile(
  env: Env,
  limit: number,
  offset = 0,
): Promise<Page<ProfileRow>> {
  const rows = await env.DB.prepare(`SELECT key,value,updated_at,updated_by FROM profile
    ORDER BY key LIMIT ? OFFSET ?`).bind(limit + 1, offset).all<ProfileRow>();
  return fitPage(rows.results, limit, offset,
    DATA_PAGE_BYTES);
}

export async function upsertProfile(
  env: Env,
  key: string,
  value: string,
  updatedBy = "board",
): Promise<ProfileView> {
  const now = isoNow();
  await env.DB.prepare(`INSERT INTO profile (key,value,updated_at,updated_by)
    VALUES (?,?,?,?)
    ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at,updated_by=excluded.updated_by`)
    .bind(key, value, now, updatedBy)
    .run();
  return { key, value, updated_at: now, updated_by: updatedBy };
}

export async function deleteProfile(env: Env, key: string): Promise<boolean> {
  const result = await env.DB.prepare("DELETE FROM profile WHERE key=?").bind(key).run();
  return Number(result.meta.changes ?? 0) === 1;
}

export async function createProfileProposal(
  env: Env,
  key: string,
  value: string,
  sourceClient: string,
  sourceName: string | null,
): Promise<string> {
  const id = ulid();
  const now = isoNow();
  await env.DB.prepare(`INSERT INTO profile_proposals
    (id,key,value,status,source_client,source_name,created_at,updated_at,reviewed_at)
    VALUES (?,?,?,'pending',?,?,?,?,NULL)`)
    .bind(id, key, value, sourceClient, sourceName, now, now)
    .run();
  return id;
}

export async function listProfileProposals(
  env: Env,
  status: ProposalStatus,
  limit: number,
  offset = 0,
): Promise<Page<ProfileProposalView>> {
  const rows = await env.DB.prepare(`SELECT id,key,value,status,source_client,source_name,
      created_at,updated_at,reviewed_at
    FROM profile_proposals WHERE status=?
    ORDER BY updated_at DESC,id DESC LIMIT ? OFFSET ?`)
    .bind(status, limit + 1, offset)
    .all<ProfileProposalView>();
  return fitPage(rows.results, limit, offset,
    DATA_PAGE_BYTES);
}

export async function reviewProfileProposal(
  env: Env,
  id: string,
  action: "approve" | "edit_approve" | "reject",
  value?: string,
): Promise<boolean> {
  const now = isoNow();
  if (action === "reject") {
    const result = await env.DB.prepare(`UPDATE profile_proposals
      SET status='rejected',updated_at=?,reviewed_at=?
      WHERE id=? AND status='pending'`).bind(now, now, id).run();
    return Number(result.meta.changes ?? 0) === 1;
  }
  const write = action === "edit_approve"
    ? env.DB.prepare(`INSERT INTO profile (key,value,updated_at,updated_by)
        SELECT key,?,?,'board' FROM profile_proposals WHERE id=? AND status='pending'
        ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at,updated_by='board'`)
      .bind(value ?? null, now, id)
    : env.DB.prepare(`INSERT INTO profile (key,value,updated_at,updated_by)
        SELECT key,value,?,'board' FROM profile_proposals WHERE id=? AND status='pending'
        ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at,updated_by='board'`)
      .bind(now, id);
  const results = await env.DB.batch([
    write,
    env.DB.prepare(`UPDATE profile_proposals SET status='approved',updated_at=?,reviewed_at=?
      WHERE id=? AND status='pending'`).bind(now, now, id),
  ]);
  return Number(results[0]?.meta.changes ?? 0) === 1;
}

export async function profileProposal(env: Env, id: string): Promise<ProfileProposalView | null> {
  return env.DB.prepare(`SELECT id,key,value,status,source_client,source_name,
      created_at,updated_at,reviewed_at FROM profile_proposals WHERE id=?`)
    .bind(id).first<ProfileProposalView>();
}

export async function listImports(
  env: Env,
  limit: number,
  offset = 0,
): Promise<Page<ImportView>> {
  const rows = await env.DB.prepare(`SELECT s.id,s.status,s.source_client,s.source_name,
      ${IMPORT_SESSION_TOTALS},
      s.created_at,s.updated_at,s.finished_at,s.error_code,
      (SELECT COUNT(*) FROM memories m WHERE m.import_id=s.id AND m.status='active') AS approved_count,
      (SELECT COUNT(*) FROM memories m WHERE m.import_id=s.id AND m.status='pending') AS pending_count,
      (SELECT COUNT(*) FROM memories m WHERE m.import_id=s.id AND m.status='rejected') AS memory_rejected_count
    FROM import_sessions s
    ORDER BY s.created_at DESC,s.id DESC LIMIT ? OFFSET ?`)
    .bind(limit + 1, offset)
    .all<ImportView>();
  return fitPage(rows.results, limit, offset,
    DATA_PAGE_BYTES);
}

export async function overview(env: Env): Promise<Overview> {
  const row = await env.DB.prepare(`SELECT
      (SELECT COUNT(*) FROM memories m WHERE m.status='pending'
        AND (m.import_id IS NULL OR EXISTS (SELECT 1 FROM imports i WHERE i.id=m.import_id))) AS pending_memories,
      (SELECT COUNT(*) FROM memories WHERE status='active') AS active_memories,
      (SELECT COUNT(*) FROM timeline WHERE status='pending') AS pending_timeline,
      (SELECT COUNT(*) FROM profile_proposals WHERE status='pending') AS pending_profile,
      (SELECT COUNT(*) FROM import_sessions WHERE status='open') AS open_imports,
      (SELECT COUNT(*) FROM import_sessions WHERE status='finished') AS finished_imports`).first<Overview>();
  return row ?? {
    pending_memories: 0,
    active_memories: 0,
    pending_timeline: 0,
    pending_profile: 0,
    open_imports: 0,
    finished_imports: 0,
  };
}

