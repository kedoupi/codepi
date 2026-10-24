import { extractCard } from "./agents-md";
import { isoOrNull, nowIso } from "./lib";
import { activeProjects } from "./projects";
import type {
  CardTaskStatus,
  Env,
  ProjectRow,
  SyncSource,
  SyncStateRow,
} from "./types";

const API = "https://api.github.com";
const SOURCES: readonly SyncSource[] = ["commits", "pulls", "issues", "agents_md", "tasks"];
const COMMIT_LIMIT = 200;
const PR_LIMIT = 100;
const ISSUE_LIMIT = 100;
const SYNC_COOLDOWN_MS = 60_000;
const SYNC_LEASE_MS = 15 * 60_000;
const SYNC_LEASE_RENEW_BEFORE_MS = 2 * 60_000;

type GitHubFailureCode = "github_forbidden" | "rate_limited" | "github_unavailable" | "github_write_failed";

class SyncFailure extends Error {
  code: GitHubFailureCode;
  checkpoint: string | null | undefined;

  constructor(code: GitHubFailureCode, checkpoint: string | null | undefined = undefined) {
    super(code);
    this.code = code;
    this.checkpoint = checkpoint;
  }
}

export class SyncLeaseLost extends Error {
  constructor() {
    super("sync_lease_lost");
  }
}

/**
 * Every GitHub request and domain write renews or verifies the same durable
 * lease first. If another invocation owns the lease, this run stops before it
 * can fetch further pages or overwrite that owner's checkpoint.
 */
class SyncLeaseGuard {
  constructor(
    private readonly env: Env,
    private readonly projectId: string,
    private readonly leaseId: string,
    private leaseUntilMs: number,
  ) {}

  async assertOwned(): Promise<void> {
    const now = Date.now();
    if (this.leaseUntilMs - now > SYNC_LEASE_RENEW_BEFORE_MS) return;
    const renewedUntil = now + SYNC_LEASE_MS;
    const renewed = await this.env.DB.prepare(`UPDATE sync_leases
      SET lease_until_ms=?
      WHERE project_id=? AND lease_id=? AND lease_until_ms>?
      RETURNING lease_until_ms`).bind(
      renewedUntil,
      this.projectId,
      this.leaseId,
      now,
    ).first<{ lease_until_ms: number }>();
    if (!renewed) throw new SyncLeaseLost();
    this.leaseUntilMs = renewed.lease_until_ms;
  }
}

interface GitHubPage<T> {
  data: T;
  next: string | null;
}

interface GitHubFile {
  name: string;
  path: string;
  sha: string;
  type: string;
  url: string;
}

interface GitHubCommit {
  sha: string;
  html_url: string;
  commit: {
    message: string;
    author?: { name?: string; date?: string } | null;
    committer?: { date?: string } | null;
  };
  author?: { login?: string } | null;
}

interface GitHubPull {
  number: number;
  html_url: string;
  title: string;
  state: string;
  merged_at: string | null;
  updated_at: string;
  user?: { login?: string } | null;
}

interface GitHubIssue {
  number: number;
  html_url: string;
  title: string;
  state: string;
  updated_at: string;
  pull_request?: unknown;
  user?: { login?: string } | null;
}

export interface SyncResult {
  project_id: string;
  attempted_at: string;
  rate_limited: boolean;
  errors: Partial<Record<SyncSource, string>>;
}

function validateApiUrl(value: string): URL {
  const url = new URL(value);
  if (url.protocol !== "https:" || url.hostname !== "api.github.com" ||
    url.username || url.password || url.port || url.hash) {
    throw new SyncFailure("github_unavailable");
  }
  return url;
}

function headers(env: Env, accept: string): Headers {
  if (!env.GITHUB_TOKEN) throw new SyncFailure("github_unavailable");
  return new Headers({
    Authorization: `Bearer ${env.GITHUB_TOKEN}`,
    Accept: accept,
    "X-GitHub-Api-Version": "2022-11-28",
    "User-Agent": "codepi-project",
  });
}

