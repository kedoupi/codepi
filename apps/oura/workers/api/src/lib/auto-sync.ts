import type { Env } from "../env";
import { ApiError, normalizeApiError } from "./errors.ts";
import { HEALTH_COLLECTIONS, collectionAccess, deniedHealthCollections, isCollectionAccessDenied, healthWindow, syncHealthWindow } from "./health-records.ts";
import { loadDailyForUser } from "./user-daily.ts";
import { reserveSyncWrites } from "./sync-budget.ts";
import { calendarDay } from "../../../../shared/dates.ts";

const DAY = 86_400_000;
const CRON = "*/2 * * * *";
const date = (ms: number) => new Date(ms).toISOString().slice(0, 10);
type Task = {
  collection: string; from: string; to: string;
  state: "pending" | "done" | "failed" | "split" | "unavailable";
  attempts: number; after: number; error?: string;
};
type State = {
  run_day: string | null; status: string; started_at: string | null; finished_at: string | null;
  last_success_at: string | null; last_error: string | null; payload: string;
};
type Coverage = {
  collection: string; window_from: string; window_to: string;
  synced_at: string | null; attempted_at: string; last_error: string | null;
};
const task = (collection: string, from: string, to: string): Task =>
  ({ collection, from, to, state: "pending", attempts: 0, after: 0 });

export function planAutomaticSync(today: string, coverage: Coverage[]): Task[] {
  const end = Date.parse(today);
  const recent: Task[] = [task("__scores", today, today)];
  const history: Task[] = [];
  const denied = new Set(collectionAccess(coverage).map(row => row.collection));
  for (const spec of HEALTH_COLLECTIONS) {
    if (denied.has(spec.name)) continue;
    if (spec.mode === "snapshot" || spec.mode === "profile") {
      recent.push(task(spec.name, today, today));
      continue;
    }
    const size = spec.mode === "time" ? 1 : 30;
    if (size === 1) {
      for (let back = 0; back < 7; back++) recent.push(task(spec.name, date(end - back * DAY), date(end - back * DAY)));
    } else recent.push(task(spec.name, date(end - 6 * DAY), today));
    const windows = coverage.filter(row => row.collection === spec.name);
    let batch: string[] = [];
    const flush = () => {
      if (batch.length) history.push(task(spec.name, batch.at(-1)!, batch[0]));
      batch = [];
    };
    for (let back = 7; back < 90; back++) {
      const day = date(end - back * DAY);
      const matches = windows.filter(row => row.window_from <= day && row.window_to >= day);
      const success = Math.max(0, ...matches.map(row => row.synced_at ? Date.parse(row.synced_at) : 0));
      const failure = Math.max(0, ...matches.filter(row => row.last_error).map(row => Date.parse(row.attempted_at)));
      // An empty successful response is coverage too. A later failure needs repair.
      if (success && success >= failure) { flush(); continue; }
      batch.push(day);
      if (batch.length === size) flush();
    }
    flush();
  }
  return [...recent, ...history.sort((a, b) => b.to.localeCompare(a.to))];
}

function preserveRetryDelays(tasks: Task[], previous: Task[], now: number) {
  const rateLimitUntil = Math.max(0, ...previous.filter(t => t.error === "rate_limited").map(t => t.after));
  for (const item of tasks) {
    const held = previous.filter(t => t.state === "failed" && t.after > now && t.collection === item.collection
      && t.from <= item.to && t.to >= item.from).sort((a, b) => b.after - a.after)[0];
    if (held) { item.after = held.after; item.error = held.error; }
    // A new plan gets a new attempt budget, not a way around an exhausted
    // provider cooldown. Both manual and scheduled planning use this guard.
    if (rateLimitUntil > now && rateLimitUntil >= item.after) {
      item.after = rateLimitUntil;
      item.error = "rate_limited";
    }
  }
}

async function cleanup(env: Env, now: number) {
  // Small batches of expired temporary state only. Keep health history, coverage
  // and MCP revocation/reuse evidence.
  const iso = new Date(now).toISOString();
  await env.DB.batch([
    env.DB.prepare("DELETE FROM sessions WHERE id IN (SELECT id FROM sessions WHERE expires_at<? LIMIT 500)").bind(iso),
    env.DB.prepare("DELETE FROM oauth_states WHERE state IN (SELECT state FROM oauth_states WHERE expires_at<? LIMIT 500)").bind(iso),
    env.DB.prepare("DELETE FROM oauth_consent_requests WHERE consent_id IN (SELECT consent_id FROM oauth_consent_requests WHERE expires_at<? LIMIT 500)").bind(now),
    env.DB.prepare("DELETE FROM oauth_auth_codes WHERE code_hash IN (SELECT code_hash FROM oauth_auth_codes WHERE expires_at<? LIMIT 500)").bind(now),
    env.DB.prepare("DELETE FROM analysis_cache WHERE rowid IN (SELECT rowid FROM analysis_cache WHERE created_at<? LIMIT 500)")
      .bind(new Date(now - 30 * DAY).toISOString()),
  ]);
}

