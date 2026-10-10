import type { Env } from "../env";
import {
  cookieSecure,
  DEV_USER_ID,
  OAUTH_STATE_COOKIE,
  SESSION_COOKIE,
} from "./config";
import {
  formatSignedCookie,
  hmacSign,
  hmacVerify,
  parseSignedCookie,
} from "./crypto";

export type SessionKind = "oauth" | "dev";

export type SessionRow = {
  id: string;
  user_id: string;
  kind: SessionKind;
  expires_at: string;
};

function cookieBase(request: Request, maxAge: number): string {
  const parts = [
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${maxAge}`,
  ];
  if (cookieSecure(request)) parts.push("Secure");
  return parts.join("; ");
}

export function setCookie(
  headers: Headers,
  request: Request,
  name: string,
  value: string,
  maxAge: number,
): void {
  headers.append(
    "Set-Cookie",
    `${name}=${value}; ${cookieBase(request, maxAge)}`,
  );
}

export function clearCookie(headers: Headers, request: Request, name: string): void {
  headers.append(
    "Set-Cookie",
    `${name}=; ${cookieBase(request, 0)}`,
  );
}

export function readCookie(request: Request, name: string): string | null {
  const header = request.headers.get("Cookie");
  if (!header) return null;
  for (const part of header.split(";")) {
    const [k, ...rest] = part.trim().split("=");
    if (k === name) return rest.join("=");
  }
  return null;
}

export async function signValue(secret: string, id: string): Promise<string> {
  return formatSignedCookie(id, await hmacSign(secret, id));
}

export async function verifySigned(
  secret: string,
  raw: string | null,
): Promise<string | null> {
  const parsed = parseSignedCookie(raw);
  if (!parsed) return null;
  const ok = await hmacVerify(secret, parsed.id, parsed.sig);
  return ok ? parsed.id : null;
}

export async function createSession(
  env: Env,
  userId: string,
  kind: SessionKind,
  ttlSeconds = 60 * 60 * 24 * 30,
): Promise<string> {
  const id = crypto.randomUUID();
  const expires = new Date(Date.now() + ttlSeconds * 1000).toISOString();
  await env.DB.prepare(
    `INSERT INTO sessions (id, user_id, kind, expires_at) VALUES (?, ?, ?, ?)`,
  )
    .bind(id, userId, kind, expires)
    .run();
  return id;
}

export async function loadSession(
  env: Env,
  sessionId: string,
): Promise<SessionRow | null> {
  const row = await env.DB.prepare(
    `SELECT id, user_id, kind, expires_at FROM sessions WHERE id = ?`,
  )
    .bind(sessionId)
    .first<SessionRow>();
  if (!row) return null;
  if (Date.parse(row.expires_at) < Date.now()) {
    await env.DB.prepare(`DELETE FROM sessions WHERE id = ?`).bind(sessionId).run();
    return null;
  }
  return row;
}

export async function deleteSession(env: Env, sessionId: string): Promise<void> {
  await env.DB.prepare(`DELETE FROM sessions WHERE id = ?`).bind(sessionId).run();
}

export async function readSessionFromRequest(
  request: Request,
  env: Env,
  secret: string,
): Promise<SessionRow | null> {
  const sid = await verifySigned(secret, readCookie(request, SESSION_COOKIE));
  if (!sid) return null;
  return loadSession(env, sid);
}

export async function attachSessionCookie(
  headers: Headers,
  request: Request,
  secret: string,
  sessionId: string,
): Promise<void> {
  setCookie(
    headers,
    request,
    SESSION_COOKIE,
    await signValue(secret, sessionId),
    60 * 60 * 24 * 30,
  );
}

export async function attachStateCookie(
  headers: Headers,
  request: Request,
  secret: string,
  state: string,
): Promise<void> {
  setCookie(
    headers,
    request,
    OAUTH_STATE_COOKIE,
    await signValue(secret, state),
    10 * 60,
  );
}

export async function readStateCookie(
  request: Request,
  secret: string,
): Promise<string | null> {
  return verifySigned(secret, readCookie(request, OAUTH_STATE_COOKIE));
}

export async function ensureDevUser(env: Env): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO users (id, email, oura_user_id) VALUES (?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET updated_at = datetime('now')`,
  )
    .bind(DEV_USER_ID, "dev@localhost", DEV_USER_ID)
    .run();
}

export { DEV_USER_ID };