function nextLink(header: string | null): string | null {
  if (!header) return null;
  for (const part of header.split(",")) {
    const match = part.match(/<([^>]+)>\s*;\s*rel="([^"]+)"/);
    if (match?.[2].split(/\s+/).includes("next")) return validateApiUrl(match[1]).href;
  }
  return null;
}

async function githubResponse(
  env: Env,
  value: string,
  accept: string,
  checkpoint: string,
  guard: SyncLeaseGuard,
): Promise<Response> {
  const url = validateApiUrl(value);
  let response: Response;
  await guard.assertOwned();
  try {
    response = await fetch(url.href, {
      headers: headers(env, accept),
      signal: AbortSignal.timeout(8_000),
    });
  } catch {
    throw new SyncFailure("github_unavailable", checkpoint);
  }
  const remaining = response.headers.get("x-ratelimit-remaining");
  if (response.status === 429 || remaining === "0") {
    await response.body?.cancel();
    throw new SyncFailure("rate_limited", checkpoint);
  }
  if ([401, 403, 404].includes(response.status)) {
    await response.body?.cancel();
    throw new SyncFailure("github_forbidden", checkpoint);
  }
  if (!response.ok) {
    await response.body?.cancel();
    throw new SyncFailure("github_unavailable", checkpoint);
  }
  return response;
}

async function page<T>(env: Env, value: string, guard: SyncLeaseGuard): Promise<GitHubPage<T>> {
  const response = await githubResponse(env, value, "application/vnd.github+json", value, guard);
  try {
    return {
      data: await response.json() as T,
      next: nextLink(response.headers.get("link")),
    };
  } catch {
    throw new SyncFailure("github_unavailable", value);
  }
}

async function raw(env: Env, value: string, guard: SyncLeaseGuard): Promise<string> {
  const response = await githubResponse(env, value, "application/vnd.github.raw", value, guard);
  try {
    return await response.text();
  } catch {
    throw new SyncFailure("github_unavailable", value);
  }
}

async function writeInChunks(
  db: D1Database,
  statements: D1PreparedStatement[],
  guard: SyncLeaseGuard,
) {
  for (let index = 0; index < statements.length; index += 50) {
    await guard.assertOwned();
    await db.batch(statements.slice(index, index + 50));
  }
}

function title(value: string) {
  return value.split(/\r?\n/)[0].trim().slice(0, 200) || "(untitled)";
}

function stateFor(state: unknown) {
  return typeof state === "string" && state ? state.slice(0, 40) : null;
}

async function stateOf(env: Env, projectId: string, source: SyncSource) {
  return env.DB.prepare(
    "SELECT * FROM sync_state WHERE project_id=? AND source=?",
  ).bind(projectId, source).first<SyncStateRow>();
}

async function markAttempts(
  env: Env,
  projectId: string,
  at: string,
  guard: SyncLeaseGuard,
) {
  await writeInChunks(env.DB, SOURCES.map(source => env.DB.prepare(`INSERT INTO sync_state
    (project_id,source,last_attempt_at) VALUES (?,?,?)
    ON CONFLICT(project_id,source) DO UPDATE SET last_attempt_at=excluded.last_attempt_at`)
    .bind(projectId, source, at)), guard);
}

async function markSuccess(
  env: Env,
  projectId: string,
  source: SyncSource,
  cursor: string | null,
  at: string,
  guard: SyncLeaseGuard,
) {
  await guard.assertOwned();
  await env.DB.prepare(`UPDATE sync_state
    SET cursor=?, checkpoint=NULL, last_ok_at=?, last_error=NULL
    WHERE project_id=? AND source=?`).bind(cursor, at, projectId, source).run();
}

async function markFailure(
  env: Env,
  projectId: string,
  source: SyncSource,
  code: string,
  checkpoint: string | null | undefined,
  guard: SyncLeaseGuard,
) {
  await guard.assertOwned();
  if (checkpoint === undefined) {
    await env.DB.prepare(`UPDATE sync_state SET last_error=?
      WHERE project_id=? AND source=?`).bind(code, projectId, source).run();
    return;
  }
  await env.DB.prepare(`UPDATE sync_state SET last_error=?, checkpoint=?
    WHERE project_id=? AND source=?`).bind(code, checkpoint, projectId, source).run();
}

