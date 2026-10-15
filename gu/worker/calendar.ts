import type { Env } from "./types";
import { bodyJson, equal, hash, json, object, ValidationError } from "./lib";

export const CALENDAR_TIMEZONE = "Asia/Shanghai";
export const CALENDAR_MAX_AGE_MS = 6 * 3600_000;
const DAY_MS = 86400_000;
const MAX_BODY = 256 * 1024;

export type CalendarSource = {
  provider: "google_calendar";
  transport: "local_agent" | "connector";
  name: string;
};
export type CalendarWindow = { start: string; end: string };
export type CalendarTime = { date: string } | { date_time: string };
export type CalendarEvent = {
  id: string;
  title: string;
  start: CalendarTime;
  end: CalendarTime;
  status: "confirmed" | "tentative";
};
export type CalendarError = "authorization_required" | "authorization_revoked" |
  "permission_denied" | "fetch_failed" | "incomplete_result";
export type CalendarUpload = {
  schema_version: 1;
  calendar_id: string;
  timezone: typeof CALENDAR_TIMEZONE;
  attempted_at: string;
  source: CalendarSource;
  window: CalendarWindow;
  status: "success" | "failed" | "not_connected";
  complete: boolean;
  error_code: CalendarError | null;
  events: CalendarEvent[];
};
export type CalendarState = "not_connected" | "failed" | "empty" | "available" | "stale";
export type CalendarExecution = "unconfirmed" | "recorded_done" | "recorded_skipped" | "recorded_postponed";
export type CalendarView = {
  schema_version: 1;
  calendar_id: string | null;
  timezone: typeof CALENDAR_TIMEZONE;
  read_only: true;
  sustained_authorization: "unconfirmed";
  state: CalendarState;
  reason: string | null;
  expected_window: CalendarWindow;
  max_age_seconds: number;
  last_attempt: {
    attempted_at: string;
    received_at: string;
    status: CalendarUpload["status"];
    error_code: CalendarError | null;
    source: CalendarSource;
  } | null;
  last_success: { fetched_at: string; received_at: string } | null;
  snapshot: {
    fetched_at: string;
    received_at: string;
    source: CalendarSource;
    window: CalendarWindow;
    stale: boolean;
    stale_reason: "age" | "window_changed" | null;
    events: (CalendarEvent & { execution_status: CalendarExecution; actionable: boolean })[];
  } | null;
};

interface StoredCalendar {
  attempted_at: string;
  received_at: string;
  attempt_hash: string;
  attempt_payload: string;
  success_at: string | null;
  success_received_at: string | null;
  success_payload: string | null;
}

function configuredId(env: Env): string | null {
  const id = env.INVESTMENT_CALENDAR_ID;
  // Missing or redacted SSOT identifiers never enable a connection.
  return typeof id === "string" && id.length <= 512 && id.trim() === id &&
    id.length > 0 && id !== "primary" && !/[{}\s\u0000-\u001f\u007f]/.test(id) ? id : null;
}

export function calendarWindow(now: number): CalendarWindow {
  const date = new Date(now + 8 * 3600_000).toISOString().slice(0, 10);
  const end = new Date(Date.parse(`${date}T00:00:00+08:00`) + 4 * DAY_MS + 8 * 3600_000)
    .toISOString().slice(0, 10);
  return { start: `${date}T00:00:00+08:00`, end: `${end}T00:00:00+08:00` };
}

function keys(value: unknown, expected: string[]): value is Record<string, unknown> {
  return object(value) && Object.keys(value).sort().join() === [...expected].sort().join();
}

function text(value: unknown, max: number): value is string {
  return typeof value === "string" && value.length > 0 && value.trim() === value &&
    value.length <= max && !/[\u0000-\u001f\u007f]/.test(value);
}

function day(value: unknown): value is string {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;
}

function instant(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const m = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,3}))?(Z|([+-])(\d{2}):(\d{2}))$/.exec(value);
  return !!m && day(m[1]) && Number(m[2]) < 24 && Number(m[3]) < 60 && Number(m[4]) < 60 &&
    (!m[8] || (Number(m[8]) <= 14 && Number(m[9]) < 60 && (Number(m[8]) < 14 || Number(m[9]) === 0))) &&
    Number.isFinite(Date.parse(value));
}

