import { createHash } from "node:crypto";
import { buildNotificationEmail, notificationSender } from "@kedoupi/shared/email/notification";
import { validateNotifyEvent, NotifyValidationError, type NotifyEvent } from "@kedoupi/shared/notify/contract";
import { findRule, RPC_SOURCE, type NotifyRule } from "./rules.ts";

export interface D1Result<T = Record<string, unknown>> { results: T[]; success?: boolean; meta?: Record<string, unknown>; }
export interface D1Statement { bind(...values: unknown[]): D1Statement; first<T = Record<string, unknown>>(): Promise<T | null>; all<T = Record<string, unknown>>(): Promise<D1Result<T>>; run(): Promise<D1Result>; }
export interface Database { prepare(query: string): D1Statement; batch?(statements: D1Statement[]): Promise<D1Result[]>; }
export interface EmailBinding { send(message: Record<string, unknown>): Promise<{ messageId?: string; id?: string } | void>; }
export interface Env {
  DB: Database;
  EMAIL: EmailBinding;
  NOTIFY_TO?: string;
  NOTIFY_FROM?: string;
  ENVIRONMENT?: string;
  BUILD_SHA?: string;
}

const MAX_BODY_BYTES = 16 * 1024;
const RETRYABLE = new Set(["E_RATE_LIMIT_EXCEEDED", "E_DELIVERY_FAILED", "E_INTERNAL_SERVER_ERROR"]);
const RETRY_MINUTES = [5, 15, 60];
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json; charset=utf-8" } });
const nowIso = () => new Date().toISOString();
const incidentKey = (event: NotifyEvent) => `${event.source}:${event.kind}:${event.subject}`;

export function retryAt(errorCode: string, attempts: number, now = Date.now()): string | null {
  if (!RETRYABLE.has(errorCode) || attempts >= 4) return null;
  const minutes = RETRY_MINUTES[Math.min(attempts, RETRY_MINUTES.length - 1)];
  return new Date(now + minutes * 60 * 1000).toISOString();
}

export function isQuietHours(date = new Date()): boolean {
  const hour = Number(new Intl.DateTimeFormat("en-US", { timeZone: "Asia/Shanghai", hour: "2-digit", hour12: false }).format(date));
  return hour >= 23 || hour < 8;
}
function quietEnd(now = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", hour12: false }).formatToParts(now);
  const values = Object.fromEntries(parts.filter(part => part.type !== "literal").map(part => [part.type, part.value]));
  const date = `${values.year}-${values.month}-${values.day}`;
  const hour = Number(values.hour);
  const end = new Date(`${date}T08:00:00+08:00`);
  if (hour >= 8 && hour < 23) return end.toISOString();
  if (hour >= 23) end.setUTCDate(end.getUTCDate() + 1);
  return end.toISOString();
}

export interface Decision { decision: string; shouldSend: boolean; reason: string; }
export function decideNotification(event: NotifyEvent, rule: NotifyRule, incident: { status?: string; firstSeen?: string; lastNotificationAt?: string | null; pendingUntil?: string | null } | null, now = Date.now()): Decision {
  if (rule.mode === "record") return { decision: "record", shouldSend: false, reason: "record_only" };
  if (event.state === "resolved") {
    if (!incident || incident.status !== "open" || !rule.notifyResolved) return { decision: "resolved", shouldSend: false, reason: "resolved_without_notification" };
    if (incident.pendingUntil && Date.parse(incident.pendingUntil) > now) return { decision: "resolved", shouldSend: false, reason: "resolved_before_for" };
    return { decision: "send_resolved", shouldSend: true, reason: "resolved" };
  }
  if (rule.forMs > 0 && incident?.firstSeen && now - Date.parse(incident.firstSeen) < rule.forMs) return { decision: "deferred_for", shouldSend: false, reason: "for_not_elapsed" };
  if (rule.cooldownMs && incident?.lastNotificationAt) {
    if (now - Date.parse(incident.lastNotificationAt) < rule.cooldownMs) return { decision: "cooled_down", shouldSend: false, reason: "cooldown" };
    return { decision: rule.mode === "immediate" ? "send_immediate" : "send_alert", shouldSend: true, reason: "cooldown_elapsed" };
  }
  if (rule.quiet === "defer" && event.severity === "warning" && isQuietHours(new Date(now))) return { decision: "deferred_quiet", shouldSend: false, reason: "quiet_hours" };
  return { decision: rule.mode === "immediate" ? "send_immediate" : "send_alert", shouldSend: true, reason: "rule_matched" };
}

