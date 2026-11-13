import { WorkerEntrypoint } from "cloudflare:workers";
import { buildFeishuCard, feishuKindLabel } from "@kedoupi/shared/email/notification";
import { validateNotifyEvent, NotifyValidationError, type NotifyEvent } from "@kedoupi/shared/notify/contract";
import { findRule, RPC_SOURCE } from "./rules.ts";
import { decideNotification, retryAt, type Decision } from "./decision.ts";
import { sendEmail } from "./channels/email.ts";
import { sendFeishu } from "./channels/feishu.ts";
export { decideNotification, retryAt } from "./decision.ts";

export interface D1Result<T = Record<string, unknown>> { results: T[]; success?: boolean; meta?: Record<string, unknown>; }
export interface D1Statement { bind(...values: unknown[]): D1Statement; first<T = Record<string, unknown>>(): Promise<T | null>; all<T = Record<string, unknown>>(): Promise<D1Result<T>>; run(): Promise<D1Result>; }
export interface Database { prepare(query: string): D1Statement; batch?(statements: D1Statement[]): Promise<D1Result[]>; }
export interface EmailBinding { send(message: Record<string, unknown>): Promise<{ messageId?: string; id?: string } | void>; }
export interface Env {
  DB: Database;
  EMAIL: EmailBinding;
  NOTIFY_TO?: string;
  NOTIFY_FROM?: string;
  FEISHU_APP_ID?: string;
  FEISHU_APP_SECRET?: string;
  FEISHU_RECEIVE_OPEN_ID?: string;
  ENVIRONMENT?: string;
  BUILD_SHA?: string;
}

type Channel = "feishu" | "email";
type DeliveryStatus = "pending" | "sent" | "failed" | "cancelled";
type ChannelStatus = "pending" | "sent" | "failed" | "skipped" | "cancelled";
interface DeliveryData {
  id: number;
  attempts: number;
  [key: string]: unknown;
  status: DeliveryStatus;
  notification_type: string;
  event_id: string;
  incident_key: string;
  state: string;
  severity: string;
  source: string;
  kind: string;
  subject: string;
  occurred_at: string;
  title: string;
  summary?: string | null;
  facts_json?: string | null;
  link?: string | null;
}
interface ChannelAttempt {
  id: number;
  delivery_id: number;
  channel: Channel;
  status: ChannelStatus;
  attempts: number;
  next_attempt_at?: string | null;
  error_code?: string | null;
  message_id?: string | null;
  sent_at?: string | null;
}

