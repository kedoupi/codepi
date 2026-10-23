import type { Env } from "./types";

export const MAX_BODY = 4 * 1024 * 1024;
export const encoder = new TextEncoder();

// Client-side validation failure: safe to report, and always a 400.
export class ValidationError extends Error {}

export function json(body: unknown, status = 200, headers: HeadersInit = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", ...headers },
  });
}

export async function hash(value: string) {
  return Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode(value))),
    b => b.toString(16).padStart(2, "0")).join("");
}

export async function secretHash(value: string, secret: string) {
  const key = await crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return Array.from(new Uint8Array(await crypto.subtle.sign("HMAC", key, encoder.encode(value))),
    b => b.toString(16).padStart(2, "0")).join("");
}

export function token() {
  return Array.from(crypto.getRandomValues(new Uint8Array(32)), b => b.toString(16).padStart(2, "0")).join("");
}

export function equal(a: string, b: string) {
  if (a.length !== b.length) return false;
  let result = 0;
  for (let i = 0; i < a.length; i++) result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return result === 0;
}

export function localDev(request: Request, env: Env) {
  return ["development", "test"].includes(env.ENVIRONMENT) &&
    ["localhost", "127.0.0.1", "[::1]"].includes(new URL(request.url).hostname);
}

export function cookieName(request: Request, name: string) {
  return `${new URL(request.url).protocol === "https:" ? "__Host-" : ""}gu_${name}`;
}

export function readCookie(request: Request, name: string) {
  const prefix = `${cookieName(request, name)}=`;
  return (request.headers.get("Cookie") || "").split(";").map(v => v.trim()).find(v => v.startsWith(prefix))?.slice(prefix.length) || "";
}

export function cookie(request: Request, name: string, value: string, seconds: number) {
  return `${cookieName(request, name)}=${value}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${seconds}${new URL(request.url).protocol === "https:" ? "; Secure" : ""}`;
}

export async function bodyJson(request: Request, limit = MAX_BODY): Promise<unknown> {
  if (!request.headers.get("Content-Type")?.startsWith("application/json")) throw new ValidationError("需要 JSON 请求");
  if (Number(request.headers.get("Content-Length")) > limit) throw new ValidationError("请求过大");
  const reader = request.body?.getReader();
  if (!reader) throw new ValidationError("请求为空");
  let size = 0;
  const chunks: Uint8Array[] = [];
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > limit) { await reader.cancel(); throw new ValidationError("请求过大"); }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  return JSON.parse(new TextDecoder().decode(bytes));
}

export function object(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function secureResponse(response: Response) {
  const headers = new Headers(response.headers);
  headers.set("Cache-Control", "no-store");
  headers.set("X-Content-Type-Options", "nosniff");
  headers.set("X-Frame-Options", "DENY");
  headers.set("Referrer-Policy", "no-referrer");
  headers.set("X-Robots-Tag", "noindex, nofollow, noarchive");
  headers.set("Content-Security-Policy", "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; font-src 'self'; connect-src 'self'; frame-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
  return new Response(response.body, { status: response.status, headers });
}