function eventFromRow(row: Record<string, unknown>): NotifyEvent {
  return {
    schema: "notify.event/v1",
    event_id: String(row.event_id), source: String(row.source), kind: String(row.kind), subject: String(row.subject),
    state: String(row.state) as NotifyEvent["state"], severity: String(row.severity) as NotifyEvent["severity"],
    occurred_at: String(row.occurred_at), title: String(row.title),
    ...(row.summary ? { summary: String(row.summary) } : {}),
    ...(row.facts_json ? { facts: JSON.parse(String(row.facts_json)) } : {}),
    ...(row.link ? { link: String(row.link) } : {}),
  };
}

async function findExisting(env: Env, eventId: string) {
  return env.DB.prepare("SELECT * FROM events WHERE event_id = ?1").bind(eventId).first<Record<string, unknown>>();
}
async function incident(env: Env, key: string) {
  return env.DB.prepare("SELECT * FROM incidents WHERE incident_key = ?1").bind(key).first<Record<string, unknown>>();
}
function rowIncident(row: Record<string, unknown> | null) {
  if (!row) return null;
  return { status: String(row.status), firstSeen: String(row.first_seen), lastNotificationAt: row.last_notification_at ? String(row.last_notification_at) : null, pendingUntil: row.pending_until ? String(row.pending_until) : null };
}

async function insertEvent(env: Env, event: NotifyEvent, key: string, decision: string) {
  const result = await env.DB.prepare("INSERT OR IGNORE INTO events (event_id, source, kind, subject, state, severity, occurred_at, title, summary, facts_json, link, incident_key, decision) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13)")
    .bind(event.event_id, event.source, event.kind, event.subject, event.state, event.severity, event.occurred_at, event.title, event.summary ?? null, event.facts ? JSON.stringify(event.facts) : null, event.link ?? null, key, decision).run();
  return Number(result.meta?.changes ?? 0) > 0;
}

async function upsertIncident(env: Env, event: NotifyEvent, key: string, decision: Decision) {
  const current = await incident(env, key);
  const now = nowIso();
  if (!current) {
    await env.DB.prepare("INSERT INTO incidents (incident_key, source, kind, subject, status, first_seen, last_seen, event_count, pending_until) VALUES (?1,?2,?3,?4,?5,?6,?6,1,?7)")
      .bind(key, event.source, event.kind, event.subject, event.state === "resolved" ? "closed" : "open", event.occurred_at, decision.decision === "deferred_for" ? new Date(Date.parse(event.occurred_at) + (findRule(event.source, event.kind)?.forMs ?? 0)).toISOString() : null).run();
    return;
  }
  const status = event.state === "resolved" ? "closed" : "open";
  await env.DB.prepare("UPDATE incidents SET last_seen = ?1, event_count = event_count + 1, status = ?2, closed_at = CASE WHEN ?2 = 'closed' THEN ?1 ELSE closed_at END, pending_until = CASE WHEN ?2 = 'closed' THEN NULL ELSE pending_until END WHERE incident_key = ?3")
    .bind(now, status, key).run();
}

async function reserveQuota(env: Env, now = new Date()): Promise<{ allowed: boolean; omitted: number }> {
  const day = now.toISOString().slice(0, 10);
  const hour = now.toISOString().slice(0, 13);
  const dayRow = await env.DB.prepare("SELECT day_count FROM quota WHERE bucket = ?1").bind(day).first<{ day_count: number }>();
  const hourRow = await env.DB.prepare("SELECT hour_count FROM quota WHERE bucket = ?1").bind(hour).first<{ hour_count: number }>();
  const dayCount = Number(dayRow?.day_count ?? 0);
  const hourCount = Number(hourRow?.hour_count ?? 0);
  if (dayCount >= 20 || hourCount >= 6) return { allowed: false, omitted: 1 };
  const update = (bucket: string, field: "day_count" | "hour_count") => env.DB.prepare(`INSERT INTO quota (bucket, ${field}) VALUES (?1, 1) ON CONFLICT(bucket) DO UPDATE SET ${field} = ${field} + 1, updated_at = datetime('now')`).bind(bucket);
  const statements = [update(day, "day_count"), update(hour, "hour_count")];
  if (env.DB.batch) await env.DB.batch(statements);
  else for (const statement of statements) await statement.run();
  return { allowed: true, omitted: 0 };
}

