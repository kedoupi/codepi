/** First-party SSO adapter shared by the independently deployed KDP products. */
export interface SsoEnv {
  DB: D1Database;
  AUTH?: Fetcher;
  AUTH_ORIGIN?: string;
  AUTH_CLIENT_ID?: string;
  AUTH_CLIENT_SECRET?: string;
  SSO_ENABLED?: string;
}

export class SsoError extends Error {
  code: string;
  status: number;
  constructor(code: string, status: number) {
    super(code);
    this.code = code;
    this.status = status;
  }
}

export type SsoSession = { id: string; userId: string; subject: string; expiresAt: number };
type Config = { origin: string; clientId: string; secret: string; service: Fetcher };
type SessionRow = {
  id: string; user_id: string; subject: string; central_ref: string;
  expires_at: number; created_at: number;
};
type Transaction = {
  id: string; state_hash: string; code_verifier: string; return_to: string;
  expires_at: number; consumed_at: number | null;
};
const OWNER_SUBJECT = "kdp-owner";
const encoder = new TextEncoder();
const TRANSACTION_SECONDS = 600;

export function ssoEnabled(env: SsoEnv): boolean {
  return env.SSO_ENABLED === "1";
}

function config(env: SsoEnv): Config {
  if (!env.AUTH || !env.AUTH_ORIGIN || !env.AUTH_CLIENT_SECRET
    || !["gu", "oura", "gzh", "desk"].includes(env.AUTH_CLIENT_ID ?? "")) {
    throw new SsoError("auth_not_configured", 503);
  }
  let origin: URL;
  try { origin = new URL(env.AUTH_ORIGIN); } catch { throw new SsoError("auth_not_configured", 503); }
  if ((origin.protocol !== "https:" && !(origin.protocol === "http:" && loopback(origin)))
    || origin.username || origin.password || origin.search || origin.hash || origin.pathname !== "/") {
    throw new SsoError("auth_not_configured", 503);
  }
  return { origin: origin.origin, clientId: env.AUTH_CLIENT_ID!, secret: env.AUTH_CLIENT_SECRET, service: env.AUTH };
}

function loopback(url: URL): boolean {
  return ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
}

function secureRequest(request: Request): void {
  const url = new URL(request.url);
  if (url.protocol !== "https:" && !(url.protocol === "http:" && loopback(url))) {
    throw new SsoError("https_required", 400);
  }
}

function cookieName(request: Request, clientId: string, kind: string): string {
  return `${new URL(request.url).protocol === "https:" ? "__Host-" : ""}kdp_${clientId}_${kind}`;
}

function cookie(request: Request, clientId: string, kind: string, value: string, seconds: number): string {
  return `${cookieName(request, clientId, kind)}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${seconds}`
    + (new URL(request.url).protocol === "https:" ? "; Secure" : "");
}

function readCookie(request: Request, clientId: string, kind: string): string | null {
  const prefix = `${cookieName(request, clientId, kind)}=`;
  const values = (request.headers.get("cookie") ?? "").split(";").map(v => v.trim()).filter(v => v.startsWith(prefix));
  if (values.length !== 1) return null;
  const raw = values[0].slice(prefix.length);
  return /^[A-Za-z0-9_-]{43}$/.test(raw) ? raw : null;
}

function base64url(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function random(): string {
  return base64url(crypto.getRandomValues(new Uint8Array(32)));
}

async function hash(value: string): Promise<string> {
  return base64url(new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode(value))));
}

function localReturn(value: string | null, origin: string): string {
  if (!value || !value.startsWith("/") || value.startsWith("//") || /[\\\u0000-\u001f]/.test(value)) return "/";
  try {
    const url = new URL(value, origin);
    if (url.origin !== origin || url.pathname.startsWith("/api/auth/")) return "/";
    return url.pathname + url.search + url.hash;
  } catch { return "/"; }
}

function noStoreHeaders(): Headers {
  return new Headers({ "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" });
}

