import type { Env } from "../env";
import { ApiError } from "./errors.ts";
import { HEALTH_COLLECTIONS, healthWindow, syncHealthWindow } from "./health-records.ts";
import { loadDailyForUser } from "./user-daily.ts";

const DAY = 86_400_000;
const CRON = "*/2 * * * *";
const date = (ms: number) => new Date(ms).toISOString().slice(0, 10);
type Task = {
  collection: string; from: string; to: string;
  state: "pending" | "done" | "failed" | "split";
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
  for (const spec of HEALTH_COLLECTIONS) {
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

async function cleanup(env: Env, now: number) {
  // Small batches of expired temporary state only. Keep health history, coverage,
  // billing idempotency and MCP revocation/reuse evidence.
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
  const active = tasks.filter(t => t.state !== "split");
  const pending = active.filter(t => t.state === "pending");
  const now = Date.now();
  const shanghaiDay = date(now + 8 * 3_600_000);
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
    total: active.length, completed: active.filter(t => t.state === "done").length,
    failed: active.filter(t => t.state === "failed").length, remaining: pending.length,
    next_batch_at: row?.status === "running" && pending.length
      ? new Date(Math.max(now + 120_000, Math.min(...pending.map(t => t.after)))).toISOString() : null,
  };
}

export async function runAutomaticSync(env: Env, scheduledTime: number, cron: string) {
  if (env.AUTO_SYNC_ENABLED !== "1" || cron !== CRON || !env.PERSONAL_OWNER_ID) return;
  // Never use development credential fallbacks in a scheduled event.
  if (!env.TOKEN_ENCRYPTION_KEY || !env.OURA_CLIENT_ID || !env.OURA_CLIENT_SECRET) {
    throw new Error("Automatic sync requires Oura OAuth and encryption configuration");
  }
  const userId = env.PERSONAL_OWNER_ID;
  const owner = await env.DB.prepare("SELECT user_id FROM encrypted_tokens WHERE user_id=?").bind(userId).first();
  if (!owner) return;
  const now = Date.now();
  const lease = crypto.randomUUID();
  const acquired = await env.DB.prepare(`INSERT INTO auto_sync_state (user_id,lease_id,lease_until) VALUES (?,?,?)
    ON CONFLICT(user_id) DO UPDATE SET lease_id=excluded.lease_id,lease_until=excluded.lease_until
    WHERE auto_sync_state.lease_until<? RETURNING *`).bind(userId, lease, now + 120_000, now).first<State>();
  if (!acquired) return;
  try {
    let row = acquired;
    if (row.status === "blocked") return;
    let tasks: Task[] = JSON.parse(row.payload);
    // Cron is UTC; the daily gate is 09:00 Shanghai. Use event time so delayed
    // delivery cannot accidentally start tomorrow's run.
    const today = date(scheduledTime + 8 * 3_600_000);
    const due = scheduledTime >= Date.parse(`${today}T01:00:00Z`);
    if (row.status !== "running") {
      if (!due || (row.run_day && row.run_day >= today)) return;
      const coverage = await env.DB.prepare("SELECT * FROM health_sync_windows WHERE user_id=? AND window_to>=?")
        .bind(userId, date(Date.parse(today) - 89 * DAY)).all<Coverage>();
      tasks = planAutomaticSync(today, coverage.results);
      await cleanup(env, now);
      await env.DB.prepare(`UPDATE auto_sync_state SET run_day=?,status='running',started_at=?,finished_at=NULL,
        last_error=NULL,payload=? WHERE user_id=? AND lease_id=?`)
        .bind(today, new Date(now).toISOString(), JSON.stringify(tasks), userId, lease).run();
      row = { ...row, run_day: today, status: "running", last_error: null };
    }
    const item = tasks.find(t => t.state === "pending" && t.after <= now);
    if (!item) return;
    // This request supplies origin-dependent configuration only; it is never
    // routed through an authenticated HTTP endpoint or given a session.
    const request = new Request(env.FRONTEND_ORIGIN || "https://oura.kdp.cool");
    let blocked = false;
    try {
      if (item.collection === "__scores") {
        const data = await loadDailyForUser(request, env, userId, 90, true);
        if (data instanceof Response) throw new ApiError("oura_not_configured", 503);
        if (data.sync?.error) throw new ApiError(data.sync.error);
        if (data.sync?.stale) throw new ApiError("sync_in_progress", 409);
      } else {
        await syncHealthWindow(request, env, userId, healthWindow(item.collection, item.from, item.to));
      }
      item.state = "done";
      delete item.error;
    } catch (error) {
      const code = error instanceof ApiError ? error.code : "upstream_unavailable";
      item.error = code;
      if (code === "reconnect_required" || code === "oura_not_configured") {
        blocked = true;
      } else if (code === "sync_window_too_large" && item.from < item.to) {
        const middle = Math.floor((Date.parse(item.to) - Date.parse(item.from)) / DAY / 2);
        const cut = Date.parse(item.from) + middle * DAY;
        item.state = "split";
        tasks.splice(tasks.indexOf(item) + 1, 0,
          task(item.collection, date(cut + DAY), item.to), task(item.collection, item.from, date(cut)));
      } else if (code === "permission_or_membership_required") {
        for (const other of tasks.filter(t => t.collection === item.collection && t.state === "pending")) {
          other.state = "failed";
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
    const finished = !tasks.some(t => t.state === "pending");
    const failed = tasks.some(t => t.state === "failed");
    const status = blocked ? "blocked" : !finished ? "running" : failed ? "partial" : "completed";
    const lastError = blocked ? item.error : tasks.find(t => t.error && t.state !== "split")?.error ?? null;
    await env.DB.prepare(`UPDATE auto_sync_state SET status=?,payload=?,last_error=?,finished_at=?,
      last_success_at=CASE WHEN ?='completed' THEN ? ELSE last_success_at END WHERE user_id=? AND lease_id=?`)
      .bind(status, JSON.stringify(tasks), lastError ?? null, finished ? new Date().toISOString() : null,
        status, new Date().toISOString(), userId, lease).run();
  } finally {
    await env.DB.prepare("UPDATE auto_sync_state SET lease_until=0 WHERE user_id=? AND lease_id=?").bind(userId, lease).run();
  }
}
