import type { Env } from "../env";
import { ApiError, normalizeApiError, ouraResponseError } from "./errors.ts";
import { OURA_API_BASE } from "./oura";
import { withOuraAccess } from "./oura-access.ts";
import { reserveSyncWrites } from "./sync-budget.ts";
import { calendarDay } from "../../../../shared/dates.ts";

type Collection = { name: string; label: string; mode: "date" | "time" | "snapshot" | "profile" };
export const HEALTH_COLLECTIONS: Collection[] = [
  { name: "sleep", label: "详细睡眠 / Sleep details", mode: "date" },
  { name: "daily_sleep", label: "睡眠评分 / Sleep scores", mode: "date" },
  { name: "daily_readiness", label: "准备度详情 / Readiness", mode: "date" },
  { name: "daily_activity", label: "完整活动指标 / Activity", mode: "date" },
  { name: "heartrate", label: "全天心率 / Heart rate", mode: "time" },
  { name: "daily_spo2", label: "血氧与呼吸 / SpO2", mode: "date" },
  { name: "daily_stress", label: "压力与恢复 / Stress", mode: "date" },
  { name: "daily_resilience", label: "韧性 / Resilience", mode: "date" },
  { name: "daily_cardiovascular_age", label: "心血管年龄 / Cardiovascular age", mode: "date" },
  { name: "vO2_max", label: "心肺能力 / VO2 max", mode: "date" },
  { name: "workout", label: "运动 / Workouts", mode: "date" },
  { name: "enhanced_tag", label: "生活标签 / Tags", mode: "date" },
  { name: "session", label: "冥想等练习 / Sessions", mode: "date" },
  { name: "sleep_time", label: "就寝建议 / Bedtime", mode: "date" },
  { name: "rest_mode_period", label: "休息模式 / Rest mode", mode: "date" },
  { name: "ring_configuration", label: "戒指信息 / Ring configuration", mode: "snapshot" },
  { name: "ring_battery_level", label: "戒指电量 / Ring battery", mode: "time" },
  { name: "personal_info", label: "个人资料 / Personal profile", mode: "profile" },
];

type RecordData = Record<string, unknown>;
type WindowState = { synced_at: string | null; attempted_at: string; last_error: string | null };
const DAY = 86_400_000;

export const isCollectionAccessDenied = (code: string | null | undefined) =>
  code === "upstream_access_denied" || code === "permission_or_membership_required" || code === "oura_scope_required";

// Access refusals belong to a collection, not a date window. Keep the evidence
// in coverage history; the OAuth callback clears it after fresh consent.
export function collectionAccess(windows: (WindowState & { collection: string })[]) {
  const latest = new Map<string, WindowState & { collection: string }>();
  for (const row of windows) {
    const previous = latest.get(row.collection);
    if (!previous || row.attempted_at > previous.attempted_at
      || row.attempted_at === previous.attempted_at && !row.last_error) latest.set(row.collection, row);
  }
  return [...latest.values()].filter(row => isCollectionAccessDenied(row.last_error))
    .map(row => ({ collection: row.collection, code: row.last_error!, checked_at: row.attempted_at }));
}

export async function deniedHealthCollections(env: Env, userId: string) {
  const windows = await env.DB.prepare(`SELECT collection, synced_at, attempted_at, last_error
    FROM health_sync_windows WHERE user_id=?`).bind(userId)
    .all<WindowState & { collection: string }>();
  return collectionAccess(windows.results);
}

export function healthWindow(collection: unknown, from?: unknown, to?: unknown) {
  const spec = HEALTH_COLLECTIONS.find(item => item.name === collection);
  if (!spec) throw new ApiError("invalid_collection", 400);
  const today = calendarDay();
  const end = to ?? today;
  for (const value of [end, from ?? end]) {
    if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)
      || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString().slice(0, 10) !== value) {
      throw new ApiError("invalid_date_range", 400);
    }
  }
  const start = from ?? new Date(Date.parse(String(end)) - 6 * DAY).toISOString().slice(0, 10);
  const days = (Date.parse(end as string) - Date.parse(start as string)) / DAY + 1;
  if (days < 1 || days > (spec.mode === "time" ? 7 : 31) || String(end) > today) {
    throw new ApiError("invalid_date_range", 400);
  }
  return { spec, from: String(start), to: String(end) };
}
type Window = ReturnType<typeof healthWindow>;
const snapshot = (spec: Collection) => spec.mode === "snapshot" || spec.mode === "profile";

