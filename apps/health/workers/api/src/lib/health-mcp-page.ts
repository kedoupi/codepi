import { MCP_LIMITS, type HealthOperation } from "@kedoupi/shared/mcp/contract";
import { ApiError } from "./errors.ts";
import { calendarDay, shiftDay } from "../../../../shared/dates.ts";

const PAGE_FORMAT = "health_data_json_v1" as const;
const DETAIL_LIMIT = MCP_LIMITS.detail;
const MAX_CURSOR_LENGTH = 2048;
const OPERATIONS: readonly HealthOperation[] = ["catalog", "query_records", "aggregate", "sync_status"];
const encoder = new TextEncoder();
const decoder = new TextDecoder("utf-8", { fatal: true, ignoreBOM: false });

type PageCursor = {
  v: 1;
  format: typeof PAGE_FORMAT;
  operation: HealthOperation;
  args_sha256: string;
  sha256: string;
  index: number;
  generated_at: string;
  refresh: { requested: boolean; error: string | null } | null;
};

export type PreparedHealthPage = {
  cursor: string | null;
  argsSha256: string;
  binding: PageCursor | null;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
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
  const padded = value.replace(/-/g, "+").replace(/_/g, "/")
    + "=".repeat((4 - value.length % 4) % 4);
  const bytes = Uint8Array.from(atob(padded), char => char.charCodeAt(0));
  const text = decoder.decode(bytes);
  if (base64UrlEncode(text) !== value) throw new Error("non-canonical cursor");
  return text;
}

async function sha256(value: string) {
  const digest = await crypto.subtle.digest("SHA-256", encoder.encode(value));
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join("");
}

function jsonBytes(value: unknown) {
  return encoder.encode(JSON.stringify(value)).byteLength;
}

function replyBytes(value: unknown) {
  return jsonBytes({ ok: true, data: value });
}

function sortedJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortedJson);
  if (isRecord(value)) {
    return Object.fromEntries(Object.keys(value).sort().map(key => [key, sortedJson(value[key])]));
  }
  return value;
}

function canonicalArgs(args: Record<string, unknown>) {
  try {
    return JSON.stringify(sortedJson(args));
  } catch {
    throw new ApiError("invalid_arguments", 400);
  }
}

function validTimestamp(value: unknown): value is string {
  return typeof value === "string"
    && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)
    && new Date(value).toISOString() === value;
}

function validRefresh(value: unknown, operation: HealthOperation) {
  if (operation !== "query_records" && operation !== "aggregate") return value === null;
  if (!isRecord(value)) return false;
  const keys = Object.keys(value).sort();
  return keys.length === 2 && keys[0] === "error" && keys[1] === "requested"
    && typeof value.requested === "boolean"
    && (value.error === null
      || typeof value.error === "string" && value.error.length > 0 && value.error.length <= 128);
}

function refreshMetadata(operation: HealthOperation, data: Record<string, unknown>) {
  if (operation !== "query_records" && operation !== "aggregate") return null;
  return {
    requested: data.refresh_requested === true,
    error: typeof data.refresh_error === "string" ? data.refresh_error : null,
  };
}

function pinRefreshMetadata(
  operation: HealthOperation,
  data: Record<string, unknown>,
  refresh: { requested: boolean; error: string | null } | null,
): Record<string, unknown> {
  if (!refresh || (operation !== "query_records" && operation !== "aggregate")) return data;
  const pinned: Record<string, unknown> = {
    ...data,
    refresh_requested: refresh.requested,
    refresh_error: refresh.error,
  };
  if (refresh.error !== null && Array.isArray(data.warnings)) {
    // refresh() appends the request failure after coverage warnings. Rebuild
    // that first-page shape while leaving every coverage warning hash-bound.
    pinned.warnings = [...data.warnings, refresh.error];
  }
  return pinned;
}

function pinBackgroundClock(data: Record<string, unknown>, asOf: string) {
  const background = data.background;
  if (!isRecord(background) || typeof background.next_run_at !== "string") return data;
  const at = Date.parse(asOf);
  if (!Number.isFinite(at)) return data;
  const day = calendarDay(new Date(at));
  let next = Date.parse(`${day}T01:00:00Z`);
  if (next <= at) {
    const runDay = typeof background.run_day === "string" ? background.run_day : null;
    next = !runDay || runDay < day
      ? (Math.floor(at / 120_000) + 1) * 120_000
      : Date.parse(`${shiftDay(day, 1)}T01:00:00Z`);
  }
  // Keep the scheduler display tied to the page's first generated_at. The
  // Cron tick is otherwise recomputed from wall-clock time on every read.
  return { ...data, background: { ...background, next_run_at: new Date(next).toISOString() } };
}