export async function deliver(env: Env, event: NotifyEvent, incidentId: string, deliveryId?: number, attempts = 0) {
  if (!env.NOTIFY_TO) {
    if (deliveryId !== undefined) await env.DB.prepare("UPDATE deliveries SET status = 'failed', error_code = 'E_RECIPIENT_NOT_ALLOWED' WHERE id = ?1").bind(deliveryId).run();
    return { status: "failed", error_code: "E_RECIPIENT_NOT_ALLOWED" };
  }
  const email = buildNotificationEmail({ event, incidentId, reason: "这是统一通知服务根据事件规则生成的提醒。" });
  try {
    const result = await env.EMAIL.send({ to: env.NOTIFY_TO, from: notificationSender(env.NOTIFY_FROM), subject: email.subject, text: email.text, html: email.html });
    const messageId = result && ("messageId" in result ? result.messageId : result.id);
    if (deliveryId !== undefined) await env.DB.prepare("UPDATE deliveries SET status = 'sent', sent_at = ?1, message_id = ?2, attempts = attempts + 1 WHERE id = ?3").bind(nowIso(), messageId ?? null, deliveryId).run();
    return { status: "sent", message_id: messageId };
  } catch (error) {
    const code = typeof error === "object" && error && "code" in error ? String(error.code) : "E_DELIVERY_FAILED";
    const retryAtValue = retryAt(code, attempts);
    if (deliveryId !== undefined) await env.DB.prepare("UPDATE deliveries SET status = ?1, error_code = ?2, next_attempt_at = ?3, attempts = attempts + 1 WHERE id = ?4").bind(retryAtValue ? "pending" : "failed", code, retryAtValue, deliveryId).run();
    return { status: retryAtValue ? "pending" : "failed", error_code: code, next_attempt_at: retryAtValue };
  }
}

export async function ingest(input: unknown, env: Env, fixedSource?: string) {
  let event: NotifyEvent;
  try { event = validateNotifyEvent(input); } catch (error) { throw error; }
  if (fixedSource && event.source !== fixedSource) throw Object.assign(new Error("source_not_allowed"), { code: "E_SOURCE_NOT_ALLOWED", status: 403 });
  const rule = findRule(event.source, event.kind);
  if (!rule) throw Object.assign(new Error("kind_not_allowed"), { code: "E_KIND_NOT_ALLOWED", status: 403 });
  const existing = await findExisting(env, event.event_id);
  if (existing) return { event_id: event.event_id, decision: String(existing.decision), duplicate: true };
  const key = incidentKey(event);
  const current = await incident(env, key);
  const decision = decideNotification(event, rule, rowIncident(current));
  await insertEvent(env, event, key, decision.decision);
  await upsertIncident(env, event, key, decision);
  if (!decision.shouldSend && decision.reason === "quiet_hours") {
    const notificationNo = Number(current?.event_count ?? 0) + 1;
    await env.DB.prepare("INSERT OR IGNORE INTO deliveries (event_id, incident_key, notification_no, status, next_attempt_at) VALUES (?1,?2,?3,'pending',?4)").bind(event.event_id, key, notificationNo, quietEnd()).run();
  }
  if (!decision.shouldSend) return { event_id: event.event_id, decision: decision.decision, duplicate: false };
  const quota = await reserveQuota(env);
  if (!quota.allowed) return { event_id: event.event_id, decision: "quota_deferred", duplicate: false, omitted: quota.omitted };
  const notificationNo = Number(current?.event_count ?? 0) + 1;
  const delivery = await env.DB.prepare("INSERT OR IGNORE INTO deliveries (event_id, incident_key, notification_no, status) VALUES (?1,?2,?3,'pending') RETURNING id")
    .bind(event.event_id, key, notificationNo).first<{ id: number }>();
  const deliveryEvent = decision.reason === "cooldown_elapsed" ? { ...event, title: `${event.title}，仍未恢复` } : event;
  const result = rule.mode === "immediate" ? await deliver(env, deliveryEvent, key, delivery?.id) : { status: "pending" };
  if (result.status === "sent") await env.DB.prepare("UPDATE incidents SET last_notification_at = ?1 WHERE incident_key = ?2").bind(nowIso(), key).run();
  return { event_id: event.event_id, decision: decision.decision, duplicate: false, delivery: result.status, ...(result.message_id ? { message_id: result.message_id } : {}) };
}