async function windowState(env: Env, userId: string, w: Window) {
  return env.DB.prepare(`SELECT synced_at, attempted_at, last_error FROM health_sync_windows
    WHERE user_id=? AND collection=? AND window_from=? AND window_to=?`)
    .bind(userId, w.spec.name, w.from, w.to).first<WindowState>();
}

function recordDay(row: RecordData, spec: Collection): string {
  if (snapshot(spec)) return "";
  const value = row.day ?? row.start_day ?? row.timestamp ?? row.start_datetime ?? row.start_time;
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}/.test(value)) {
    throw new ApiError("invalid_upstream_record", 502);
  }
  // A document's `day` is Oura's assigned local date. Timestamp collections use UTC.
  return spec.mode === "time" ? new Date(value).toISOString().slice(0, 10) : value.slice(0, 10);
}

function recordId(row: RecordData, spec: Collection): string {
  if (typeof row.id === "string" && row.id) return row.id;
  if (spec.mode === "profile") return "profile";
  if (spec.mode === "time" && typeof row.timestamp === "string") {
    return JSON.stringify([new Date(row.timestamp).toISOString(), row.source ?? null, row.ring_id ?? null]);
  }
  throw new ApiError("invalid_upstream_record", 502);
}

async function fetchRecords(token: string, w: Window, signal: AbortSignal): Promise<RecordData[]> {
  const url = new URL(`${OURA_API_BASE}/${w.spec.name}`);
  const exclusiveEnd = new Date(Date.parse(w.to) + DAY).toISOString();
  if (w.spec.mode === "date") {
    url.searchParams.set("start_date", w.from);
    url.searchParams.set("end_date", exclusiveEnd.slice(0, 10));
  } else if (w.spec.mode === "time") {
    url.searchParams.set("start_datetime", `${w.from}T00:00:00Z`);
    url.searchParams.set("end_datetime", exclusiveEnd);
  }
  const rows: RecordData[] = [];
  const seen = new Set<string>();
  // Bound both subrequests and wall time; never silently accept truncated pagination.
  for (let page = 0; page < 20; page++) {
    const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` }, signal });
    if (!res.ok) {
      throw await ouraResponseError(res);
    }
    const body = await res.json() as { data?: unknown; next_token?: unknown };
    const data = w.spec.mode === "profile" ? [body] : body.data;
    if (!Array.isArray(data) || data.some(row => !row || typeof row !== "object" || Array.isArray(row))) {
      throw new ApiError("invalid_upstream_record", 502);
    }
    rows.push(...data as RecordData[]);
    if (rows.length > 5000) throw new ApiError("sync_window_too_large", 422);
    if (body.next_token == null) return rows;
    if (typeof body.next_token !== "string" || !body.next_token || seen.has(body.next_token)) {
      throw new ApiError("invalid_upstream_pagination", 502);
    }
    seen.add(body.next_token);
    url.searchParams.set("next_token", body.next_token);
  }
  throw new ApiError("sync_window_too_large", 422);
}

async function resolveSplitWindows(env: Env, userId: string, w: Window, fetchedAt: string, lease: string) {
  const parents = await env.DB.prepare(`SELECT window_from, window_to, attempted_at FROM health_sync_windows
    WHERE user_id=? AND collection=? AND last_error='sync_window_too_large'
      AND window_from<=? AND window_to>=?`)
    .bind(userId, w.spec.name, w.from, w.to)
    .all<{ window_from: string; window_to: string; attempted_at: string }>();
  for (const parent of parents.results) {
    // Only successes after this failure can resolve it; older archives do not prove recovery.
    const children = await env.DB.prepare(`SELECT window_from, window_to FROM health_sync_windows
      WHERE user_id=? AND collection=? AND last_error IS NULL AND synced_at>=?
        AND window_to>=? AND window_from<=? ORDER BY window_from`)
      .bind(userId, w.spec.name, parent.attempted_at, parent.window_from, parent.window_to)
      .all<{ window_from: string; window_to: string }>();
    let coveredUntil = Date.parse(parent.window_from);
    for (const child of children.results) {
      if (Date.parse(child.window_from) > coveredUntil) break;
      coveredUntil = Math.max(coveredUntil, Date.parse(child.window_to) + DAY);
    }
    if (coveredUntil <= Date.parse(parent.window_to)) continue;
    await env.DB.prepare(`UPDATE health_sync_windows SET last_error=NULL, synced_at=?
      WHERE user_id=? AND collection=? AND window_from=? AND window_to=?
        AND attempted_at=? AND last_error='sync_window_too_large'
        AND EXISTS (SELECT 1 FROM sync_state WHERE user_id=? AND lease_id=?)`)
      .bind(fetchedAt, userId, w.spec.name, parent.window_from, parent.window_to, parent.attempted_at, userId, lease).run();
  }
}

export async function syncHealthWindow(request: Request, env: Env, userId: string, w: Window, force = false, automatic = false) {
  const denied = (await deniedHealthCollections(env, userId)).find(row => row.collection === w.spec.name);
  if (denied) throw new ApiError(denied.code, 403);
  const state = await windowState(env, userId, w);
  const now = Date.now();
  if (state?.synced_at && !state.last_error && now - Date.parse(state.synced_at) < (force ? 30_000 : 600_000)) return;
  if (state?.last_error && now - Date.parse(state.attempted_at) < 30_000) {
    throw new ApiError(state.last_error, isCollectionAccessDenied(state.last_error) ? 403 : 503);
  }
  const lease = crypto.randomUUID();
  const acquired = await env.DB.prepare(`INSERT INTO sync_state (user_id, lease_id, lease_until) VALUES (?, ?, ?)
    ON CONFLICT(user_id) DO UPDATE SET lease_id=excluded.lease_id, lease_until=excluded.lease_until
    WHERE sync_state.lease_until < ? RETURNING lease_id`)
    .bind(userId, lease, now + 120_000, now).first();
  if (!acquired) throw new ApiError("sync_in_progress", 409);
  let providerStarted = false;
  try {
    // Another import may have established a pause between the fast check and
    // lease acquisition. Recheck under the same lease that serializes access.
    const paused = (await deniedHealthCollections(env, userId)).find(row => row.collection === w.spec.name);
    if (paused) throw new ApiError(paused.code, 403);
    const signal = AbortSignal.timeout(20_000);
    providerStarted = true;
    const records = await withOuraAccess(request, env, userId, token => fetchRecords(token, w, signal), lease);
    const fetchedAt = new Date().toISOString();
    const unique = new Map<string, { day: string; payload: string }>();
    let totalBytes = 0;
    for (const row of records) {
      const day = recordDay(row, w.spec);
      if (!snapshot(w.spec) && (day < w.from || day > w.to)) continue;
      const payload = JSON.stringify(row);
      const bytes = new TextEncoder().encode(payload).length;
      totalBytes += bytes;
      if (bytes > 90_000 || totalBytes > 8_000_000) throw new ApiError("sync_window_too_large", 422);
      unique.set(recordId(row, w.spec), { day, payload });
    }
    const savedSize = await env.DB.prepare(`SELECT COUNT(*) AS n, COALESCE(SUM(length(CAST(payload AS BLOB))),0) AS bytes
      FROM health_records WHERE user_id=? AND collection=? AND (day='' OR (day>=? AND day<=?))`)
      .bind(userId, w.spec.name, w.from, w.to).first<{ n: number; bytes: number }>();
    if (savedSize && (savedSize.n > 5000 || savedSize.bytes > 8_000_000)) {
      throw new ApiError("sync_window_too_large", 422);
    }
    const saved = await env.DB.prepare(`SELECT record_id, day, payload FROM health_records
      WHERE user_id=? AND collection=? AND (day='' OR (day>=? AND day<=?))`)
      .bind(userId, w.spec.name, w.from, w.to).all<{ record_id: string; day: string; payload: string }>();
    const previous = new Map(saved.results.map(row => [row.record_id, row]));
    const entries = [...unique].filter(([id, row]) => previous.get(id)?.payload !== row.payload || previous.get(id)?.day !== row.day);
    const removed = saved.results.filter(row => !unique.has(row.record_id)).length;
    if (automatic) {
      const windows = await env.DB.prepare(`SELECT COUNT(*) AS n FROM health_sync_windows
        WHERE user_id=? AND collection=? AND window_from<=? AND window_to>=?`)
        .bind(userId, w.spec.name, w.to, w.from).first<{ n: number }>();
      await reserveSyncWrites(env, userId, 4 * (entries.length + removed + (windows?.n ?? 0)) + 32);
    }
    // Write only changed records. Rewriting identical high-frequency samples
    // repeatedly can exhaust D1's free daily write quota, including index writes.
    const inserts: D1PreparedStatement[] = [];
    let chunk: string[] = [];
    let chunkBytes = 2;
    const flush = () => {
      if (!chunk.length) return;
      // JSON input keeps large time-series imports below D1's per-invocation
      // query and 100-bind limits. Bound each JSON parameter to 512 KB.
      inserts.push(env.DB.prepare(`INSERT INTO health_records (user_id, collection, record_id, day, payload, fetched_at)
        SELECT ?, ?, json_extract(value,'$[0]'), json_extract(value,'$[1]'), json_extract(value,'$[2]'), ?
        FROM json_each(?) WHERE EXISTS (SELECT 1 FROM sync_state WHERE user_id=? AND lease_id=?)
        ON CONFLICT(user_id, collection, record_id)
        DO UPDATE SET day=excluded.day, payload=excluded.payload, fetched_at=excluded.fetched_at`)
        .bind(userId, w.spec.name, fetchedAt, `[${chunk.join(",")}]`, userId, lease));
      chunk = [];
      chunkBytes = 2;
    };
    for (const [id, row] of entries) {
      const json = JSON.stringify([id, row.day, row.payload]);
      const bytes = new TextEncoder().encode(json).length + 1;
      if (chunkBytes + bytes > 512_000) flush();
      chunk.push(json);
      chunkBytes += bytes;
    }
    flush();
    // Replace only a fully fetched window atomically; preserve all other history.
    const results = await env.DB.batch([
      env.DB.prepare(`DELETE FROM health_records WHERE user_id=? AND collection=? AND (day='' OR (day>=? AND day<=?))
        AND record_id NOT IN (SELECT value FROM json_each(?))
        AND EXISTS (SELECT 1 FROM sync_state WHERE user_id=? AND lease_id=?)`)
        .bind(userId, w.spec.name, w.from, w.to, JSON.stringify([...unique.keys()]), userId, lease),
      ...inserts,
      env.DB.prepare(`UPDATE health_sync_windows SET last_error=NULL, synced_at=?
        WHERE user_id=? AND collection=? AND window_from>=? AND window_to<=? AND last_error IS NOT NULL
        AND EXISTS (SELECT 1 FROM sync_state WHERE user_id=? AND lease_id=?)`)
        .bind(fetchedAt, userId, w.spec.name, w.from, w.to, userId, lease),
      env.DB.prepare(`INSERT INTO health_sync_windows
        (user_id, collection, window_from, window_to, synced_at, attempted_at, last_error)
        SELECT ?, ?, ?, ?, ?, ?, NULL WHERE EXISTS (SELECT 1 FROM sync_state WHERE user_id=? AND lease_id=?)
        ON CONFLICT(user_id, collection, window_from, window_to)
        DO UPDATE SET synced_at=excluded.synced_at, attempted_at=excluded.attempted_at, last_error=NULL`)
        .bind(userId, w.spec.name, w.from, w.to, fetchedAt, fetchedAt, userId, lease),
    ]);
    if (!results.at(-1)?.meta.changes) throw new ApiError("sync_in_progress", 409);
    await resolveSplitWindows(env, userId, w, fetchedAt, lease);
  } catch (err) {
    const error = normalizeApiError(err, "upstream_unavailable", 502);
    if (!providerStarted || ["sync_in_progress", "daily_sync_budget_reached", "storage_write_quota_exceeded"].includes(error.code)) throw error;
    await env.DB.prepare(`INSERT INTO health_sync_windows
      (user_id, collection, window_from, window_to, attempted_at, last_error)
      SELECT ?, ?, ?, ?, ?, ? WHERE EXISTS (SELECT 1 FROM sync_state WHERE user_id=? AND lease_id=?)
      ON CONFLICT(user_id, collection, window_from, window_to)
      DO UPDATE SET attempted_at=excluded.attempted_at, last_error=excluded.last_error`)
      .bind(userId, w.spec.name, w.from, w.to, new Date().toISOString(), error.code, userId, lease).run();
    throw error;
  } finally {
    await env.DB.prepare("UPDATE sync_state SET lease_until=0 WHERE user_id=? AND lease_id=?").bind(userId, lease).run();
  }
}

const SERIES_FIELDS = new Set(["heart_rate", "hrv", "heart_rate_variability", "motion_count", "met",
  "movement_30_sec", "sleep_phase_30_sec", "sleep_phase_5_min", "app_sleep_phase_5_min", "class_5_min"]);

export async function readHealthRecords(env: Env, userId: string, w: Window, offset = 0, includeSeries = false) {
  if (!Number.isInteger(offset) || offset < 0 || offset > 100_000) throw new ApiError("invalid_offset", 400);
  const query = "FROM health_records WHERE user_id=? AND collection=? AND (day='' OR (day>=? AND day<=?))";
  const args = [userId, w.spec.name, w.from, w.to];
  const rows = await env.DB.prepare(`SELECT payload ${query} ORDER BY day, record_id LIMIT 21 OFFSET ?`)
    .bind(...args, offset).all<{ payload: string }>();
  const count = await env.DB.prepare(`SELECT COUNT(*) AS n ${query}`).bind(...args).first<{ n: number }>();
  const state = await windowState(env, userId, w);
  const refusal = (await deniedHealthCollections(env, userId)).find(row => row.collection === w.spec.name);
  const records: RecordData[] = [];
  let responseBytes = 0;
  for (const row of rows.results.slice(0, 20)) {
    const data = JSON.parse(row.payload) as RecordData;
    const projected = includeSeries ? data : Object.fromEntries(Object.entries(data).filter(([key]) => !SERIES_FIELDS.has(key)));
    const size = new TextEncoder().encode(JSON.stringify(projected)).length;
    if (records.length && responseBytes + size > 64_000) break;
    records.push(projected);
    responseBytes += size;
  }
  return {
    collection: w.spec.name, from: w.from, to: w.to,
    date_basis: w.spec.mode === "time" ? "UTC" : snapshot(w.spec) ? "current_snapshot" : "Oura assigned day",
    records,
    total: count?.n ?? 0, next_offset: rows.results.length > records.length ? offset + records.length : null,
    series_included: includeSeries,
    access: {
      status: refusal ? "unavailable" : state?.synced_at ? "available" : "unknown",
      automatic_retry: !refusal, code: refusal?.code ?? null, checked_at: refusal?.checked_at ?? null,
    },
    sync: {
      synced_at: state?.synced_at ?? null, error: state?.last_error ?? null,
      stale: !state?.synced_at || Boolean(state.last_error) || Date.now() - Date.parse(state.synced_at) >= 600_000,
      window_verified: Boolean(state?.synced_at),
    },
  };
}

export async function healthStatus(env: Env, userId: string) {
  const rows = await env.DB.prepare(`SELECT collection, COUNT(*) AS records, MIN(NULLIF(day,'')) AS earliest_day,
    MAX(NULLIF(day,'')) AS latest_day FROM health_records WHERE user_id=? GROUP BY collection`)
    .bind(userId).all<{ collection: string; records: number; earliest_day: string | null; latest_day: string | null }>();
  const windows = await env.DB.prepare(`SELECT collection, window_from, window_to, synced_at, attempted_at, last_error
    FROM health_sync_windows WHERE user_id=? ORDER BY attempted_at DESC`).bind(userId)
    .all<WindowState & { collection: string; window_from: string; window_to: string }>();
  const denied = collectionAccess(windows.results);
  return HEALTH_COLLECTIONS.map(spec => {
    const refusal = denied.find(row => row.collection === spec.name);
    const failures = refusal ? [] : windows.results.filter(row => row.collection === spec.name && row.last_error);
    return {
      ...spec, records: 0, earliest_day: null, latest_day: null,
      ...rows.results.find(row => row.collection === spec.name),
      last_attempt: windows.results.find(row => row.collection === spec.name) ?? null,
      access: {
        status: refusal ? "unavailable" : windows.results.some(row => row.collection === spec.name && row.synced_at) ? "available" : "unknown",
        automatic_retry: !refusal, code: refusal?.code ?? null, checked_at: refusal?.checked_at ?? null,
      },
      failed_windows: failures.length,
      failed_ranges: failures
        .map(row => ({ collection: spec.name, from: row.window_from, to: row.window_to, code: row.last_error })),
    };
  });
}
