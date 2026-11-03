import { AppError, UPSTREAM_MAX_PAGES, UPSTREAM_PAGE_LIMIT, UPSTREAM_TIMEOUT_MS } from "./lib";
import type { Env } from "./types";

type StatusReadPayload = { ok?: unknown; rows?: unknown; nextCursor?: unknown };

export const UPSTREAM_ACTIVITY_SAMPLES_PATH = "/jw/activity_samples";
export const UPSTREAM_HOME_DEVICES_PATH = "/home/devices";
export const UPSTREAM_HOME_SNAPSHOTS_PATH = "/home/snapshots";
export const UPSTREAM_HOME_EVENTS_PATH = "/home/events";
export const UPSTREAM_HOME_HEARTBEATS_PATH = "/home/heartbeats";

function upstreamError(): AppError {
  // Only the error code is logged; upstream rows never reach the log stream.
  console.error("upstream_unavailable");
  return new AppError("upstream_unavailable", 502);
}

export async function readUpstream<T>(env: Env, path: string, params: Record<string, string> = {}): Promise<T[]> {
  const rows: T[] = [];
  let cursor: string | null = null;
  for (let page = 0; page < UPSTREAM_MAX_PAGES; page += 1) {
    const url = new URL(`https://status-read${path}`);
    for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
    if (cursor) url.searchParams.set("cursor", cursor);
    url.searchParams.set("limit", String(UPSTREAM_PAGE_LIMIT));
    let response: Response;
    try {
      response = await env.STATUS_READ.fetch(url.toString(), { signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS) });
    } catch {
      throw upstreamError();
    }
    if (!response.ok) {
      await response.body?.cancel();
      throw upstreamError();
    }
    let payload: StatusReadPayload;
    try {
      payload = await response.json() as StatusReadPayload;
    } catch {
      throw upstreamError();
    }
    if (payload?.ok !== true || !Array.isArray(payload.rows)) throw upstreamError();
    rows.push(...payload.rows as T[]);
    cursor = typeof payload.nextCursor === "string" && payload.nextCursor.length > 0 ? payload.nextCursor : null;
    if (!cursor) return rows;
  }
  // 翻满 UPSTREAM_MAX_PAGES 页仍有下一页：宁可报错，也不能用不完整的数据算出「看起来正常」的汇总。
  console.error("upstream_truncated");
  throw new AppError("upstream_unavailable", 502);
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function numberOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

export function parseActivity(rows: unknown[]): Array<{
  sampled_at: string; host?: string | null; idle_sec?: number | null; locked?: boolean | null; power?: string | null;
  app_name?: string | null; bundle_id?: string | null; received_at?: string | null; key_idle_sec?: number | null;
  pointer_idle_sec?: number | null; net?: "home" | "office" | "other" | "" | null; ssid?: string | null; net_key?: string | null;
}> {
  const result: ReturnType<typeof parseActivity> = [];
  for (const row of rows) {
    if (typeof row !== "object" || row === null) continue;
    const value = row as Record<string, unknown>;
    const sampledAt = text(value.sampled_at);
    if (!sampledAt || !Number.isFinite(Date.parse(sampledAt))) continue;
    const net = value.net;
    result.push({
      sampled_at: sampledAt,
      host: text(value.host),
      idle_sec: numberOrNull(value.idle_sec),
      locked: typeof value.locked === "boolean" ? value.locked : null,
      power: text(value.power),
      app_name: text(value.app_name),
      bundle_id: text(value.bundle_id),
      received_at: text(value.received_at),
      key_idle_sec: numberOrNull(value.key_idle_sec),
      pointer_idle_sec: numberOrNull(value.pointer_idle_sec),
      net: net === "home" || net === "office" || net === "other" || net === "" ? net : null,
      ssid: text(value.ssid),
      net_key: text(value.net_key),
    });
  }
  return result;
}

export function parseDevices(rows: unknown[]): Array<{
  device_id: string; name?: string | null; vendor?: string | null; room?: string | null;
  first_seen?: string | null; last_seen?: string | null; current_status?: "online" | "pending-offline" | "offline" | null;
}> {
  const result: ReturnType<typeof parseDevices> = [];
  for (const row of rows) {
    if (typeof row !== "object" || row === null) continue;
    const value = row as Record<string, unknown>;
    const deviceId = text(value.device_id);
    if (!deviceId) continue;
    const status = value.current_status;
    result.push({
      device_id: deviceId,
      name: text(value.name),
      vendor: text(value.vendor),
      room: text(value.room),
      first_seen: text(value.first_seen),
      last_seen: text(value.last_seen),
      current_status: status === "online" || status === "pending-offline" || status === "offline" ? status : null,
    });
  }
  return result;
}

export function parseSnapshots(rows: unknown[]): Array<{
  device_id: string; observed_at: string; received_at?: string | null; status: "online" | "pending-offline" | "offline";
  source?: string | null; room?: string | null;
}> {
  const result: ReturnType<typeof parseSnapshots> = [];
  for (const row of rows) {
    if (typeof row !== "object" || row === null) continue;
    const value = row as Record<string, unknown>;
    const deviceId = text(value.device_id), observedAt = text(value.observed_at), status = value.status;
    if (!deviceId || !observedAt || !Number.isFinite(Date.parse(observedAt))) continue;
    if (status !== "online" && status !== "pending-offline" && status !== "offline") continue;
    result.push({
      device_id: deviceId,
      observed_at: observedAt,
      received_at: text(value.received_at),
      status,
      source: text(value.source),
      room: text(value.room),
    });
  }
  return result;
}

export function parseEvents(rows: unknown[]): Array<{
  device_id: string; event_at: string; kind?: string | null; status?: "online" | "pending-offline" | "offline" | null;
  received_at?: string | null;
}> {
  const result: ReturnType<typeof parseEvents> = [];
  for (const row of rows) {
    if (typeof row !== "object" || row === null) continue;
    const value = row as Record<string, unknown>;
    const deviceId = text(value.device_id), eventAt = text(value.event_at);
    if (!deviceId || !eventAt || !Number.isFinite(Date.parse(eventAt))) continue;
    const status = value.status;
    result.push({
      device_id: deviceId,
      event_at: eventAt,
      kind: text(value.kind),
      status: status === "online" || status === "pending-offline" || status === "offline" ? status : null,
      received_at: text(value.received_at),
    });
  }
  return result;
}

export function parseHeartbeats(rows: unknown[]): Array<{
  observed_at: string; received_at?: string | null; scan_ok?: boolean | null; device_count?: number | null; error_category?: string | null;
}> {
  const result: ReturnType<typeof parseHeartbeats> = [];
  for (const row of rows) {
    if (typeof row !== "object" || row === null) continue;
    const value = row as Record<string, unknown>;
    const observedAt = text(value.observed_at);
    if (!observedAt || !Number.isFinite(Date.parse(observedAt))) continue;
    result.push({
      observed_at: observedAt,
      received_at: text(value.received_at),
      scan_ok: typeof value.scan_ok === "boolean" ? value.scan_ok : null,
      device_count: numberOrNull(value.device_count),
      error_category: text(value.error_category),
    });
  }
  return result;
}