async function central<T>(cfg: Config, path: string, payload: unknown): Promise<T> {
  let response: Response;
  try {
    response = await cfg.service.fetch(`https://auth.internal/internal/${path}`, {
      method: "POST",
      headers: {
        Authorization: `Basic ${btoa(`${cfg.clientId}:${cfg.secret}`)}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(8_000),
    });
  } catch { throw new SsoError("auth_unavailable", 503); }
  if (!response.ok) {
    await response.body?.cancel();
    if (path === "exchange" && [400, 401, 403, 409].includes(response.status)) {
      throw new SsoError("invalid_login", 400);
    }
    throw new SsoError("auth_unavailable", 503);
  }
  try { return await response.json() as T; }
  catch { throw new SsoError("auth_unavailable", 503); }
}

async function refKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey("raw", await crypto.subtle.digest("SHA-256", encoder.encode(secret)),
    "AES-GCM", false, ["encrypt", "decrypt"]);
}

async function sealRef(cfg: Config, id: string, userId: string, value: string): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt({
    name: "AES-GCM", iv, additionalData: encoder.encode(`${cfg.clientId}:${id}:${userId}`),
  }, await refKey(cfg.secret), encoder.encode(value));
  return base64url(iv) + "." + base64url(new Uint8Array(ciphertext));
}

async function openRef(cfg: Config, row: SessionRow): Promise<string> {
  try {
    const decode = (v: string) => Uint8Array.from(atob(v.replace(/-/g, "+").replace(/_/g, "/")), c => c.charCodeAt(0));
    const [iv, body] = row.central_ref.split(".");
    const plain = await crypto.subtle.decrypt({
      name: "AES-GCM", iv: decode(iv), additionalData: encoder.encode(`${cfg.clientId}:${row.id}:${row.user_id}`),
    }, await refKey(cfg.secret), decode(body));
    return new TextDecoder().decode(plain);
  } catch { throw new SsoError("auth_unavailable", 503); }
}

/** Start one browser-bound PKCE transaction; no identity is accepted from URLs. */
export async function beginLogin(request: Request, env: SsoEnv): Promise<Response> {
  secureRequest(request);
  if (request.method !== "GET") throw new SsoError("method_not_allowed", 405);
  const cfg = config(env);
  const url = new URL(request.url);
  const raw = random(), state = random(), verifier = random();
  const now = Date.now();
  await env.DB.batch([
    env.DB.prepare("DELETE FROM kdp_sso_transactions WHERE id IN (SELECT id FROM kdp_sso_transactions WHERE expires_at < ? LIMIT 100)")
      .bind(now),
    env.DB.prepare("DELETE FROM kdp_sso_sessions WHERE id IN (SELECT id FROM kdp_sso_sessions WHERE expires_at < ? LIMIT 100)")
      // Keep expired app references long enough to revoke a 30-day central session.
      .bind(now - 30 * 86400_000),
    env.DB.prepare(`INSERT INTO kdp_sso_transactions
      (id,state_hash,code_verifier,return_to,created_at,expires_at) VALUES (?,?,?,?,?,?)`)
      .bind(await hash(raw), await hash(state), verifier, localReturn(url.searchParams.get("return"), url.origin),
        now, now + TRANSACTION_SECONDS * 1000),
  ]);
  const target = new URL("/authorize", cfg.origin);
  target.search = new URLSearchParams({
    client_id: cfg.clientId, redirect_uri: `${url.origin}/api/auth/callback`,
    state, code_challenge: await hash(verifier), code_challenge_method: "S256",
  }).toString();
  const headers = noStoreHeaders();
  headers.set("Location", target.href);
  headers.append("Set-Cookie", cookie(request, cfg.clientId, "transaction", raw, TRANSACTION_SECONDS));
  return new Response(null, { status: 302, headers });
}

export async function finishLogin(
  request: Request, env: SsoEnv, opts: { userId: string; ttlSeconds: number },
): Promise<Response> {
  secureRequest(request);
  if (request.method !== "GET") throw new SsoError("method_not_allowed", 405);
  const cfg = config(env);
  const url = new URL(request.url);
  const raw = readCookie(request, cfg.clientId, "transaction");
  const state = url.searchParams.get("state"), code = url.searchParams.get("code");
  if (!raw || !state || !code || code.length > 512 || state.length > 512 || url.searchParams.has("error")
    || !opts.userId || !Number.isInteger(opts.ttlSeconds) || opts.ttlSeconds <= 0) {
    throw new SsoError("invalid_login", 400);
  }
  const now = Date.now();
  const tx = await env.DB.prepare(`UPDATE kdp_sso_transactions SET consumed_at=?
    WHERE id=? AND state_hash=? AND consumed_at IS NULL AND expires_at>?
    RETURNING *`).bind(now, await hash(raw), await hash(state), now).first<Transaction>();
  if (!tx) throw new SsoError("invalid_login", 400);
  const result = await central<{ subject: string; session_ref: string; expires_at: number }>(cfg, "exchange", {
    code, redirect_uri: `${url.origin}/api/auth/callback`, code_verifier: tx.code_verifier,
  });
  if (!result || result.subject !== OWNER_SUBJECT || typeof result.session_ref !== "string"
    || !result.session_ref || result.session_ref.length > 512
    || !Number.isFinite(result.expires_at) || result.expires_at <= now) {
    throw new SsoError("invalid_login", 400);
  }
  const expires = Math.min(result.expires_at, now + Math.min(opts.ttlSeconds, 30 * 86400) * 1000);
  const rawSession = random(), id = await hash(rawSession);
  await env.DB.prepare(`INSERT INTO kdp_sso_sessions
    (id,user_id,subject,central_ref,expires_at,created_at) VALUES (?,?,?,?,?,?)`)
    .bind(id, opts.userId, result.subject, await sealRef(cfg, id, opts.userId, result.session_ref), expires, now).run();
  const headers = noStoreHeaders();
  headers.set("Location", localReturn(tx.return_to, url.origin));
  headers.append("Set-Cookie", cookie(request, cfg.clientId, "session", rawSession, Math.floor((expires - now) / 1000)));
  // This cookie is never accepted for authentication. It only retains the
  // revocation handle after a shorter (GU/gzh) login cookie has expired.
  headers.append("Set-Cookie", cookie(request, cfg.clientId, "logout", rawSession,
    Math.floor((Math.min(result.expires_at, now + 30 * 86400_000) - now) / 1000)));
  headers.append("Set-Cookie", cookie(request, cfg.clientId, "transaction", "", 0));
  return new Response(null, { status: 303, headers });
}

export async function readSsoSession(request: Request, env: SsoEnv): Promise<SsoSession | null> {
  secureRequest(request);
  const cfg = config(env);
  const raw = readCookie(request, cfg.clientId, "session");
  if (!raw) return null;
  const row = await env.DB.prepare("SELECT * FROM kdp_sso_sessions WHERE id=? AND expires_at>?")
    .bind(await hash(raw), Date.now()).first<SessionRow>();
  if (!row) return null;
  const result = await central<{ active: boolean; subject?: string; expires_at?: number }>(cfg, "session", {
    session_ref: await openRef(cfg, row),
  });
  if (!result || typeof result.active !== "boolean") throw new SsoError("auth_unavailable", 503);
  if (!result.active) return null;
  if (result.subject !== OWNER_SUBJECT || result.subject !== row.subject
    || typeof result.expires_at !== "number" || !Number.isFinite(result.expires_at)) {
    throw new SsoError("auth_unavailable", 503);
  }
  if (result.expires_at <= Date.now()) return null;
  return { id: row.id, userId: row.user_id, subject: row.subject, expiresAt: Math.min(row.expires_at, result.expires_at) };
}

export async function logoutSso(request: Request, env: SsoEnv): Promise<Response> {
  secureRequest(request);
  if (request.method !== "POST") throw new SsoError("method_not_allowed", 405);
  if (request.headers.get("Origin") !== new URL(request.url).origin) {
    throw new SsoError("origin_not_allowed", 403);
  }
  const cfg = config(env);
  const raw = readCookie(request, cfg.clientId, "session") ?? readCookie(request, cfg.clientId, "logout");
  if (raw) {
    // Even an expired local session can revoke the still-live central browser session.
    const row = await env.DB.prepare("SELECT * FROM kdp_sso_sessions WHERE id=?").bind(await hash(raw)).first<SessionRow>();
    if (row) {
      const result = await central<{ ok: boolean }>(cfg, "logout", { session_ref: await openRef(cfg, row) });
      if (result?.ok !== true) throw new SsoError("auth_unavailable", 503);
      await env.DB.prepare("DELETE FROM kdp_sso_sessions WHERE id=?").bind(row.id).run();
    }
  }
  const tx = readCookie(request, cfg.clientId, "transaction");
  if (tx) await env.DB.prepare("DELETE FROM kdp_sso_transactions WHERE id=?").bind(await hash(tx)).run();
  const headers = noStoreHeaders();
  headers.set("Content-Type", "application/json");
  headers.append("Set-Cookie", cookie(request, cfg.clientId, "session", "", 0));
  headers.append("Set-Cookie", cookie(request, cfg.clientId, "logout", "", 0));
  headers.append("Set-Cookie", cookie(request, cfg.clientId, "transaction", "", 0));
  return new Response(JSON.stringify({ ok: true }), { headers });
}

export function ssoErrorResponse(error: unknown): Response {
  const known = error instanceof SsoError;
  return Response.json({ error: known ? error.code : "auth_unavailable" }, {
    status: known ? error.status : 503, headers: noStoreHeaders(),
  });
}