function eventTime(value: unknown): value is CalendarTime {
  return (keys(value, ["date"]) && day(value.date)) ||
    (keys(value, ["date_time"]) && instant(value.date_time));
}

function timeValue(value: CalendarTime): number {
  return Date.parse("date" in value ? `${value.date}T00:00:00+08:00` : value.date_time);
}

export function validateCalendar(value: unknown, calendarId: string, now = Date.now()): asserts value is CalendarUpload {
  if (!keys(value, ["schema_version", "calendar_id", "timezone", "attempted_at", "source",
    "window", "status", "complete", "error_code", "events"]) ||
    value.schema_version !== 1 || value.calendar_id !== calendarId || value.timezone !== CALENDAR_TIMEZONE) {
    throw new ValidationError("日历快照格式、固定日历或时区无效");
  }
  if (!instant(value.attempted_at) || Date.parse(value.attempted_at) > now ||
    now - Date.parse(value.attempted_at) >= CALENDAR_MAX_AGE_MS) {
    throw new ValidationError("日历尝试时间无效、超前或已过期");
  }
  const window = calendarWindow(now);
  if (!keys(value.window, ["start", "end"]) ||
    value.window.start !== window.start || value.window.end !== window.end ||
    calendarWindow(Date.parse(value.attempted_at)).start !== window.start) {
    throw new ValidationError("查询范围必须是北京时间当天及未来三天");
  }
  if (!keys(value.source, ["provider", "transport", "name"]) ||
    value.source.provider !== "google_calendar" ||
    (value.source.transport !== "local_agent" && value.source.transport !== "connector") ||
    !text(value.source.name, 80)) throw new ValidationError("日历来源无效");
  if (!Array.isArray(value.events) || value.events.length > 500) throw new ValidationError("日历事件数量无效");
  if (value.status === "success") {
    if (value.complete !== true || value.error_code !== null) throw new ValidationError("成功快照必须完整且无错误");
  } else if (value.status === "failed" || value.status === "not_connected") {
    const errors = value.status === "failed" ? ["permission_denied", "fetch_failed", "incomplete_result"] :
      ["authorization_required", "authorization_revoked"];
    if (value.complete !== false || typeof value.error_code !== "string" ||
      !errors.includes(value.error_code) || value.events.length) {
      throw new ValidationError("失败或未连接状态必须带错误代码且无事件");
    }
  } else throw new ValidationError("日历同步状态无效");
  const ids = new Set<string>();
  for (const event of value.events) {
    if (!keys(event, ["id", "title", "start", "end", "status"]) ||
      !text(event.id, 512) || !text(event.title, 500) ||
      (event.status !== "confirmed" && event.status !== "tentative") ||
      !eventTime(event.start) || !eventTime(event.end) ||
      ("date" in event.start) !== ("date" in event.end)) throw new ValidationError("日历事件格式无效");
    const start = timeValue(event.start);
    const end = timeValue(event.end);
    if (ids.has(event.id) || end <= start || start >= Date.parse(window.end) || end <= Date.parse(window.start)) {
      throw new ValidationError("日历事件重复、时间无效或未与查询窗口相交");
    }
    ids.add(event.id);
  }
}

function execution(title: string): CalendarExecution {
  if (title.startsWith("✅")) return "recorded_done";
  if (title.startsWith("⏸")) return "recorded_skipped";
  if (title.startsWith("🔄")) return "recorded_postponed";
  return "unconfirmed";
}