async function readToken(env: Env, request: Request) {
  const header = request.headers.get("authorization") ?? "";
  if (!header.startsWith("Bearer ")) return null;
  const token = header.slice(7).trim();
  if (!token || token.length > 256) return null;
  const hash = createHash("sha256").update(token).digest("hex");
  return env.DB.prepare("SELECT source, kinds_json FROM producer_tokens WHERE token_hash = ?1 AND revoked_at IS NULL").bind(hash).first<{ source: string; kinds_json: string }>();
}

async function parseBody(request: Request) {
  const length = Number(request.headers.get("content-length") ?? 0);
  if (length > MAX_BODY_BYTES) throw Object.assign(new Error("request_too_large"), { status: 413 });
  const bytes = await request.arrayBuffer();
  if (bytes.byteLength > MAX_BODY_BYTES) throw Object.assign(new Error("request_too_large"), { status: 413 });
  if (!request.headers.get("content-type")?.toLowerCase().includes("application/json")) throw new NotifyValidationError("content-type must be application/json");
  try { return JSON.parse(new TextDecoder().decode(bytes)); } catch { throw new NotifyValidationError("invalid JSON"); }
}

async function route(request: Request, env: Env) {
  const url = new URL(request.url);
  if (url.hostname !== "notify-api.codepi.app") return json({ error: "not_found" }, 404);
  if (request.method === "POST" && url.pathname === "/v1/events") {
    const token = await readToken(env);
    if (!token) return json({ error: "unauthorized" }, 401);
    let body: unknown;
    try { body = await parseBody(request); } catch (error) { return json({ error: error instanceof Error ? error.message : "invalid_request" }, (error as { status?: number }).status ?? 400); }
    let event: NotifyEvent;
    try { event = validateNotifyEvent(body); } catch (error) { return json({ error: error instanceof Error ? error.message : "invalid_event" }, 400); }
    let kinds: unknown;
    try { kinds = JSON.parse(token.kinds_json); } catch { return json({ error: "token_invalid" }, 401); }
    if (event.source !== token.source || !Array.isArray(kinds) || !kinds.includes(event.kind)) return json({ error: "forbidden" }, 403);
    try { return json(await ingest(event, env)); } catch (error) { return json({ error: error instanceof Error ? error.message : "internal_error" }, (error as { status?: number }).status ?? 500); }
  }
  if (request.method === "GET" && /^\/v1\/events\/[^/]+$/.test(url.pathname)) {
    const token = await readToken(env);
    if (!token) return json({ error: "unauthorized" }, 401);
    const eventId = decodeURIComponent(url.pathname.slice("/v1/events/".length));
    const event = await env.DB.prepare("SELECT event_id, source, kind, subject, state, severity, occurred_at, title, summary, facts_json, link, decision FROM events WHERE event_id = ?1 AND source = ?2").bind(eventId, token.source).first<Record<string, unknown>>();
    if (!event) return json({ error: "not_found" }, 404);
    const deliveries = await env.DB.prepare("SELECT id, event_id, incident_key, notification_no, channel, status, attempts, next_attempt_at, error_code, message_id, created_at, sent_at FROM deliveries WHERE event_id = ?1 ORDER BY id").bind(eventId).all();
    return json({ event: eventFromRow(event), decision: event.decision, deliveries: deliveries.results });
  }
  return json({ error: "not_found" }, 404);
}

export class NotifyApi {
  constructor(private readonly env: Env) {}
  emit(event: NotifyEvent) { return ingest(event, this.env, RPC_SOURCE); }
}

export default {
  fetch(request: Request, env: Env) { return route(request, env); },
  async scheduled(_controller: ScheduledController, env: Env) {
    const pending = await env.DB.prepare("SELECT d.id, d.attempts, e.event_id, e.source, e.kind, e.subject, e.state, e.severity, e.occurred_at, e.title, e.summary, e.facts_json, e.link, d.incident_key FROM deliveries d JOIN events e ON e.event_id = d.event_id WHERE d.status = 'pending' AND (d.next_attempt_at IS NULL OR d.next_attempt_at <= ?1) ORDER BY d.id LIMIT 50").bind(nowIso()).all<Record<string, unknown>>();
    for (const row of pending.results) await deliver(env, eventFromRow(row), String(row.incident_key), Number(row.id), Number(row.attempts ?? 0));
  },
} satisfies ExportedHandler<Env>;
