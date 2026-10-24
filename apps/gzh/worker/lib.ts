import { SLOTS, type Slot } from "./types";

export const MAX_BODY = 256 * 1024;

export class ValidationError extends Error {}

export function shanghaiDate(now = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

export function nowIso(now = new Date()): string {
  return now.toISOString();
}

export function plusMs(ms: number, now = new Date()): string {
  return new Date(now.getTime() + ms).toISOString();
}

export function isIsoPast(iso: string, now = new Date()): boolean {
  return Date.parse(iso) <= now.getTime();
}

export function normalizeEmail(raw: string): string {
  return raw.trim().toLowerCase();
}

export function parseAllowlist(raw: string | undefined): string[] {
  if (!raw) return [];
  return raw
    .split(/[,;\s]+/)
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);
}

export function isSlot(value: unknown): value is Slot {
  return typeof value === "string" && (SLOTS as readonly string[]).includes(value);
}

export function isDateOnly(value: unknown): value is string {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value);
}

export function isSlug(value: unknown): value is string {
  return typeof value === "string" && /^[a-z0-9][a-z0-9-]{0,63}$/.test(value);
}

export function clientIp(request: Request): string {
  return (
    request.headers.get("CF-Connecting-IP") ||
    request.headers.get("X-Forwarded-For")?.split(",")[0]?.trim() ||
    "local"
  );
}

export function isHttps(request: Request): boolean {
  const url = new URL(request.url);
  if (url.protocol === "https:") return true;
  const forwarded = request.headers.get("X-Forwarded-Proto");
  return forwarded === "https";
}

export function sameOrigin(request: Request): boolean {
  const origin = request.headers.get("Origin");
  if (!origin) return false;
  return origin === new URL(request.url).origin;
}

export function json(data: unknown, status = 200, headers?: HeadersInit): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      ...headers,
    },
  });
}

export async function bodyJson(request: Request, limit = MAX_BODY): Promise<unknown> {
  if (!request.headers.get("Content-Type")?.startsWith("application/json")) {
    throw new ValidationError("需要 JSON 请求");
  }
  if (Number(request.headers.get("Content-Length")) > limit) {
    throw new ValidationError("请求过大");
  }
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
      throw new ValidationError("请求过大");
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

export function readCookie(request: Request, name: string): string | null {
  const header = request.headers.get("Cookie");
  if (!header) return null;
  for (const part of header.split(";")) {
    const trimmed = part.trim();
    const eq = trimmed.indexOf("=");
    if (eq < 0) continue;
    if (trimmed.slice(0, eq) === name) {
      return decodeURIComponent(trimmed.slice(eq + 1));
    }
  }
  return null;
}

export function brandName(env: { ACCOUNT_BRAND?: string }): string {
  return env.ACCOUNT_BRAND?.trim() || "珂抖屁";
}