function sinceDefault(days: number) {
  return new Date(Date.now() - days * 86400_000).toISOString();
}

async function highestEvent(env: Env, projectId: string, kind: "commit" | "pr" | "issue") {
  const row = await env.DB.prepare(
    "SELECT MAX(happened_at) AS at FROM repo_events WHERE project_id=? AND kind=?",
  ).bind(projectId, kind).first<{ at: string | null }>();
  return row?.at || null;
}

async function trimEvents(
  env: Env,
  projectId: string,
  kind: "commit" | "pr" | "issue",
  limit: number,
  guard: SyncLeaseGuard,
) {
  await guard.assertOwned();
  await env.DB.prepare(`DELETE FROM repo_events WHERE rowid IN (
    SELECT rowid FROM repo_events WHERE project_id=? AND kind=?
    ORDER BY happened_at DESC, ref DESC LIMIT -1 OFFSET ?
  )`).bind(projectId, kind, limit).run();
}

async function syncCommits(
  env: Env,
  project: ProjectRow,
  state: SyncStateRow | null,
  at: string,
  guard: SyncLeaseGuard,
) {
  let url: string | null = state?.checkpoint || `${API}/repos/${project.repo}/commits?` +
    new URLSearchParams({
      sha: project.default_branch,
      since: state?.cursor || sinceDefault(30),
      per_page: "50",
    }).toString();
  let reachedCursor = false;
  while (url && !reachedCursor) {
    let current = url;
    let result: GitHubPage<GitHubCommit[]>;
    try {
      result = await page<GitHubCommit[]>(env, current, guard);
    } catch (error) {
      if (error instanceof SyncLeaseLost) throw error;
      if (error instanceof SyncFailure) throw new SyncFailure(error.code, current);
      throw new SyncFailure("github_unavailable", current);
    }
    if (!Array.isArray(result.data)) throw new SyncFailure("github_unavailable", current);
    const statements: D1PreparedStatement[] = [];
    for (const commit of result.data) {
      const happenedAt = commit.commit.author?.date || commit.commit.committer?.date || at;
      if (state?.cursor && happenedAt <= state.cursor) {
        reachedCursor = true;
        break;
      }
      statements.push(env.DB.prepare(`INSERT INTO repo_events
        (project_id,kind,ref,title,state,author,url,happened_at) VALUES (?,?,?,?,?,?,?,?)
        ON CONFLICT(project_id,kind,ref) DO UPDATE SET title=excluded.title,
          state=excluded.state, author=excluded.author, url=excluded.url,
          happened_at=excluded.happened_at`)
        .bind(project.id, "commit", commit.sha, title(commit.commit.message),
          null, commit.author?.login || commit.commit.author?.name || null,
          commit.html_url, happenedAt));
    }
    await writeInChunks(env.DB, statements, guard);
    url = result.next;
  }
  await trimEvents(env, project.id, "commit", COMMIT_LIMIT, guard);
  const highWater = await highestEvent(env, project.id, "commit");
  const cursor = [state?.cursor, highWater].filter(Boolean).sort().at(-1) || null;
  await markSuccess(env, project.id, "commits", cursor, at, guard);
}

