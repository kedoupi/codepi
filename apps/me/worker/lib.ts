import { jsonBytes } from "@kedoupi/shared/mcp/contract";
import {
  MEMORY_KINDS,
  MEMORY_STATUSES,
  TIMELINE_KINDS,
  TIMELINE_STATUSES,
  type MemoryKind,
  type MemoryStatus,
  type TimelineKind,
  type TimelineStatus,
} from "./models";

export const OWNER_SUBJECT = "kdp-owner";
export const OWNER_USER_ID = "me-owner";
export const MAX_RPC_BYTES = 24 * 1024;
export const MAX_PAGE_BYTES = 12 * 1024;
export const MAX_SUMMARY_BYTES = 1536;
export const MAX_IMPORT_ITEMS = 500;
export const MAX_IMPORT_BYTES = 512 * 1024;
export const MAX_IMPORT_CHUNK_ITEMS = 500;
export const MAX_IMPORT_REQUEST_BYTES = 620 * 1024;
export const encoder = new TextEncoder();

export class ValidationError extends Error {
  status = 400;
  code: string;

  constructor(message: string, code = "invalid_argument") {
    super(message);
    this.code = code;
  }
}

export class AppError extends Error {
  status: number;
  code: string;

  constructor(code: string, status: number, message = code) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

export function json(body: unknown, status = 200, headers: HeadersInit = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      ...headers,
    },
  });
}

export async function bodyJson(request: Request, limit = 64 * 1024): Promise<unknown> {
  if (!request.headers.get("Content-Type")?.startsWith("application/json")) {
    throw new ValidationError("需要 JSON 请求");
  }
  if (Number(request.headers.get("Content-Length")) > limit) throw new ValidationError("请求过大", "body_too_large");
  const reader = request.body?.getReader();
  if (!reader) throw new ValidationError("请求为空");
  let size = 0;
  const chunks: Uint8Array[] = [];
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > limit) {
      await reader.cancel();
      throw new ValidationError("请求过大", "body_too_large");
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  return JSON.parse(new TextDecoder().decode(bytes));
}

export function object(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function assertKeys(value: Record<string, unknown>, allowed: readonly string[]) {
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key)) throw new ValidationError("未知参数");
  }
}

export function requiredText(value: unknown, label: string, max: number): string {
  if (typeof value !== "string") throw new ValidationError(`${label}必须是文本`);
  const text = value.trim();
  if (!text) throw new ValidationError(`${label}不能为空`);
  if (/\u0000/.test(text)) throw new ValidationError("文本包含无效字符");
  if (text.length > max) throw new ValidationError(`${label}不能超过 ${max} 个字符`);
  return text;
}

export function optionalText(value: unknown, label: string, max: number): string | null {
  if (value === undefined || value === null || value === "") return null;
  return requiredText(value, label, max);
}

export function optionalQuery(value: unknown): string | null {
  return optionalText(value, "检索词", 200);
}

export function enumValue<T extends readonly string[]>(
  value: unknown,
  values: T,
  label: string,
): T[number] | null {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string" || !values.includes(value)) {
    throw new ValidationError(`${label}无效`);
  }
  return value as T[number];
}

export function integer(value: unknown, label: string, min: number, max: number, fallback?: number): number {
  if (value === undefined && fallback !== undefined) return fallback;
  const parsed = typeof value === "number" ? value : NaN;
  if (!Number.isSafeInteger(parsed) || parsed < min || parsed > max) {
    throw new ValidationError(`${label}必须是 ${min} 到 ${max} 的整数`);
  }
  return parsed;
}

export function validateMemoryStatus(value: unknown): MemoryStatus | null {
  return enumValue(value, MEMORY_STATUSES, "记忆状态");
}

export function validateMemoryKind(value: unknown): MemoryKind | null {
  return enumValue(value, MEMORY_KINDS, "记忆类型");
}