function decodeCursor(value: string): PageCursor {
  if (value.length < 1 || value.length > MAX_CURSOR_LENGTH) throw new ApiError("invalid_cursor", 400);
  try {
    const parsed: unknown = JSON.parse(base64UrlDecode(value));
    if (!isRecord(parsed)) throw new Error("invalid cursor");
    const keys = Object.keys(parsed).sort();
    const expected = ["args_sha256", "format", "generated_at", "index", "operation", "refresh", "sha256", "v"];
    if (keys.length !== expected.length || keys.some((key, index) => key !== expected[index])) {
      throw new Error("invalid cursor fields");
    }
    if (parsed.v !== 1 || parsed.format !== PAGE_FORMAT
      || !OPERATIONS.includes(parsed.operation as HealthOperation)
      || !Number.isSafeInteger(parsed.index) || (parsed.index as number) < 1
      || typeof parsed.args_sha256 !== "string" || !/^[0-9a-f]{64}$/.test(parsed.args_sha256)
      || typeof parsed.sha256 !== "string" || !/^[0-9a-f]{64}$/.test(parsed.sha256)
      || !validTimestamp(parsed.generated_at)
      || !validRefresh(parsed.refresh, parsed.operation as HealthOperation)) {
      throw new Error("invalid cursor");
    }
    return parsed as PageCursor;
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw new ApiError("invalid_cursor", 400);
  }
}

function encodeCursor(cursor: PageCursor) {
  return base64UrlEncode(JSON.stringify(cursor));
}

export function splitHealthRequestArgs(value: unknown) {
  if (!isRecord(value)) throw new ApiError("invalid_arguments", 400);
  if (!Object.hasOwn(value, "cursor")) return { rawArgs: value, cursor: null };
  const { cursor, ...rawArgs } = value;
  if (typeof cursor !== "string" || cursor.length < 1 || cursor.length > MAX_CURSOR_LENGTH) {
    throw new ApiError("invalid_cursor", 400);
  }
  return { rawArgs, cursor };
}

export async function prepareHealthPage(
  operation: HealthOperation,
  rawArgs: Record<string, unknown>,
  cursor: string | null,
): Promise<PreparedHealthPage> {
  const argsSha256 = await sha256(canonicalArgs(rawArgs));
  if (!cursor) return { cursor: null, argsSha256, binding: null };
  const binding = decodeCursor(cursor);
  if (binding.operation !== operation || binding.args_sha256 !== argsSha256) {
    throw new ApiError("cursor_stale", 409);
  }
  return { cursor, argsSha256, binding };
}

function pageEnvelope(
  operation: HealthOperation,
  source: string,
  provider: string,
  asOf: string,
  points: string[],
  index: number,
  count: number,
  cursor: string | null,
  digest: string,
  argsSha256: string,
  refresh: { requested: boolean; error: string | null } | null,
  totalBytes: number,
) {
  const chunk = points.slice(index, index + count).join("");
  const nextIndex = index + count;
  const complete = nextIndex >= points.length;
  const nextCursor = complete ? null : encodeCursor({
    v: 1,
    format: PAGE_FORMAT,
    operation,
    args_sha256: argsSha256,
    sha256: digest,
    index: nextIndex,
    generated_at: asOf,
    refresh,
  });
  return {
    source,
    provider,
    operation,
    as_of: asOf,
    pagination: {
      format: PAGE_FORMAT,
      encoding: "utf-8" as const,
      cursor,
      next_cursor: nextCursor,
      total_bytes: totalBytes,
      chunk_bytes: encoder.encode(chunk).byteLength,
      chunk,
      complete,
    },
  };
}

export async function pageHealthData(
  operation: HealthOperation,
  data: Record<string, unknown>,
  prepared: PreparedHealthPage,
  generatedAt: string,
): Promise<Record<string, unknown>> {
  const asOf = prepared.binding?.generated_at ?? generatedAt;
  const refresh = prepared.binding?.refresh ?? refreshMetadata(operation, data);
  let pageData: Record<string, unknown> = prepared.binding
    ? pinRefreshMetadata(operation, data, prepared.binding.refresh)
    : data;
  if (prepared.binding && typeof pageData.generated_at === "string") {
    pageData = { ...pageData, generated_at: prepared.binding.generated_at };
  }
  pageData = pinBackgroundClock(pageData, asOf);
  const canonical = JSON.stringify(pageData);
  const totalBytes = encoder.encode(canonical).byteLength;
  if (replyBytes(pageData) <= DETAIL_LIMIT && !prepared.binding) return data;

  const points = Array.from(canonical);
  const digest = await sha256(canonical);
  let index = 0;
  if (prepared.binding) {
    if (prepared.binding.sha256 !== digest) throw new ApiError("cursor_stale", 409);
    index = prepared.binding.index;
    if (index >= points.length) throw new ApiError("cursor_stale", 409);
  }
  if (replyBytes(pageData) <= DETAIL_LIMIT) throw new ApiError("cursor_stale", 409);

  const source = typeof data.source === "string" ? data.source : "health";
  const provider = typeof data.provider === "string" ? data.provider : "oura";
  const wrapper = (count: number) => pageEnvelope(
    operation, source, provider, asOf, points, index, count,
    prepared.cursor, digest, prepared.argsSha256, refresh, totalBytes,
  );
  if (replyBytes(wrapper(1)) > DETAIL_LIMIT) throw new ApiError("page_too_large", 500);

  let low = 1;
  let high = points.length - index;
  let best = 1;
  while (low <= high) {
    const middle = Math.floor((low + high) / 2);
    if (replyBytes(wrapper(middle)) <= DETAIL_LIMIT) {
      best = middle;
      low = middle + 1;
    } else {
      high = middle - 1;
    }
  }
  return wrapper(best);
}