async function syncPulls(
  env: Env,
  project: ProjectRow,
  state: SyncStateRow | null,
  at: string,
  guard: SyncLeaseGuard,
) {
  let url: string | null = state?.checkpoint || `${API}/repos/${project.repo}/pulls?` +
    new URLSearchParams({
      state: "all",
      sort: "updated",
      direction: "desc",
      per_page: "30",
    }).toString();
  let reachedCursor = false;
  while (url && !reachedCursor) {
    const current = url;
    let result: GitHubPage<GitHubPull[]>;
    try {
      result = await page<GitHubPull[]>(env, current, guard);
    } catch (error) {
      if (error instanceof SyncLeaseLost) throw error;
      if (error instanceof SyncFailure) throw new SyncFailure(error.code, current);
      throw new SyncFailure("github_unavailable", current);
    }
    if (!Array.isArray(result.data)) throw new SyncFailure("github_unavailable", current);
    const statements: D1PreparedStatement[] = [];
    for (const pull of result.data) {
      if (state?.cursor && pull.updated_at <= state.cursor) {
        reachedCursor = true;
        break;
      }
      const mergedAt = isoOrNull(pull.merged_at);
      statements.push(env.DB.prepare(`INSERT INTO repo_events
        (project_id,kind,ref,title,state,author,url,happened_at,merged_at)
        VALUES (?,?,?,?,?,?,?,?,?)
        ON CONFLICT(project_id,kind,ref) DO UPDATE SET title=excluded.title,
          state=excluded.state, author=excluded.author, url=excluded.url,
          happened_at=excluded.happened_at, merged_at=excluded.merged_at`)
        .bind(project.id, "pr", String(pull.number), title(pull.title),
          mergedAt ? "merged" : stateFor(pull.state),
          pull.user?.login || null, pull.html_url, pull.updated_at, mergedAt));
    }
    await writeInChunks(env.DB, statements, guard);
    url = result.next;
  }
  await trimEvents(env, project.id, "pr", PR_LIMIT, guard);
  const highWater = await highestEvent(env, project.id, "pr");
  const cursor = [state?.cursor, highWater].filter(Boolean).sort().at(-1) || null;
  await markSuccess(env, project.id, "pulls", cursor, at, guard);
}

async function syncIssues(
  env: Env,
  project: ProjectRow,
  state: SyncStateRow | null,
  at: string,
  guard: SyncLeaseGuard,
) {
  let url: string | null = state?.checkpoint || `${API}/repos/${project.repo}/issues?` +
    new URLSearchParams({
      state: "all",
      since: state?.cursor || sinceDefault(30),
      sort: "updated",
      direction: "desc",
      per_page: "30",
    }).toString();
  let reachedCursor = false;
  while (url && !reachedCursor) {
    const current = url;
    let result: GitHubPage<GitHubIssue[]>;
    try {
      result = await page<GitHubIssue[]>(env, current, guard);
    } catch (error) {
      if (error instanceof SyncLeaseLost) throw error;
      if (error instanceof SyncFailure) throw new SyncFailure(error.code, current);
      throw new SyncFailure("github_unavailable", current);
    }
    if (!Array.isArray(result.data)) throw new SyncFailure("github_unavailable", current);
    const statements: D1PreparedStatement[] = [];
    for (const issue of result.data) {
      if (state?.cursor && issue.updated_at <= state.cursor) {
        reachedCursor = true;
        break;
      }
      if (issue.pull_request) continue;
      statements.push(env.DB.prepare(`INSERT INTO repo_events
        (project_id,kind,ref,title,state,author,url,happened_at) VALUES (?,?,?,?,?,?,?,?)
        ON CONFLICT(project_id,kind,ref) DO UPDATE SET title=excluded.title,
          state=excluded.state, author=excluded.author, url=excluded.url,
          happened_at=excluded.happened_at`)
        .bind(project.id, "issue", String(issue.number), title(issue.title),
          stateFor(issue.state), issue.user?.login || null, issue.html_url, issue.updated_at));
    }
    await writeInChunks(env.DB, statements, guard);
    url = result.next;
  }
  await trimEvents(env, project.id, "issue", ISSUE_LIMIT, guard);
  const highWater = await highestEvent(env, project.id, "issue");
  const cursor = [state?.cursor, highWater].filter(Boolean).sort().at(-1) || null;
  await markSuccess(env, project.id, "issues", cursor, at, guard);
}