export function validateTimelineStatus(value: unknown): TimelineStatus | null {
  return enumValue(value, TIMELINE_STATUSES, "经历状态");
}

export function validateTimelineKind(value: unknown): TimelineKind | null {
  return enumValue(value, TIMELINE_KINDS, "经历类型");
}



export function normalizeTags(value: unknown): string[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) throw new ValidationError("标签必须是数组");
  if (value.length > 10) throw new ValidationError("标签不能超过 10 个");
  const result: string[] = [];
  for (const raw of value) {
    if (typeof raw !== "string") throw new ValidationError("标签必须是文本");
    const tag = raw.trim();
    if (!tag || tag.length > 80 || /[\u0000-\u001f]/.test(tag)) throw new ValidationError("标签格式无效");
    if (!result.includes(tag)) result.push(tag);
  }
  return result;
}

export function validateDatePart(value: unknown, label: string): string | null {
  const text = optionalText(value, label, 10);
  if (text === null) return null;
  if (!/^\d{4}(?:-\d{2}(?:-\d{2})?)?$/.test(text)) {
    throw new ValidationError(`${label}应为 YYYY、YYYY-MM 或 YYYY-MM-DD`);
  }
  const parts = text.split("-").map(Number);
  if (parts[1] !== undefined && (parts[1] < 1 || parts[1] > 12)) throw new ValidationError(`${label}月份无效`);
  if (parts[2] !== undefined) {
    const day = new Date(Date.UTC(parts[0], parts[1] - 1, parts[2]));
    if (day.getUTCFullYear() !== parts[0] || day.getUTCMonth() !== parts[1] - 1 || day.getUTCDate() !== parts[2]) {
      throw new ValidationError(`${label}日期无效`);
    }
  }
  return text;
}

export function validateProfileKey(value: unknown): string {
  const key = requiredText(value, "背景字段名", 80);
  if (/[\u0000-\u001f]/.test(key)) {
    throw new ValidationError("背景字段名无效");
  }
  return key;
}

export function validateSourceClient(value: unknown): string {
  const client = requiredText(value, "客户端", 200);
  if (!/^[A-Za-z0-9._:@/-]+$/.test(client)) throw new ValidationError("客户端标识无效");
  return client;
}

export function validateRequestId(value: unknown): string | null {
  const requestId = optionalText(value, "request_id", 100);
  if (requestId && !/^[A-Za-z0-9._:-]+$/.test(requestId)) throw new ValidationError("request_id 格式无效");
  return requestId;
}

export function validateImportId(value: unknown): string {
  const id = requiredText(value, "import_id", 26);
  if (!isUlid(id)) throw new ValidationError("import_id 无效");
  return id;
}

export function validateDigest(value: unknown): string | null {
  const digest = optionalText(value, "digest", 64);
  if (digest && !/^[a-f0-9]{64}$/.test(digest)) throw new ValidationError("digest 必须是 64 位小写 SHA-256");
  return digest;
}

export function pageLimit(value: unknown, fallback = 20, max = 50): number {
  return integer(value, "limit", 1, max, fallback);
}

export function decodeCursor(value: unknown): number {
  if (value === undefined || value === null || value === "") return 0;
  if (typeof value !== "string" || value.length > 512) throw new ValidationError("游标无效");
  try {
    const decoded = atob(value.replace(/-/g, "+").replace(/_/g, "/"));
    if (!/^\d+$/.test(decoded)) throw new Error();
    const offset = Number(decoded);
    if (!Number.isSafeInteger(offset) || offset < 0) throw new Error();
    return offset;
  } catch {
    throw new ValidationError("游标无效");
  }
}