export async function automaticSyncStatus(env: Env, userId: string) {
  const row = await env.DB.prepare("SELECT * FROM auto_sync_state WHERE user_id=?").bind(userId).first<State>();
  const tasks: Task[] = JSON.parse(row?.payload ?? "[]");
  const unavailable = await deniedHealthCollections(env, userId);
  const denied = new Set(unavailable.map(row => row.collection));
  const active = tasks.filter(t => t.state !== "split" && t.state !== "unavailable" && !denied.has(t.collection));
  const pending = active.filter(t => t.state === "pending");
  const scores = active.find(t => t.collection === "__scores");
  const details = active.filter(t => t.collection !== "__scores");
  const now = Date.now();
  const current = pending.find(t => t.after <= now) ?? [...pending].sort((a, b) => a.after - b.after)[0];
  const shanghaiDay = calendarDay(new Date(now));
  let next = Date.parse(`${shanghaiDay}T01:00:00Z`);
  if (next <= now) {
    next = !row?.run_day || row.run_day < shanghaiDay
      ? (Math.floor(now / 120_000) + 1) * 120_000
      : next + DAY;
  }
  return {
    enabled: env.AUTO_SYNC_ENABLED === "1",
    schedule: "09:00", timezone: "Asia/Shanghai", next_run_at: new Date(next).toISOString(),
    status: row?.status ?? "idle", run_day: row?.run_day ?? null,
    started_at: row?.started_at ?? null, finished_at: row?.finished_at ?? null,
    last_success_at: row?.last_success_at ?? null, error: row?.last_error ?? null,
    unavailable,
    total: active.length, completed: active.filter(t => t.state === "done").length,
    failed: active.filter(t => t.state === "failed").length, remaining: pending.length,
    scores: {
      status: scores?.state === "done" ? "completed" : scores?.state === "failed" ? "failed" : "pending",
      error: scores?.error ?? null,
    },
    details: {
      total: details.length, completed: details.filter(t => t.state === "done").length,
      failed: details.filter(t => t.state === "failed").length,
      remaining: details.filter(t => t.state === "pending").length,
    },
    current: current ? {
      collection: current.collection, from: current.from, to: current.to,
    } : null,
    next_batch_at: row?.status === "running" && pending.length
      ? new Date(Math.max(now + 120_000, Math.min(...pending.map(t => t.after)))).toISOString() : null,
  };
}

// Persist first, acknowledge second. The scheduled handler is the durable
// executor; waitUntil only gives the first batch a head start.
export async function requestAutomaticSync(env: Env, userId: string) {
  if (env.AUTO_SYNC_ENABLED !== "1") throw new ApiError("auto_sync_disabled", 503);
  if (!env.PERSONAL_OWNER_ID || userId !== env.PERSONAL_OWNER_ID) throw new ApiError("not_owner", 403);
  if (!env.TOKEN_ENCRYPTION_KEY || !env.OURA_CLIENT_ID || !env.OURA_CLIENT_SECRET) {
    throw new ApiError("oura_not_configured", 503);
  }
  const owner = await env.DB.prepare("SELECT user_id FROM encrypted_tokens WHERE user_id=?").bind(userId).first();
  if (!owner) throw new ApiError("reconnect_required", 401);
  const now = Date.now();
  const lease = crypto.randomUUID();
  const row = await env.DB.prepare(`INSERT INTO auto_sync_state (user_id,lease_id,lease_until) VALUES (?,?,?)
    ON CONFLICT(user_id) DO UPDATE SET lease_id=excluded.lease_id,lease_until=excluded.lease_until
    WHERE auto_sync_state.lease_until<? RETURNING *`).bind(userId, lease, now + 120_000, now).first<State>();
  if (!row) {
    const status = await automaticSyncStatus(env, userId);
    if (status.status !== "running" && status.status !== "blocked") throw new ApiError("sync_in_progress", 409);
    return { started: false, status };
  }
  let started = false;
  try {
    // Clicking again must not clear a retry delay, a quota hold, or an OAuth block.
    if (row.status !== "running" && row.status !== "blocked"
      && !(row.finished_at && now - Date.parse(row.finished_at) < 30_000)) {
      const today = calendarDay(new Date(now));
      const coverage = await env.DB.prepare("SELECT * FROM health_sync_windows WHERE user_id=?")
        .bind(userId).all<Coverage>();
      const tasks = planAutomaticSync(today, coverage.results);
      const previous: Task[] = JSON.parse(row.payload);
      preserveRetryDelays(tasks, previous, now);
      // An early manual update must not consume the 09:00 daily gate. Keep
      // the previous gate day until a run is actually started after 09:00.
      const gateDay = now >= Date.parse(`${today}T01:00:00Z`) ? today : row.run_day;
      await env.DB.prepare(`UPDATE auto_sync_state SET run_day=?,status='running',started_at=?,finished_at=NULL,
        last_error=?,payload=? WHERE user_id=? AND lease_id=?`)
        .bind(gateDay, new Date(now).toISOString(), tasks.find(t => t.error)?.error ?? null,
          JSON.stringify(tasks), userId, lease).run();
      started = true;
      console.log(JSON.stringify({ event: "auto_sync", action: "manual_plan", run_day: today, tasks: tasks.length }));
    }
  } finally {
    await env.DB.prepare("UPDATE auto_sync_state SET lease_until=0 WHERE user_id=? AND lease_id=?").bind(userId, lease).run();
  }
  return { started, status: await automaticSyncStatus(env, userId) };
}