async function syncAgents(
  env: Env,
  project: ProjectRow,
  state: SyncStateRow | null,
  at: string,
  guard: SyncLeaseGuard,
) {
  const url = `${API}/repos/${project.repo}/contents/AGENTS.md?ref=${encodeURIComponent(project.default_branch)}`;
  let metadata: GitHubFile;
  try {
    const result = await page<GitHubFile>(env, url, guard);
    metadata = result.data;
  } catch (error) {
    if (error instanceof SyncLeaseLost) throw error;
    if (error instanceof SyncFailure) throw new SyncFailure(error.code, url);
    throw new SyncFailure("github_unavailable", url);
  }
  if (!metadata || typeof metadata.sha !== "string") {
    throw new SyncFailure("github_unavailable", url);
  }
  const same = await env.DB.prepare(
    "SELECT COUNT(*) AS n FROM card_fields WHERE project_id=? AND auto_sha=?",
  ).bind(project.id, metadata.sha).first<{ n: number }>();
  if (metadata.sha === state?.cursor && Number(same?.n || 0) === 4) {
    await markSuccess(env, project.id, "agents_md", metadata.sha, at, guard);
    return;
  }
  const markdown = await raw(env, url, guard);
  const extracted = extractCard(markdown);
  const fields = ["goal", "scope", "conventions", "pitfalls"] as const;
  await writeInChunks(env.DB, fields.map(field => env.DB.prepare(`INSERT INTO card_fields
    (project_id,field,auto_value,auto_sha) VALUES (?,?,?,?)
    ON CONFLICT(project_id,field) DO UPDATE SET
      auto_value=excluded.auto_value, auto_sha=excluded.auto_sha`)
    .bind(project.id, field, extracted[field], metadata.sha)), guard);
  await markSuccess(env, project.id, "agents_md", metadata.sha, at, guard);
}

function taskStatus(line: string | null): CardTaskStatus {
  if (!line) return "unknown";
  const value = line.toLowerCase();
  if (/未完成|not\s+done|incomplete/.test(value)) return "in_progress";
  if (/已完成|已交付|完成|(?:\bdone\b)/.test(value)) return "done";
  if (/blocked|受阻|阻塞|卡住/.test(value)) return "blocked";
  if (/ready_for_review|待审查|待评审|待复核|待验收/.test(value)) return "ready_for_review";
  if (/in_progress|进行中|实施中|开发中|待验证|待续/.test(value)) return "in_progress";
  return "unknown";
}