export async function syncCalendar(request: Request, env: Env) {
  const provided = request.headers.get("Authorization")?.match(/^Bearer (.+)$/)?.[1];
  if (!env.UPLOAD_TOKEN || !provided || !equal(await hash(provided), await hash(env.UPLOAD_TOKEN))) {
    return json({ error: "同步凭证无效" }, 401);
  }
  const calendarId = configuredId(env);
  if (!calendarId) return json({ error: "固定投资日历尚未配置", code: "calendar_not_configured" }, 503);
  const input = await bodyJson(request, MAX_BODY);
  const now = Date.now();
  validateCalendar(input, calendarId, now);
  const payload = JSON.stringify(input);
  const digest = await hash(payload);
  const attempted = new Date(input.attempted_at).toISOString();
  const received = new Date(now).toISOString();
  const success = input.status === "success";
  // One conditional statement orders all attempts and keeps the last successful snapshot atomically.
  const db = env.DB.withSession("first-primary");
  const written = await db.prepare(`INSERT INTO calendar_sync_state
    (singleton, calendar_id, attempted_at, received_at, attempt_hash, attempt_payload,
     success_at, success_received_at, success_payload)
    VALUES (1, ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)
    ON CONFLICT(singleton) DO UPDATE SET
      attempted_at = excluded.attempted_at, received_at = excluded.received_at,
      attempt_hash = excluded.attempt_hash, attempt_payload = excluded.attempt_payload,
      success_at = COALESCE(excluded.success_at, calendar_sync_state.success_at),
      success_received_at = COALESCE(excluded.success_received_at, calendar_sync_state.success_received_at),
      success_payload = COALESCE(excluded.success_payload, calendar_sync_state.success_payload)
    WHERE calendar_sync_state.calendar_id = excluded.calendar_id
      AND calendar_sync_state.attempted_at < excluded.attempted_at
    RETURNING received_at`).bind(calendarId, attempted, received, digest, payload,
      success ? attempted : null, success ? received : null, success ? payload : null).first<{ received_at: string }>();
  if (written) return json({ ok: true, attempted_at: attempted, received_at: written.received_at, idempotent: false });
  const current = await db.prepare("SELECT attempt_hash, received_at FROM calendar_sync_state WHERE singleton = 1 AND calendar_id = ?")
    .bind(calendarId).first<{ attempt_hash: string; received_at: string }>();
  if (current?.attempt_hash === digest) {
    return json({ ok: true, attempted_at: attempted, received_at: current.received_at, idempotent: true });
  }
  return json({ error: "已有更新或同时间的不同日历尝试，未替换当前数据", code: "stale_calendar_attempt" }, 409);
}

export async function calendar(env: Env) {
  const now = Date.now();
  const calendarId = configuredId(env);
  const result: CalendarView = {
    schema_version: 1, calendar_id: calendarId, timezone: CALENDAR_TIMEZONE,
    read_only: true, sustained_authorization: "unconfirmed",
    state: "not_connected", reason: calendarId ? "no_snapshot" : "calendar_not_configured",
    expected_window: calendarWindow(now), max_age_seconds: CALENDAR_MAX_AGE_MS / 1000,
    last_attempt: null, last_success: null, snapshot: null,
  };
  if (!calendarId) return json(result);
  const row = await env.DB.withSession("first-primary").prepare("SELECT * FROM calendar_sync_state WHERE singleton = 1 AND calendar_id = ?")
    .bind(calendarId).first<StoredCalendar>();
  if (!row) return json(result);
  const attempt: CalendarUpload = JSON.parse(row.attempt_payload);
  result.last_attempt = {
    attempted_at: row.attempted_at, received_at: row.received_at, status: attempt.status,
    error_code: attempt.error_code, source: attempt.source,
  };
  if (row.success_payload && row.success_at && row.success_received_at) {
    const snapshot: CalendarUpload = JSON.parse(row.success_payload);
    const staleReason = snapshot.window.start !== result.expected_window.start ? "window_changed" :
      now - Date.parse(row.success_at) >= CALENDAR_MAX_AGE_MS ? "age" : null;
    result.last_success = { fetched_at: row.success_at, received_at: row.success_received_at };
    result.snapshot = {
      ...result.last_success, source: snapshot.source, window: snapshot.window,
      stale: staleReason !== null, stale_reason: staleReason,
      events: snapshot.events.map(event => ({
        ...event, execution_status: execution(event.title), actionable: execution(event.title) === "unconfirmed",
      })).sort((a, b) => timeValue(a.start) - timeValue(b.start) || a.id.localeCompare(b.id)),
    };
  }
  result.state = attempt.status === "not_connected" ? "not_connected" : attempt.status === "failed" ? "failed" :
    result.snapshot?.stale ? "stale" : result.snapshot?.events.length ? "available" : "empty";
  result.reason = attempt.error_code ?? result.snapshot?.stale_reason ?? null;
  return json(result);
}