export async function runAutomaticSync(env: Env, scheduledTime: number, cron: string) {
  // One structured line per invocation: this is the only signal that the
  // schedule is alive, so keep the reason for every early return.
  const log = (fields: Record<string, unknown>) => console.log(JSON.stringify({ event: "auto_sync", ...fields }));
  if (env.AUTO_SYNC_ENABLED !== "1" || cron !== CRON || !env.PERSONAL_OWNER_ID) {
    log({ action: "skip", reason: "disabled_or_wrong_cron", cron,
      enabled: env.AUTO_SYNC_ENABLED === "1", ownerConfigured: Boolean(env.PERSONAL_OWNER_ID) });
    return;
  }
  // Never use development credential fallbacks in a scheduled event.
  if (!env.TOKEN_ENCRYPTION_KEY || !env.OURA_CLIENT_ID || !env.OURA_CLIENT_SECRET) {
    throw new Error("Automatic sync requires Oura OAuth and encryption configuration");
  }
  const userId = env.PERSONAL_OWNER_ID;
  const owner = await env.DB.prepare("SELECT user_id FROM encrypted_tokens WHERE user_id=?").bind(userId).first();
  if (!owner) {
    log({ action: "skip", reason: "no_authorization" });
    return;
  }
  const now = Date.now();
  const lease = crypto.randomUUID();
  const acquired = await env.DB.prepare(`INSERT INTO auto_sync_state (user_id,lease_id,lease_until) VALUES (?,?,?)
    ON CONFLICT(user_id) DO UPDATE SET lease_id=excluded.lease_id,lease_until=excluded.lease_until
    WHERE auto_sync_state.lease_until<? RETURNING *`).bind(userId, lease, now + 120_000, now).first<State>();
  if (!acquired) {
    log({ action: "skip", reason: "lease_held" });
    return;
  }
  try {
    let row = acquired;
    if (row.status === "blocked") {
      log({ action: "skip", reason: "blocked", error: row.last_error });
      return;
    }
    let tasks: Task[] = JSON.parse(row.payload);
    // Reconcile pre-deploy queues and direct/manual refusals, even when the
    // old run already finished or its retry deadlines have not elapsed.
    const unavailable = await deniedHealthCollections(env, userId);
    let reconciled = false;
    for (const item of tasks) {
      if (item.collection === "__scores") continue;
      const denial = unavailable.find(row => row.collection === item.collection);
      if (denial && (item.state === "pending" || item.state === "failed")) {
        item.state = "unavailable";
        item.error = denial.code;
        reconciled = true;
      } else if (!denial && (item.state === "unavailable" || item.state === "failed" && isCollectionAccessDenied(item.error))) {
        item.state = "pending";
        item.after = 0;
        item.attempts = 0;
        delete item.error;
        reconciled = true;
      }
    }
    // Cron is UTC; the daily gate is 09:00 Shanghai. Use event time so delayed
    // delivery cannot accidentally start tomorrow's run.
    const today = calendarDay(new Date(scheduledTime));
    const due = scheduledTime >= Date.parse(`${today}T01:00:00Z`);
    // The daily gate starts idle jobs only. Accepted work keeps its exact
    // checkpoints and retry delays across midnight and subsequent daily gates.
    const startNew = row.status !== "running" && due && (!row.run_day || row.run_day < today);
    if (row.status !== "running" && !startNew && !reconciled) {
      log({ action: "skip", reason: "idle", status: row.status, run_day: row.run_day });
      return;
    }
    if (startNew) {
      const coverage = await env.DB.prepare("SELECT * FROM health_sync_windows WHERE user_id=?")
        .bind(userId).all<Coverage>();
      const planned = planAutomaticSync(today, coverage.results);
      preserveRetryDelays(planned, tasks, now);
      tasks = planned;
      // Cleanup is bounded too; if today's budget is used, preserve the work
      // queue and perform cleanup at a later daily start.
      try {
        await reserveSyncWrites(env, userId, 6_000);
        await cleanup(env, now);
      } catch (error) {
        if (!(error instanceof ApiError) || error.code !== "daily_sync_budget_reached") throw error;
      }
      const lastError = tasks.find(t => t.error)?.error ?? null;
      await env.DB.prepare(`UPDATE auto_sync_state SET run_day=?,status='running',started_at=?,finished_at=NULL,
        last_error=?,payload=? WHERE user_id=? AND lease_id=?`)
        .bind(today, new Date(now).toISOString(), lastError, JSON.stringify(tasks), userId, lease).run();
      row = { ...row, run_day: today, status: "running", last_error: lastError };
      log({ action: "plan", run_day: today, tasks: tasks.length });
    }
    const item = tasks.find(t => t.state === "pending" && t.after <= now);
    if (!item) {
      if (reconciled) await saveProgress(env, userId, lease, tasks, false);
      log({ action: "idle", reason: "no_task_due", pending: tasks.filter(t => t.state === "pending").length });
      return;
    }
    // This request supplies origin-dependent configuration only; it is never
    // routed through an authenticated HTTP endpoint or given a session.
    const request = new Request(env.FRONTEND_ORIGIN || "https://health.codepi.app");
    let blocked = false;
    try {
      if (item.collection === "__scores") {
        await reserveSyncWrites(env, userId, 1_000);
        const data = await loadDailyForUser(request, env, userId, 90, true);
        if (data instanceof Response) throw new ApiError("oura_not_configured", 503);
        if (data.sync?.error) throw new ApiError(data.sync.error);
        if (data.sync?.stale) throw new ApiError("sync_in_progress", 409);
      } else {
        await syncHealthWindow(request, env, userId, healthWindow(item.collection, item.from, item.to), true, true);
      }
      item.state = "done";
      delete item.error;
    } catch (error) {
      const code = normalizeApiError(error, "upstream_unavailable", 502).code;
      item.error = code;
      if (code === "reconnect_required" || code === "oura_not_configured") {
        blocked = true;
      } else if (["daily_sync_budget_reached", "storage_write_quota_exceeded"].includes(code)) {
        const reset = Date.parse(date(now)) + DAY + 3_600_000;
        for (const other of tasks.filter(t => t.state === "pending")) other.after = reset;
      } else if (code === "sync_window_too_large" && item.from < item.to) {
        const middle = Math.floor((Date.parse(item.to) - Date.parse(item.from)) / DAY / 2);
        const cut = Date.parse(item.from) + middle * DAY;
        item.state = "split";
        tasks.splice(tasks.indexOf(item) + 1, 0,
          task(item.collection, date(cut + DAY), item.to), task(item.collection, item.from, date(cut)));
      } else if (item.collection !== "__scores" && isCollectionAccessDenied(code)) {
        for (const other of tasks.filter(t => t.collection === item.collection && ["pending", "failed"].includes(t.state))) {
          other.state = "unavailable";
          other.error = code;
        }
      } else if (code === "sync_in_progress") {
        item.after = now + 120_000;
      } else {
        item.attempts++;
        item.after = now + 15 * 60_000 * item.attempts;
        if (item.attempts >= 3 || code === "sync_window_too_large") item.state = "failed";
        if (code === "rate_limited") {
          for (const other of tasks.filter(t => t.state === "pending")) other.after = Math.max(other.after, item.after);
        }
      }
    }
    const status = await saveProgress(env, userId, lease, tasks, blocked, item.error);
    log({ action: "task", collection: item.collection, from: item.from, to: item.to,
      state: item.state, code: item.error ?? null, status, remaining: tasks.filter(t => t.state === "pending").length });
  } finally {
    await env.DB.prepare("UPDATE auto_sync_state SET lease_until=0 WHERE user_id=? AND lease_id=?").bind(userId, lease).run();
  }
}

async function saveProgress(env: Env, userId: string, lease: string, tasks: Task[], blocked: boolean, error?: string) {
  const finished = !tasks.some(t => t.state === "pending");
  const failed = tasks.some(t => t.state === "failed");
  const status = blocked ? "blocked" : !finished ? "running" : failed ? "partial" : "completed";
  const lastError = blocked ? error : tasks.find(t => t.error && t.state === "pending")?.error
    ?? tasks.find(t => t.error && t.state === "failed")?.error ?? null;
  const now = new Date().toISOString();
  await env.DB.prepare(`UPDATE auto_sync_state SET status=?,payload=?,last_error=?,finished_at=?,
    last_success_at=CASE WHEN ?='completed' THEN ? ELSE last_success_at END WHERE user_id=? AND lease_id=?`)
    .bind(status, JSON.stringify(tasks), lastError ?? null, finished ? now : null, status, now, userId, lease).run();
  return status;
}