function taskMetadata(markdown: string, path: string): {
  title: string;
  statusLine: string | null;
  status: CardTaskStatus;
} {
  const heading = markdown.match(/^#\s+(.+)$/m)?.[1]?.trim();
  let statusLine: string | null = null;
  for (const line of markdown.split(/\r?\n/)) {
    const match = line.trim().match(/^[-*]?\s*状态\s*[：:]\s*(.*)$/);
    if (match) {
      statusLine = match[1].trim().slice(0, 200) || null;
      break;
    }
  }
  return {
    title: (heading || path.split("/").at(-1) || path).slice(0, 300),
    statusLine,
    status: taskStatus(statusLine),
  };
}

interface TaskCheckpoint {
  v: 1;
  tree_sha: string;
  pending: string[];
}

function parseTaskCheckpoint(value: string | null | undefined): TaskCheckpoint | null {
  if (!value) return null;
  try {
    const parsed: unknown = JSON.parse(value);
    if (typeof parsed !== "object" || parsed === null) return null;
    const item = parsed as Partial<TaskCheckpoint>;
    return item.v === 1 && typeof item.tree_sha === "string" && Array.isArray(item.pending)
      ? item as TaskCheckpoint
      : null;
  } catch {
    return null;
  }
}

async function syncTasks(
  env: Env,
  project: ProjectRow,
  state: SyncStateRow | null,
  at: string,
  guard: SyncLeaseGuard,
) {
  const url = `${API}/repos/${project.repo}/contents/docs/development/tasks?ref=${encodeURIComponent(project.default_branch)}`;
  let files: GitHubFile[];
  try {
    const result = await page<GitHubFile[]>(env, url, guard);
    if (!Array.isArray(result.data)) throw new SyncFailure("github_unavailable", url);
    files = result.data;
  } catch (error) {
    if (error instanceof SyncLeaseLost) throw error;
    if (error instanceof SyncFailure) throw new SyncFailure(error.code, url);
    throw new SyncFailure("github_unavailable", url);
  }
  const current = files
    .filter(file => file.type === "file" && file.name.endsWith(".md"))
    .sort((a, b) => b.name.localeCompare(a.name, "en"))
    .slice(0, 30);
  const currentPaths = new Set(current.map(file => file.path));
  const existing = (await env.DB.prepare(
    "SELECT path,sha FROM task_notes WHERE project_id=?",
  ).bind(project.id).all<{ path: string; sha: string }>()).results;
  const shas = new Map(existing.map(row => [row.path, row.sha]));
  const directorySha = `tasks:${current.map(file => `${file.path}:${file.sha}`).join("|")}`;
  const checkpoint = parseTaskCheckpoint(state?.checkpoint);
  let pending = checkpoint && checkpoint.tree_sha === directorySha && current.length
    ? checkpoint.pending.filter(path => currentPaths.has(path))
    : current.map(file => file.path);
  if (!pending.length) pending = current.map(file => file.path);

  for (const file of current) {
    if (!pending.includes(file.path)) continue;
    if (shas.get(file.path) === file.sha) {
      pending = pending.filter(path => path !== file.path);
      continue;
    }
    let markdown: string;
    try {
      markdown = await raw(env, file.url, guard);
    } catch (error) {
      if (error instanceof SyncLeaseLost) throw error;
      const saved: TaskCheckpoint = { v: 1, tree_sha: directorySha, pending };
      throw new SyncFailure(
        error instanceof SyncFailure ? error.code : "github_unavailable",
        JSON.stringify(saved),
      );
    }
    const meta = taskMetadata(markdown, file.path);
    await guard.assertOwned();
    await env.DB.prepare(`INSERT INTO task_notes
      (project_id,path,title,status_line,status,sha,updated_at) VALUES (?,?,?,?,?,?,?)
      ON CONFLICT(project_id,path) DO UPDATE SET title=excluded.title,
        status_line=excluded.status_line, status=excluded.status,
        sha=excluded.sha, updated_at=excluded.updated_at`)
      .bind(project.id, file.path, meta.title, meta.statusLine, meta.status, file.sha, at).run();
    pending = pending.filter(path => path !== file.path);
  }

  const stale = existing.filter(row => !currentPaths.has(row.path));
  await writeInChunks(env.DB, stale.map(row => env.DB.prepare(
    "DELETE FROM task_notes WHERE project_id=? AND path=?",
  ).bind(project.id, row.path)), guard);
  await markSuccess(env, project.id, "tasks", directorySha, at, guard);
}

async function runSource(
  env: Env,
  project: ProjectRow,
  source: SyncSource,
  at: string,
  guard: SyncLeaseGuard,
): Promise<void> {
  await guard.assertOwned();
  const state = await stateOf(env, project.id, source);
  try {
    if (source === "commits") await syncCommits(env, project, state, at, guard);
    else if (source === "pulls") await syncPulls(env, project, state, at, guard);
    else if (source === "issues") await syncIssues(env, project, state, at, guard);
    else if (source === "agents_md") await syncAgents(env, project, state, at, guard);
    else await syncTasks(env, project, state, at, guard);
  } catch (error) {
    if (error instanceof SyncLeaseLost) throw error;
    if (error instanceof SyncFailure) {
      await markFailure(env, project.id, source, error.code, error.checkpoint, guard);
      throw error;
    }
    await markFailure(env, project.id, source, "github_write_failed", undefined, guard);
    throw new SyncFailure("github_write_failed");
  }
}

async function syncProjectSources(
  env: Env,
  project: ProjectRow,
  guard: SyncLeaseGuard,
): Promise<SyncResult> {
  const at = nowIso();
  await markAttempts(env, project.id, at, guard);
  const errors: SyncResult["errors"] = {};
  let rateLimited = false;
  for (const source of SOURCES) {
    if (rateLimited) {
      errors[source] = "rate_limited";
      await markFailure(env, project.id, source, "rate_limited", undefined, guard);
      continue;
    }
    try {
      await runSource(env, project, source, at, guard);
    } catch (error) {
      if (error instanceof SyncLeaseLost) throw error;
      const code = error instanceof SyncFailure ? error.code : "github_unavailable";
      errors[source] = code;
      if (code === "rate_limited") rateLimited = true;
    }
  }
  return { project_id: project.id, attempted_at: at, rate_limited: rateLimited, errors };
}

export class SyncTooFrequent extends Error {
  retryAfter: number;

  constructor(retryAfter: number) {
    super("sync_too_frequent");
    this.retryAfter = retryAfter;
  }
}

async function claimSync(
  env: Env,
  projectId: string,
  now: number,
): Promise<{ leaseId: string; leaseUntilMs: number }> {
  const leaseId = crypto.randomUUID();
  const claimed = await env.DB.prepare(`INSERT INTO sync_leases
    (project_id,lease_id,claimed_at_ms,cooldown_until_ms,lease_until_ms)
    VALUES (?,?,?,?,?)
    ON CONFLICT(project_id) DO UPDATE SET
      lease_id=excluded.lease_id,
      claimed_at_ms=excluded.claimed_at_ms,
      cooldown_until_ms=excluded.cooldown_until_ms,
      lease_until_ms=excluded.lease_until_ms
    WHERE lease_until_ms <= excluded.claimed_at_ms
      AND cooldown_until_ms <= excluded.claimed_at_ms
    RETURNING lease_id`)
    .bind(projectId, leaseId, now, now + SYNC_COOLDOWN_MS, now + SYNC_LEASE_MS)
    .first<{ lease_id: string }>();
  if (claimed?.lease_id === leaseId) {
    return { leaseId, leaseUntilMs: now + SYNC_LEASE_MS };
  }

  const row = await env.DB.prepare(`SELECT cooldown_until_ms,lease_until_ms
    FROM sync_leases WHERE project_id=?`).bind(projectId).first<{
      cooldown_until_ms: number;
      lease_until_ms: number;
    }>();
  const retryAt = Math.max(
    now + 1_000,
    row?.cooldown_until_ms ?? 0,
    row?.lease_until_ms ?? 0,
  );
  throw new SyncTooFrequent(Math.max(1, Math.ceil((retryAt - now) / 1000)));
}

async function releaseSync(env: Env, projectId: string, leaseId: string) {
  await env.DB.prepare(`UPDATE sync_leases SET lease_until_ms=0
    WHERE project_id=? AND lease_id=?`).bind(projectId, leaseId).run();
}

export async function syncProject(
  env: Env,
  project: ProjectRow,
  opts: { now?: number } = {},
): Promise<SyncResult> {
  const lease = await claimSync(env, project.id, opts.now ?? Date.now());
  const guard = new SyncLeaseGuard(
    env,
    project.id,
    lease.leaseId,
    lease.leaseUntilMs,
  );
  try {
    return await syncProjectSources(env, project, guard);
  } finally {
    await releaseSync(env, project.id, lease.leaseId);
  }
}

export async function runScheduledSync(env: Env, opts: { now?: number } = {}) {
  for (const project of await activeProjects(env)) {
    try {
      const result = await syncProject(env, project, opts);
      if (Object.keys(result.errors).length) {
        console.warn(JSON.stringify({
          event: "project_sync_partial",
          project: project.id,
          errors: Object.keys(result.errors),
        }));
      }
    } catch (error) {
      if (error instanceof SyncTooFrequent) continue;
      // syncProject records source-level codes; a remaining exception is only
      // logged by class, never by including a handoff or provider response.
      console.warn(JSON.stringify({ event: "project_sync_failed", project: project.id }));
    }
  }
}

export { SyncFailure };
