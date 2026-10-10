import type { Env } from "../env";

/** Documented mock client_id for local / DEV authorize URL shape (not a real Oura app). */
export const DEV_PLACEHOLDER_CLIENT_ID = "oura_dev_placeholder_client_id";

/** Local-only fallbacks — never used when the request host is a public production host. */
export const DEV_FALLBACK_ENCRYPTION_KEY =
  "dev-only-token-encryption-key-not-for-prod";
export const DEV_FALLBACK_SESSION_SECRET =
  "dev-only-session-secret-not-for-prod";

export const SESSION_COOKIE = "oura_session";
export const OAUTH_STATE_COOKIE = "oura_oauth_state";
export const DEV_USER_ID = "dev-local";

export function requestHost(request: Request): string {
  return new URL(request.url).hostname;
}

export function isLocalHost(request: Request): boolean {
  const host = requestHost(request);
  return host === "localhost" || host === "127.0.0.1" || host === "[::1]";
}

/** DEV demo paths: explicit flag, or local wrangler (tonight verify without secrets). */
export function allowDevLogin(request: Request, env: Env): boolean {
  const flag = (env.ALLOW_DEV_LOGIN ?? "").toLowerCase();
  return flag === "1" || flag === "true" || isLocalHost(request);
}

export function oauthConfigured(env: Env): boolean {
  return Boolean(env.OURA_CLIENT_ID && env.OURA_CLIENT_SECRET);
}

export function resolveClientId(request: Request, env: Env): string | null {
  if (env.OURA_CLIENT_ID) return env.OURA_CLIENT_ID;
  if (allowDevLogin(request, env)) return DEV_PLACEHOLDER_CLIENT_ID;
  return null;
}

export function resolveEncryptionKey(request: Request, env: Env): string | null {
  if (env.TOKEN_ENCRYPTION_KEY) return env.TOKEN_ENCRYPTION_KEY;
  if (allowDevLogin(request, env)) return DEV_FALLBACK_ENCRYPTION_KEY;
  return null;
}

export function resolveSessionSecret(request: Request, env: Env): string | null {
  if (env.SESSION_SECRET) return env.SESSION_SECRET;
  if (allowDevLogin(request, env)) return DEV_FALLBACK_SESSION_SECRET;
  return null;
}

export function frontendOrigin(request: Request, env: Env): string {
  if (env.FRONTEND_ORIGIN) return env.FRONTEND_ORIGIN.replace(/\/$/, "");
  if (isLocalHost(request)) return "http://localhost:5173";
  return new URL(request.url).origin;
}

export function redirectUri(request: Request, env: Env): string {
  if (env.OURA_REDIRECT_URI) return env.OURA_REDIRECT_URI;
  return `${frontendOrigin(request, env)}/api/auth/oura/callback`;
}

export function jsonError(
  error: string,
  status: number,
  extra?: Record<string, unknown>,
): Response {
  return Response.json({ error, ...extra }, { status });
}

export function cookieSecure(request: Request): boolean {
  return new URL(request.url).protocol === "https:";
}