export function encodeCursor(offset: number): string {
  return btoa(String(offset)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

const CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

export function ulid(now = Date.now()): string {
  let time = BigInt(now);
  let timePart = "";
  for (let i = 0; i < 10; i++) {
    timePart = CROCKFORD[Number(time & 31n)] + timePart;
    time >>= 5n;
  }
  let random = 0n;
  for (const byte of crypto.getRandomValues(new Uint8Array(10))) random = (random << 8n) | BigInt(byte);
  let randomPart = "";
  for (let i = 0; i < 16; i++) {
    randomPart = CROCKFORD[Number(random & 31n)] + randomPart;
    random >>= 5n;
  }
  return timePart + randomPart;
}

export function isUlid(value: string): boolean {
  return /^[0-9A-HJKMNP-TV-Z]{26}$/.test(value);
}

export function isoNow(now = Date.now()): string {
  return new Date(now).toISOString();
}

export async function sha256Hex(value: string | ArrayBuffer | Uint8Array): Promise<string> {
  const data = typeof value === "string"
    ? encoder.encode(value)
    : value instanceof Uint8Array
      ? value
      : new Uint8Array(value);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join("");
}

export function canonicalJson(value: unknown): string {
  if (value === null || typeof value === "boolean" || typeof value === "string") return JSON.stringify(value);
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new ValidationError("JSON 数值无效");
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (object(value)) {
    return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
  }
  throw new ValidationError("无法序列化导入内容");
}

export function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, match => `\\${match}`);
}

export function parseTags(value: string): string[] {
  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.filter((tag): tag is string => typeof tag === "string") : [];
  } catch {
    return [];
  }
}

const SECRET_PATTERNS = [
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/i,
  /\bsk-[A-Za-z0-9_-]{20,}\b/,
  /\bgh[pousr]_[A-Za-z0-9]{20,}\b/,
  /\bgithub_pat_[A-Za-z0-9_]{20,}\b/,
  /\bxox[baprs]-[A-Za-z0-9-]{16,}\b/,
  /\bAKIA[0-9A-Z]{16}\b/,
  /\bAIza[0-9A-Za-z_-]{30,}\b/,
  /\bBearer\s+[A-Za-z0-9._~-]{24,}\b/i,
];

function looksRandom(value: string): boolean {
  if (value.length < 40) return false;
  let classes = 0;
  if (/[a-z]/.test(value)) classes++;
  if (/[A-Z]/.test(value)) classes++;
  if (/\d/.test(value)) classes++;
  if (/[+/=_-]/.test(value)) classes++;
  if (classes < 2) return false;
  const counts = new Map<string, number>();
  for (const char of value) counts.set(char, (counts.get(char) ?? 0) + 1);
  let entropy = 0;
  for (const count of counts.values()) {
    const p = count / value.length;
    entropy -= p * Math.log2(p);
  }
  return entropy >= 3.6;
}

/** A deliberately conservative local check; matched content is never logged or stored. */
export function looksSecret(text: string): boolean {
  if (SECRET_PATTERNS.some(pattern => pattern.test(text))) return true;
  return (text.match(/[A-Za-z0-9+/=_-]{40,}/g) ?? []).some(looksRandom);
}

export function fitPage<T>(rows: T[], limit: number, offset: number, byteLimit = MAX_PAGE_BYTES - 512): { items: T[]; next_offset: number | null } {
  const items = rows.slice(0, limit);
  while (items.length && jsonBytes({ items, next_offset: offset + items.length }) > byteLimit) items.pop();
  if (!items.length && rows.length) throw new AppError("record_too_large", 500);
  return { items, next_offset: rows.length > items.length ? offset + items.length : null };
}

export function secureResponse(response: Response): Response {
  const headers = new Headers(response.headers);
  headers.set("Cache-Control", "no-store");
  headers.set("X-Content-Type-Options", "nosniff");
  headers.set("X-Frame-Options", "DENY");
  headers.set("Referrer-Policy", "no-referrer");
  headers.set("X-Robots-Tag", "noindex, nofollow, noarchive");
  headers.set(
    "Content-Security-Policy",
    "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; font-src 'self'; connect-src 'self'; frame-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
  );
  return new Response(response.body, { status: response.status, headers });
}