const MAX_BODY_BYTES = 16 * 1024;
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json; charset=utf-8" } });
const nowIso = () => new Date().toISOString();
const incidentKey = (event: NotifyEvent) => `${event.source}:${event.kind}:${event.subject}`;
const placeholders = (count: number, offset = 0) => Array.from({ length: count }, (_, index) => `?${index + offset + 1}`).join(",");
const errorCode = (error: unknown) => typeof error === "object" && error && "code" in error ? String(error.code) : "E_DELIVERY_FAILED";
const codedError = (code: string, status = 500) => Object.assign(new Error(code), { code, status });

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
function deliveryEventFromRow(row: Record<string, unknown>): NotifyEvent {
  const event = eventFromRow(row);
  if (row.notification_type === "repeat") return { ...event, title: `${event.title}，仍未恢复` };
  return event;
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

// `for` is measured from the episode's first_seen; a new or reopened episode starts at this event's occurred_at.
function pendingUntilFrom(event: NotifyEvent, firstSeen: string, decision: Decision) {
  if (decision.decision !== "deferred_for") return null;
  return new Date(Date.parse(firstSeen) + (findRule(event.source, event.kind)?.forMs ?? 0)).toISOString();
}

async function cancelChannelAttempts(env: Env, key: string, code: string, excludeResolved = false) {
  const resolvedClause = excludeResolved ? " AND notification_type <> 'resolved'" : "";
  await env.DB.prepare(`UPDATE channel_attempts SET status = 'cancelled', error_code = ?1, next_attempt_at = NULL WHERE delivery_id IN (SELECT id FROM deliveries WHERE incident_key = ?2${resolvedClause}) AND status = 'pending'`).bind(code, key).run();
}
async function upsertIncident(env: Env, event: NotifyEvent, key: string, decision: Decision) {
  const current = await incident(env, key);
  const now = nowIso();
  if (!current) {
    await env.DB.prepare("INSERT INTO incidents (incident_key, source, kind, subject, status, first_seen, last_seen, event_count, pending_until) VALUES (?1,?2,?3,?4,?5,?6,?6,1,?7)")
      .bind(key, event.source, event.kind, event.subject, event.state === "resolved" ? "closed" : "open", event.occurred_at, pendingUntilFrom(event, event.occurred_at, decision)).run();
    return;
  }
  const status = event.state === "resolved" ? "closed" : "open";
  if (current.status !== "open" && status === "open") {
    // A firing after recovery reopens the incident as a new episode: fresh first_seen, no cooldown carry-over,
    // and a recovery email that has not gone out yet is no longer true.
    await env.DB.prepare("UPDATE deliveries SET status = 'cancelled', error_code = 'E_REOPENED_BEFORE_SEND' WHERE incident_key = ?1 AND status = 'pending' AND notification_type = 'resolved'").bind(key).run();
    await cancelChannelAttempts(env, key, "E_REOPENED_BEFORE_SEND");
    const pendingUntil = pendingUntilFrom(event, event.occurred_at, decision);
    await env.DB.prepare("UPDATE incidents SET status = 'open', first_seen = ?1, last_seen = ?2, event_count = 1, last_notification_at = NULL, closed_at = NULL, pending_until = ?3 WHERE incident_key = ?4")
      .bind(event.occurred_at, now, pendingUntil, key).run();
    return;
  }
  const pendingUntil = status === "open" ? pendingUntilFrom(event, String(current.first_seen), decision) : null;
  await env.DB.prepare("UPDATE incidents SET last_seen = ?1, event_count = event_count + 1, status = ?2, closed_at = CASE WHEN ?2 = 'closed' THEN ?1 ELSE closed_at END, pending_until = ?3 WHERE incident_key = ?4")
    .bind(now, status, pendingUntil, key).run();
}

function beijingBuckets(now = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", hourCycle: "h23" }).formatToParts(now);
  const values = Object.fromEntries(parts.filter(part => part.type !== "literal").map(part => [part.type, part.value]));
  return { day: `day:${values.year}-${values.month}-${values.day}`, hour: `hour:${values.year}-${values.month}-${values.day}T${values.hour}` };
}
// Reserves one email in the Beijing day (≤20) and hour (≤6) buckets right before a real send.
async function reserveQuota(env: Env, now = new Date()): Promise<boolean> {
  const { day, hour } = beijingBuckets(now);
  const dayRow = await env.DB.prepare("INSERT INTO quota (bucket, day_count) VALUES (?1, 1) ON CONFLICT(bucket) DO UPDATE SET day_count = day_count + 1, updated_at = datetime('now') WHERE day_count < 20 RETURNING day_count").bind(day).first<{ day_count: number }>();
  if (!dayRow) return false;
  const hourRow = await env.DB.prepare("INSERT INTO quota (bucket, hour_count) VALUES (?1, 1) ON CONFLICT(bucket) DO UPDATE SET hour_count = hour_count + 1, updated_at = datetime('now') WHERE hour_count < 6 RETURNING hour_count").bind(hour).first<{ hour_count: number }>();
  if (!hourRow) {
    await env.DB.prepare("UPDATE quota SET day_count = day_count - 1 WHERE bucket = ?1").bind(day).run();
    return false;
  }
  return true;
}
async function addOmitted(env: Env, count: number) {
  if (count <= 0) return;
  await env.DB.prepare("INSERT INTO quota (bucket, omitted_count) VALUES (?1, ?2) ON CONFLICT(bucket) DO UPDATE SET omitted_count = omitted_count + ?2, updated_at = datetime('now')").bind(beijingBuckets().day, count).run();
}
// Each pending delivery denied by quota is counted as omitted at most once, however many Cron runs see it.
async function markOmitted(env: Env, deliveryIds: number[]) {
  if (!deliveryIds.length) return;
  const result = await env.DB.prepare(`UPDATE deliveries SET quota_omitted = 1 WHERE quota_omitted = 0 AND id IN (${placeholders(deliveryIds.length)})`).bind(...deliveryIds).run();
  await addOmitted(env, Number(result.meta?.changes ?? 0));
}

// Allocates the incident's next notification number atomically and writes the outbox row.
async function createDelivery(env: Env, eventId: string, key: string, notificationType: string, nextAttemptAt: string | null) {
  const counter = await env.DB.prepare("UPDATE incidents SET notification_count = notification_count + 1 WHERE incident_key = ?1 RETURNING notification_count").bind(key).first<{ notification_count: number }>();
  if (!counter) throw Object.assign(new Error("incident_missing"), { code: "E_INCIDENT_MISSING", status: 500 });
  const row = await env.DB.prepare("INSERT OR IGNORE INTO deliveries (event_id, incident_key, notification_no, notification_type, status, next_attempt_at) VALUES (?1,?2,?3,?4,'pending',?5) RETURNING id")
    .bind(eventId, key, Number(counter.notification_count), notificationType, nextAttemptAt).first<{ id: number }>();
  if (!row) throw Object.assign(new Error("delivery_conflict"), { code: "E_DELIVERY_CONFLICT", status: 500 });
  return Number(row.id);
}

export interface DeliveryRow { id: number; attempts: number; }
async function loadDeliveries(env: Env, ids: number[]) {
  if (!ids.length) return [];
  const rows = await env.DB.prepare(`SELECT d.id, d.status, d.attempts, d.notification_type, d.event_id, d.incident_key, e.state, e.severity, e.source, e.kind, e.subject, e.occurred_at, e.title, e.summary, e.facts_json, e.link FROM deliveries d JOIN events e ON e.event_id = d.event_id WHERE d.id IN (${placeholders(ids.length)}) ORDER BY d.id`).bind(...ids).all<DeliveryData>();
  return rows.results;
}
async function getChannelAttempt(env: Env, deliveryId: number, channel: Channel) {
  return env.DB.prepare("SELECT id, delivery_id, channel, status, attempts, next_attempt_at, error_code, message_id, sent_at FROM channel_attempts WHERE delivery_id = ?1 AND channel = ?2").bind(deliveryId, channel).first<ChannelAttempt>();
}
async function ensureChannelAttempt(env: Env, deliveryId: number, channel: Channel, inheritDeliveryAttempts = false) {
  await env.DB.prepare("INSERT OR IGNORE INTO channel_attempts (delivery_id, channel, status, attempts) SELECT ?1, ?2, 'pending', CASE WHEN ?3 = 1 THEN attempts ELSE 0 END FROM deliveries WHERE id = ?1 AND status <> 'cancelled'").bind(deliveryId, channel, inheritDeliveryAttempts ? 1 : 0).run();
  return getChannelAttempt(env, deliveryId, channel);
}
// Re-read immediately before provider send; sent deliveries may still have a pending channel retry.
async function claimDelivery(env: Env, deliveryId: number) {
  const result = await env.DB.prepare("UPDATE deliveries SET status = CASE WHEN status = 'sent' THEN 'sent' ELSE 'pending' END WHERE id = ?1 AND status <> 'cancelled'").bind(deliveryId).run();
  return Number(result.meta?.changes ?? 0) > 0;
}
async function hasChannelAttempts(env: Env, deliveryId: number) {
  const row = await env.DB.prepare("SELECT COUNT(*) AS count FROM channel_attempts WHERE delivery_id = ?1").bind(deliveryId).first<{ count: number }>();
  return Number(row?.count ?? 0) > 0;
}
async function successfulChannels(env: Env, key: string) {
  const rows = await env.DB.prepare("SELECT DISTINCT ca.channel FROM channel_attempts ca WHERE ca.delivery_id = (SELECT d.id FROM deliveries d JOIN events e ON e.event_id = d.event_id JOIN incidents i ON i.incident_key = d.incident_key WHERE d.incident_key = ?1 AND d.notification_type = 'first' AND julianday(e.occurred_at) >= julianday(i.first_seen) ORDER BY d.id DESC LIMIT 1) AND ca.status = 'sent'").bind(key).all<{ channel: Channel }>();
  return rows.results.map(row => row.channel);
}
function baseRoute(row: DeliveryData): Channel[] {
  if (row.kind === "notify.selftest") return ["feishu", "email"];
  if (row.severity === "critical") return ["feishu", "email"];
  return ["feishu"];
}
async function routeForDelivery(env: Env, row: DeliveryData) {
  const current = row.notification_type === "resolved" || row.notification_type === "repeat" ? await incident(env, row.incident_key) : null;
  let route = current ? await successfulChannels(env, row.incident_key) : baseRoute(row);
  if (!route.length) route = baseRoute(row);
  return [...new Set(route)];
}
function isDue(attempt: ChannelAttempt | null) {
  if (!attempt || attempt.status !== "pending") return false;
  return !attempt.next_attempt_at || Date.parse(attempt.next_attempt_at) <= Date.now();
}
async function markFeishuSkipped(env: Env, rows: DeliveryData[]) {
  for (const row of rows) {
    await ensureChannelAttempt(env, row.id, "feishu");
    await env.DB.prepare("UPDATE channel_attempts SET status = 'skipped', error_code = 'E_FEISHU_NOT_CONFIGURED', next_attempt_at = NULL WHERE delivery_id = ?1 AND channel = 'feishu' AND status = 'pending'").bind(row.id).run();
  }
}
function mergeChannelEvent(event: NotifyEvent, rows: DeliveryData[]) {
  if (rows.length === 1) return deliveryEventFromRow(rows[0]);
  const rank: Record<string, number> = { info: 0, warning: 1, critical: 2 };
  const firing = rows.filter(row => row.state !== "resolved");
  const leaders = firing.length ? firing : rows;
  const lead = leaders.reduce((best, row) => rank[row.severity] > rank[best.severity] ? row : best, leaders[0]);
  return {
    ...deliveryEventFromRow(lead),
    kind: "notify.merged",
    title: `${rows.length} 条提醒${rows.some(row => row.notification_type === "repeat") ? "，仍未恢复" : ""}`,
    summary: rows.map(row => row.title).join("；").slice(0, 500),
    facts: rows.slice(0, 12).map(row => ({ label: feishuKindLabel(row.kind), value: row.title })),
  };
}
async function sendChannel(env: Env, channel: Channel, rows: DeliveryData[], event: NotifyEvent, incidentId: string) {
  const due: DeliveryData[] = [];
  for (const row of rows) {
    const attempt = await ensureChannelAttempt(env, row.id, channel);
    if (isDue(attempt)) due.push(row);
  }
  if (!due.length) return { status: "idle" as const };
  const ready: DeliveryData[] = [];
  for (const row of due) if (await claimDelivery(env, row.id)) ready.push(row);
  if (!ready.length) return { status: "idle" as const };
  const ids = ready.map(row => row.id);
  const merged = mergeChannelEvent(event, ready);
  const omittedRow = await env.DB.prepare("SELECT omitted_count FROM quota WHERE bucket = ?1").bind(beijingBuckets().day).first<{ omitted_count: number }>();
  const omitted = Number(omittedRow?.omitted_count ?? 0);
  const reason = omitted > 0 ? `有 ${omitted} 条提醒因限额未单独发送。` : undefined;
  let messageId: string | undefined;
  try {
    if (channel === "feishu") messageId = await sendFeishu(env, buildFeishuCard({ event: merged, incidentId, reason }), `notify-${Math.min(...ids)}`);
    else messageId = await sendEmail(env, { event: merged, incidentId, reason });
  } catch (error) {
    const code = errorCode(error);
    console.error(JSON.stringify({ channel, error_code: code }));
    if (channel === "feishu" && code === "E_FEISHU_NOT_CONFIGURED") {
      await markFeishuSkipped(env, ready);
      return { status: "skipped" as const, code };
    }
    let pending = 0;
    let final = 0;
    for (const row of ready) {
      const attempt = await getChannelAttempt(env, row.id, channel);
      const attempts = Number(attempt?.attempts ?? 0);
      const next = retryAt(code, attempts);
      if (next) pending += 1;
      else final += 1;
      await env.DB.prepare("UPDATE channel_attempts SET status = ?1, attempts = attempts + 1, next_attempt_at = ?2, error_code = ?3 WHERE delivery_id = ?4 AND channel = ?5 AND status <> 'cancelled'")
        .bind(next ? "pending" : "failed", next, code, row.id, channel).run();
    }
    return { status: pending ? "pending" as const : "failed" as const, code, final };
  }
  const sentAt = nowIso();
  for (const row of ready) {
    await env.DB.prepare("UPDATE channel_attempts SET status = 'sent', attempts = attempts + 1, next_attempt_at = NULL, error_code = NULL, message_id = ?1, sent_at = ?2 WHERE delivery_id = ?3 AND channel = ?4")
      .bind(messageId ?? null, sentAt, row.id, channel).run();
  }
  return { status: "sent" as const, messageId, noticeCarried: omitted > 0 };
}

async function addWarningFallback(env: Env, rows: DeliveryData[], routes: Map<Channel, DeliveryData[]>) {
  const fallback: DeliveryData[] = [];
  for (const row of rows) {
    const route = await routeForDelivery(env, row);
    const feishu = await getChannelAttempt(env, row.id, "feishu");
    if (route.includes("feishu") && (!feishu || feishu.status === "failed" || feishu.status === "skipped")) {
      await ensureChannelAttempt(env, row.id, "email", false);
      fallback.push(row);
    }
  }
  if (fallback.length) routes.set("email", [...(routes.get("email") ?? []), ...fallback.filter(row => !(routes.get("email") ?? []).some(existing => existing.id === row.id))]);
}
async function refreshDeliveryStatuses(env: Env, rows: DeliveryData[]) {
  for (const row of rows) {
    const delivery = await env.DB.prepare("SELECT status FROM deliveries WHERE id = ?1").bind(row.id).first<{ status: DeliveryStatus }>();
    const attempts = await env.DB.prepare("SELECT channel, status, next_attempt_at, error_code, message_id FROM channel_attempts WHERE delivery_id = ?1 ORDER BY id").bind(row.id).all<ChannelAttempt>();
    const values = attempts.results;
    const sent = values.find(value => value.status === "sent");
    if (delivery?.status === "cancelled" && !sent) continue;
    const pending = values.find(value => value.status === "pending");
    const cancelled = values.length > 0 && values.every(value => value.status === "cancelled");
    const terminal = values.length > 0 && values.every(value => ["sent", "failed", "skipped", "cancelled"].includes(value.status));
    const status: DeliveryStatus = sent ? "sent" : cancelled ? "cancelled" : pending || !terminal ? "pending" : "failed";
    const latestError = [...values].reverse().find(value => value.error_code)?.error_code ?? null;
    const messageId = values.find(value => value.channel === "email" && value.status === "sent")?.message_id ?? sent?.message_id ?? null;
    const next = pending?.next_attempt_at ?? null;
    const channel = [...new Set(values.map(value => value.channel))].join(",");
    await env.DB.prepare("UPDATE deliveries SET status = ?1, channel = ?2, error_code = ?3, message_id = ?4, sent_at = CASE WHEN ?5 = 'sent' THEN COALESCE(sent_at, ?6) ELSE sent_at END, next_attempt_at = ?7, attempts = attempts + 1 WHERE id = ?8")
      .bind(status, channel || "email", sent ? null : latestError, messageId, status, nowIso(), next, row.id).run();
  }
}

export async function deliver(env: Env, event: NotifyEvent, incidentId: string, deliveries: DeliveryRow[]) {
  const rows = await loadDeliveries(env, deliveries.map(row => row.id));
  if (!rows.length) return { status: "failed" as const, error_code: "E_DELIVERY_FAILED" };
  const omittedRow = await env.DB.prepare("SELECT omitted_count FROM quota WHERE bucket = ?1").bind(beijingBuckets().day).first<{ omitted_count: number }>();
  const omitted = Number(omittedRow?.omitted_count ?? 0);
  const routes = new Map<Channel, DeliveryData[]>();
  const activeRows = rows.filter(row => row.status !== "cancelled");
  for (const row of activeRows) {
    const legacy = row.attempts > 0 && !(await hasChannelAttempts(env, row.id));
    for (const channel of await routeForDelivery(env, row)) {
      await ensureChannelAttempt(env, row.id, channel, legacy && channel === "email");
      routes.set(channel, [...(routes.get(channel) ?? []), row]);
    }
  }
  const results: Array<{ status: string; code?: string; final?: number; noticeCarried?: boolean }> = [];
  const feishuRows = routes.get("feishu") ?? [];
  if (feishuRows.length) {
    results.push(await sendChannel(env, "feishu", feishuRows, event, incidentId));
    await addWarningFallback(env, activeRows, routes);
  }
  const emailRows = routes.get("email") ?? [];
  if (emailRows.length) results.push(await sendChannel(env, "email", emailRows, event, incidentId));
  await refreshDeliveryStatuses(env, rows);
  const sent = await env.DB.prepare(`SELECT COUNT(*) AS count FROM deliveries WHERE id IN (${placeholders(rows.length)}) AND status = 'sent'`).bind(...rows.map(row => row.id)).first<{ count: number }>();
  const pending = await env.DB.prepare(`SELECT COUNT(*) AS count FROM deliveries WHERE id IN (${placeholders(rows.length)}) AND status = 'pending'`).bind(...rows.map(row => row.id)).first<{ count: number }>();
  const sentMessage = await env.DB.prepare(`SELECT message_id FROM deliveries WHERE id IN (${placeholders(rows.length)}) AND status = 'sent' AND message_id IS NOT NULL ORDER BY id LIMIT 1`).bind(...rows.map(row => row.id)).first<{ message_id: string }>();
  const cancelled = await env.DB.prepare(`SELECT COUNT(*) AS count FROM deliveries WHERE id IN (${placeholders(rows.length)}) AND status = 'cancelled'`).bind(...rows.map(row => row.id)).first<{ count: number }>();
  const finalFailure = [...results].reverse().find(result => result.final);
  const noticeDelivered = results.some(result => result.noticeCarried);
  if (Number(sent?.count ?? 0) > 0) {
    if (noticeDelivered && omitted > 0) await env.DB.prepare("UPDATE quota SET omitted_count = MAX(omitted_count - ?2, 0) WHERE bucket = ?1").bind(beijingBuckets().day, omitted).run();
    return { status: "sent" as const, ...(sentMessage?.message_id ? { message_id: sentMessage.message_id } : {}) };
  }
  const mixedPending = await env.DB.prepare(`SELECT COUNT(*) AS count FROM deliveries d WHERE d.id IN (${placeholders(rows.length)}) AND d.status = 'pending' AND EXISTS (SELECT 1 FROM channel_attempts ca WHERE ca.delivery_id = d.id AND ca.status = 'pending') AND EXISTS (SELECT 1 FROM channel_attempts ca WHERE ca.delivery_id = d.id AND ca.status = 'failed')`).bind(...rows.map(row => row.id)).first<{ count: number }>();
  if (Number(mixedPending?.count ?? 0) > 0) return { status: "pending" as const, error_code: [...results].reverse().find(result => result.code)?.code };
  if (Number(cancelled?.count ?? 0) === rows.length) return { status: "cancelled" as const };
  if (finalFailure) throw codedError(finalFailure.code ?? "E_DELIVERY_FAILED");
  const code = [...results].reverse().find(result => result.code)?.code ?? "E_DELIVERY_FAILED";
  if (Number(pending?.count ?? 0) > 0) return { status: "pending" as const, error_code: code };
  throw codedError(code);
}

export async function ingest(input: unknown, env: Env, fixedSource?: string) {
  const event = validateNotifyEvent(input);
  if (fixedSource && event.source !== fixedSource) throw Object.assign(new Error("source_not_allowed"), { code: "E_SOURCE_NOT_ALLOWED", status: 403 });
  const rule = findRule(event.source, event.kind);
  if (!rule) throw Object.assign(new Error("kind_not_allowed"), { code: "E_KIND_NOT_ALLOWED", status: 403 });
  const existing = await findExisting(env, event.event_id);
  if (existing) return { event_id: event.event_id, decision: String(existing.decision), duplicate: true };
  const key = incidentKey(event);
  const current = await incident(env, key);
  const decision = decideNotification(event, rule, rowIncident(current));
  const inserted = await insertEvent(env, event, key, decision.decision);
  if (!inserted) {
    const duplicate = await findExisting(env, event.event_id);
    return { event_id: event.event_id, decision: String(duplicate?.decision ?? decision.decision), duplicate: true };
  }
  await upsertIncident(env, event, key, decision);
  if (event.state === "resolved") {
    await env.DB.prepare("UPDATE deliveries SET status = 'cancelled', error_code = 'E_RESOLVED_BEFORE_SEND' WHERE incident_key = ?1 AND status = 'pending' AND notification_type <> 'resolved'").bind(key).run();
    await cancelChannelAttempts(env, key, "E_RESOLVED_BEFORE_SEND", true);
  } else {
    const queued = await env.DB.prepare("SELECT id FROM deliveries WHERE incident_key = ?1 AND status = 'pending' AND notification_type <> 'resolved' LIMIT 1").bind(key).first<{ id: number }>();
    if (queued && rule.batch !== "alone") return { event_id: event.event_id, decision: decision.decision, duplicate: false, delivery: "pending" };
  }
  const notificationType = event.state === "resolved" ? "resolved" : decision.reason === "cooldown_elapsed" ? "repeat" : "first";
  if (!decision.shouldSend) return { event_id: event.event_id, decision: decision.decision, duplicate: false };
  // alert deliveries reserve quota only in Cron, right before the real send.
  if (rule.mode !== "immediate") {
    await createDelivery(env, event.event_id, key, notificationType, null);
    return { event_id: event.event_id, decision: decision.decision, duplicate: false, delivery: "pending" };
  }
  if (!(await reserveQuota(env))) {
    await addOmitted(env, 1);
    return { event_id: event.event_id, decision: "quota_deferred", duplicate: false };
  }
  const deliveryId = await createDelivery(env, event.event_id, key, notificationType, null);
  const deliveryEvent = notificationType === "repeat" ? { ...event, title: `${event.title}，仍未恢复` } : event;
  const result = await deliver(env, deliveryEvent, key, [{ id: deliveryId, attempts: 0 }]);
  if (result.status === "sent") await env.DB.prepare("UPDATE incidents SET last_notification_at = ?1 WHERE incident_key = ?2").bind(nowIso(), key).run();
  return { event_id: event.event_id, decision: decision.decision, duplicate: false, delivery: result.status, ...("message_id" in result && result.message_id ? { message_id: result.message_id } : {}) };
}

async function readToken(env: Env, request: Request) {
  const header = request.headers.get("authorization") ?? "";
  if (!header.startsWith("Bearer ")) return null;
  const token = header.slice(7).trim();
  if (!token || token.length > 256) return null;
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
  const hash = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join("");
  return env.DB.prepare("SELECT source, kinds_json FROM producer_tokens WHERE token_hash = ?1 AND revoked_at IS NULL").bind(hash).first<{ source: string; kinds_json: string }>();
}

async function parseBody(request: Request) {
  const length = Number(request.headers.get("content-length") ?? 0);
  if (length > MAX_BODY_BYTES) throw Object.assign(new Error("request_too_large"), { status: 413 });
  let bytes: Uint8Array;
  if (request.body) {
    const reader = request.body.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;
    try {
      while (true) {
        const part = await reader.read();
        if (part.done) break;
        total += part.value.byteLength;
        if (total > MAX_BODY_BYTES) {
          await reader.cancel("request_too_large");
          throw Object.assign(new Error("request_too_large"), { status: 413 });
        }
        chunks.push(part.value);
      }
    } finally { reader.releaseLock(); }
    bytes = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  } else {
    bytes = new Uint8Array(await request.arrayBuffer());
  }
  if (bytes.byteLength > MAX_BODY_BYTES) throw Object.assign(new Error("request_too_large"), { status: 413 });
  if (!request.headers.get("content-type")?.toLowerCase().includes("application/json")) throw new NotifyValidationError("content-type must be application/json");
  try { return JSON.parse(new TextDecoder().decode(bytes)); } catch { throw new NotifyValidationError("invalid JSON"); }
}

async function route(request: Request, env: Env) {
  const url = new URL(request.url);
  if (url.hostname !== "notify-api.codepi.app") return json({ error: "not_found" }, 404);
  if (request.method === "POST" && url.pathname === "/v1/events") {
    const token = await readToken(env, request);
    if (!token) return json({ error: "unauthorized" }, 401);
    let body: unknown;
    try { body = await parseBody(request); } catch (error) { return json({ error: error instanceof Error ? error.message : "invalid_request" }, (error as { status?: number }).status ?? 400); }
    let event: NotifyEvent;
    try { event = validateNotifyEvent(body); } catch (error) { return json({ error: error instanceof Error ? error.message : "invalid_event" }, 400); }
    let kinds: unknown;
    try { kinds = JSON.parse(token.kinds_json); } catch { return json({ error: "token_invalid" }, 401); }
    if (event.source !== token.source || !Array.isArray(kinds) || !kinds.includes(event.kind)) return json({ error: "forbidden" }, 403);
    try { return json(await ingest(event, env)); } catch (error) {
      // Only the error code leaves the Worker: provider messages may carry addresses or internals.
      const code = typeof error === "object" && error && "code" in error ? String(error.code) : "E_INTERNAL";
      console.error(JSON.stringify({ event_id: event.event_id, kind: event.kind, error_code: code }));
      return json({ error: code }, (error as { status?: number }).status ?? 500);
    }
  }
  if (request.method === "GET" && /^\/v1\/events\/[^/]+$/.test(url.pathname)) {
    const token = await readToken(env, request);
    if (!token) return json({ error: "unauthorized" }, 401);
    let eventId: string;
    try { eventId = decodeURIComponent(url.pathname.slice("/v1/events/".length)); }
    catch { return json({ error: "invalid_event_id" }, 400); }
    const event = await env.DB.prepare("SELECT event_id, source, kind, subject, state, severity, occurred_at, title, summary, facts_json, link, decision FROM events WHERE event_id = ?1 AND source = ?2").bind(eventId, token.source).first<Record<string, unknown>>();
    if (!event) return json({ error: "not_found" }, 404);
    const deliveries = await env.DB.prepare("SELECT id, event_id, incident_key, notification_no, channel, status, attempts, next_attempt_at, error_code, message_id, created_at, sent_at FROM deliveries WHERE event_id = ?1 ORDER BY id").bind(eventId).all<Record<string, unknown>>();
    const result = [];
    for (const delivery of deliveries.results) {
      const channels = await env.DB.prepare("SELECT channel, status, attempts, next_attempt_at, error_code, message_id, sent_at FROM channel_attempts WHERE delivery_id = ?1 ORDER BY id").bind(delivery.id).all();
      result.push({ ...delivery, channels: channels.results });
    }
    return json({ event: eventFromRow(event), decision: event.decision, deliveries: result });
  }
  return json({ error: "not_found" }, 404);
}

export class NotifyApi extends WorkerEntrypoint<Env> {
  emit(event: NotifyEvent) { return ingest(event, this.env, RPC_SOURCE); }
}

export default {
  fetch(request: Request, env: Env) { return route(request, env); },
  async scheduled(_controller: ScheduledController, env: Env) {
    const pending = await env.DB.prepare("SELECT DISTINCT d.id, d.status, d.attempts, d.notification_type, e.event_id, e.source, e.kind, e.subject, e.state, e.severity, e.occurred_at, e.title, e.summary, e.facts_json, e.link, d.incident_key FROM deliveries d JOIN events e ON e.event_id = d.event_id LEFT JOIN channel_attempts ca ON ca.delivery_id = d.id WHERE ((d.status = 'pending' AND (d.next_attempt_at IS NULL OR d.next_attempt_at <= ?1)) OR (ca.status = 'pending' AND (ca.next_attempt_at IS NULL OR ca.next_attempt_at <= ?1))) ORDER BY d.id LIMIT 50").bind(nowIso()).all<DeliveryData>();
    const rows = pending.results;
    if (!rows.length) return;
    // Merged metadata comes from the firing rows when any exist (a mixed batch is never 「[恢复]」),
    // led by the highest severity among them. Rules marked alone retain their original card metadata.
    const rank: Record<string, number> = { info: 0, warning: 1, critical: 2 };
    const aloneIds = new Set(rows.filter(row => findRule(String(row.source), String(row.kind))?.batch === "alone").map(row => row.id));
    const groups: DeliveryData[][] = rows.filter(row => aloneIds.has(row.id)).map(row => [row]);
    const mergedRows = rows.filter(row => !aloneIds.has(row.id));
    if (mergedRows.length) groups.push(mergedRows);
    const readyGroups: DeliveryData[][] = [];
    for (const group of groups) {
      const newGroupRows = group.filter(row => Number(row.attempts ?? 0) === 0);
      if (newGroupRows.length && !(await reserveQuota(env))) {
        await markOmitted(env, newGroupRows.map(row => Number(row.id)));
        // A denied group still sends its retry rows; only the new rows wait for the next quota window.
        const keep = group.filter(row => Number(row.attempts ?? 0) > 0);
        if (keep.length) readyGroups.push(keep);
        continue;
      }
      readyGroups.push(group);
    }
    if (!readyGroups.length) return;
    let firstError: unknown;
    for (const group of readyGroups) {
      const firing = group.filter(row => row.state !== "resolved");
      const leaders = firing.length ? firing : group;
      const leadRow = leaders.reduce((best, row) => rank[String(row.severity)] > rank[String(best.severity)] ? row : best, leaders[0]);
      const lead = deliveryEventFromRow(leadRow);
      const merged: NotifyEvent = group.length === 1 ? lead : {
        ...lead,
        title: `${group.length} 条提醒${group.some(row => row.notification_type === "repeat") ? "，仍未恢复" : ""}`,
        summary: group.map(row => String(row.title)).join("；").slice(0, 500),
        facts: group.slice(0, 12).map(row => ({ label: String(row.kind), value: String(row.title) })),
      };
      const unsentRows = group.filter(row => row.status !== "sent");
      let result: { status: string } | null = null;
      try {
        result = await deliver(env, merged, String(leadRow.incident_key), group.map(row => ({ id: Number(row.id), attempts: Number(row.attempts ?? 0) })));
      } catch (error) {
        firstError ??= error;
        continue;
      }
      if (!result || result.status !== "sent") continue;
      if (!unsentRows.length) continue;
      const turnedSent = await env.DB.prepare(`SELECT incident_key FROM deliveries WHERE id IN (${placeholders(unsentRows.length)}) AND status = 'sent'`).bind(...unsentRows.map(row => row.id)).all<{ incident_key: string }>();
      const sentAt = nowIso();
      for (const key of new Set(turnedSent.results.map(row => row.incident_key))) await env.DB.prepare("UPDATE incidents SET last_notification_at = ?1 WHERE incident_key = ?2").bind(sentAt, key).run();
    }
    if (firstError) throw firstError;
  },
} satisfies ExportedHandler<Env>;
