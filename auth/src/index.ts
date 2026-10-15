import { loginPage } from "./ui";
import { brandedSender, buildOtpEmail } from "../../shared/email/otp";

interface Env {
  DB: D1Database;
  OWNER_EMAIL: string;
  OTP_FROM: string;
  RESEND_API_KEY?: string;
  OTP_PEPPER: string;
  SESSION_SECRET: string;
  SSO_CLIENTS: string;
  SSO_EXTRA_REDIRECT_URIS?: string;
  AUTH_ORIGIN: string;
  ENVIRONMENT: string;
}
type Client = { secret: string; name: string; redirectUris: string[] };
/**
 * Login-page product names. The registry `name` is a write-only secret value that
 * cannot be edited in place, so product display names are applied here instead.
 */
const DISPLAY_NAMES: Record<string, string> = { oura: "健康 Health", gzh: "公众号 GZH" };
type Config = { clients: Record<string, Client>; origin: string; dev: boolean };
type Tx = { id: string; client_id: string; redirect_uri: string; state: string;
  challenge: string; expires_at: number; otp_hash: string | null; otp_expires_at: number | null; attempts: number };
type Session = { id: string; expires_at: number };
class Failure extends Error {
  constructor(public code: string, public status = 400) { super(code); }
}
const DAY = 86400_000;
const encoder = new TextEncoder();
const b64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const random = () => b64(crypto.getRandomValues(new Uint8Array(32)));
const sha = async (value: string) => b64(new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode(value))));
const loopback = (url: URL) => ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
const validToken = (value: unknown): value is string => typeof value === "string" && /^[A-Za-z0-9_-]{43}$/.test(value);
async function hash(secret: string, value: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return b64(new Uint8Array(await crypto.subtle.sign("HMAC", key, encoder.encode(value))));
}
async function equal(a: string, b: string): Promise<boolean> {
  const [x, y] = await Promise.all([sha(a), sha(b)]);
  let diff = 0;
  for (let i = 0; i < x.length; i++) diff |= x.charCodeAt(i) ^ y.charCodeAt(i);
  return diff === 0;
}
function configuration(env: Env): Config {
  try {
    const origin = new URL(env.AUTH_ORIGIN);
    const dev = ["development", "test"].includes(env.ENVIRONMENT) && loopback(origin);
    if ((!dev && origin.protocol !== "https:") || origin.username || origin.password || origin.pathname !== "/" || origin.search || origin.hash
      || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(env.OWNER_EMAIL) || !env.OTP_FROM
      || env.SESSION_SECRET?.length < 32 || env.OTP_PEPPER?.length < 32
      || !env.SESSION_SECRET || !env.OTP_PEPPER) throw new Error();
    const clients = JSON.parse(env.SSO_CLIENTS) as Record<string, Client>;
    if (!clients || Array.isArray(clients) || typeof clients !== "object" || !Object.keys(clients).length) throw new Error();
    // Public callback registrations can evolve without rotating client credentials.
    const extra: unknown = JSON.parse(env.SSO_EXTRA_REDIRECT_URIS || "{}");
    if (!extra || typeof extra !== "object" || Array.isArray(extra)) throw new Error();
    for (const [id, uris] of Object.entries(extra)) {
      if (!Object.hasOwn(clients, id) || !Array.isArray(clients[id]?.redirectUris)
        || !Array.isArray(uris) || !uris.every(uri => typeof uri === "string")) throw new Error();
      clients[id].redirectUris = [...new Set([...clients[id].redirectUris, ...uris])];
    }
    for (const [id, c] of Object.entries(clients)) {
      if (!["gu", "oura", "gzh", "desk"].includes(id) || typeof c?.secret !== "string" || c.secret.length < 32
        || typeof c.name !== "string" || c.name.length > 80 || !Array.isArray(c.redirectUris) || !c.redirectUris.length) throw new Error();
      for (const uri of c.redirectUris) {
        const u = new URL(uri);
        if ((u.protocol !== "https:" && !(dev && u.protocol === "http:" && loopback(u)))
          || u.username || u.password || u.hash || u.search || u.pathname !== "/api/auth/callback") throw new Error();
      }
    }
    return { clients, origin: origin.origin, dev };
  } catch { throw new Failure("auth_not_configured", 503); }
}
function cookieName(request: Request, kind: string) {
  return `${new URL(request.url).protocol === "https:" ? "__Host-" : ""}kdp_auth_${kind}`;
}
function cookie(request: Request, kind: string, value: string, ttl: number) {
  return `${cookieName(request, kind)}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${ttl}`
    + (new URL(request.url).protocol === "https:" ? "; Secure" : "");
}
function readCookie(request: Request, kind: string): string | null {
  const key = cookieName(request, kind) + "=";
  const parts = (request.headers.get("Cookie") || "").split(";").map(s => s.trim()).filter(s => s.startsWith(key));
  return parts.length === 1 && validToken(parts[0].slice(key.length)) ? parts[0].slice(key.length) : null;
}
function secure(response: Response, nonce?: string): Response {
  const headers = new Headers(response.headers);
  headers.set("Cache-Control", "no-store");
  headers.set("Referrer-Policy", "no-referrer");
  headers.set("X-Content-Type-Options", "nosniff");
  headers.set("Content-Security-Policy", `default-src 'none'; script-src ${nonce ? `'nonce-${nonce}'` : "'none'"}; style-src ${nonce ? `'nonce-${nonce}'` : "'none'"}; connect-src 'self'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'`);
  return new Response(response.body, { status: response.status, headers });
}
async function body(request: Request): Promise<Record<string, unknown>> {
  if (!(request.headers.get("Content-Type") || "").toLowerCase().startsWith("application/json")) throw new Failure("invalid_request");
  const reader = request.body?.getReader();
  if (!reader) throw new Failure("invalid_request");
  let size = 0, text = "";
  const decoder = new TextDecoder();
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > 4096) { await reader.cancel(); throw new Failure("invalid_request", 413); }
    text += decoder.decode(value, { stream: true });
  }
  try {
    const data: unknown = JSON.parse(text + decoder.decode());
    if (!data || typeof data !== "object" || Array.isArray(data)) throw new Error();
    return data as Record<string, unknown>;
  } catch { throw new Failure("invalid_request"); }
}
async function readSession(request: Request, env: Env): Promise<Session | null> {
  const raw = readCookie(request, "session");
  if (!raw) return null;
  return env.DB.prepare("SELECT id,expires_at FROM auth_sessions WHERE id=? AND expires_at>? AND revoked_at IS NULL")
    .bind(await hash(env.SESSION_SECRET, raw), Date.now()).first<Session>();
}
async function transaction(request: Request, env: Env): Promise<Tx> {
  const raw = readCookie(request, "transaction");
  if (!raw) throw new Failure("invalid_transaction");
  const tx = await env.DB.prepare("SELECT * FROM auth_transactions WHERE id=? AND expires_at>? AND consumed_at IS NULL")
    .bind(await hash(env.SESSION_SECRET, raw), Date.now()).first<Tx>();
  if (!tx) throw new Failure("invalid_transaction");
  return tx;
}
function destination(tx: Pick<Tx, "redirect_uri" | "state">, code: string) {
  const url = new URL(tx.redirect_uri);
  url.search = new URLSearchParams({ code, state: tx.state }).toString();
  return url.href;
}
async function issueCode(env: Env, session: Session, tx: Pick<Tx, "client_id" | "redirect_uri" | "state" | "challenge">): Promise<string> {
  const code = random(), now = Date.now();
  const result = await env.DB.prepare(`INSERT INTO auth_codes (id,session_id,client_id,redirect_uri,challenge,expires_at)
    SELECT ?,id,?,?,?,? FROM auth_sessions WHERE id=? AND revoked_at IS NULL AND expires_at>?`)
    .bind(await hash(env.SESSION_SECRET, code), tx.client_id, tx.redirect_uri, tx.challenge,
      Math.min(now + 60_000, session.expires_at), session.id, now).run();
  if (result.meta.changes !== 1) throw new Failure("invalid_transaction");
  return destination(tx, code);
}
async function authorize(request: Request, env: Env, cfg: Config): Promise<Response> {
  const params = new URL(request.url).searchParams;
  const clientId = params.get("client_id") || "";
  const client = Object.hasOwn(cfg.clients, clientId) ? cfg.clients[clientId] : undefined;
  const redirect = params.get("redirect_uri") || "", state = params.get("state") || "", challenge = params.get("code_challenge") || "";
  if (!client || !client.redirectUris.includes(redirect) || !/^[A-Za-z0-9_-]{16,128}$/.test(state)
    || !validToken(challenge) || params.get("code_challenge_method") !== "S256") throw new Failure("invalid_request");
  const tx = { client_id: clientId, redirect_uri: redirect, state, challenge };
  const session = await readSession(request, env);
  if (session) return secure(new Response(null, { status: 302, headers: { Location: await issueCode(env, session, tx) } }));
  const raw = random();
  await env.DB.prepare("INSERT INTO auth_transactions (id,client_id,redirect_uri,state,challenge,expires_at) VALUES (?,?,?,?,?,?)")
    .bind(await hash(env.SESSION_SECRET, raw), clientId, redirect, state, challenge, Date.now() + 600_000).run();
  const nonce = random();
  return secure(new Response(loginPage(DISPLAY_NAMES[clientId] ?? client.name, env.OWNER_EMAIL, nonce), {
    headers: { "Content-Type": "text/html; charset=utf-8", "Set-Cookie": cookie(request, "transaction", raw, 600) },
  }), nonce);
}
async function requestOtp(request: Request, env: Env, cfg: Config): Promise<Response> {
  await body(request);
  const tx = await transaction(request, env), now = Date.now(), event = random();
  if (!env.RESEND_API_KEY && !cfg.dev) throw new Failure("mail_unavailable", 503);
  // Reserve the global owner budget atomically before contacting the mail provider.
  const reserved = await env.DB.prepare(`INSERT INTO auth_otp_sends (id,created_at)
    SELECT ?,? WHERE NOT EXISTS (SELECT 1 FROM auth_otp_sends WHERE created_at>?)
    AND (SELECT COUNT(*) FROM auth_otp_sends WHERE created_at>?)<3
    AND (SELECT COUNT(*) FROM auth_otp_sends WHERE created_at>=?)<10`)
    .bind(event, now, now - 60_000, now - 900_000, Math.floor(now / DAY) * DAY).run();
  if (reserved.meta.changes !== 1) throw new Failure("rate_limited", 429);
  let value: number;
  do { value = crypto.getRandomValues(new Uint32Array(1))[0]; } while (value >= 4294000000);
  const code = String(value % 1_000_000).padStart(6, "0");
  await env.DB.prepare("UPDATE auth_transactions SET otp_hash=?,otp_expires_at=?,attempts=0 WHERE id=? AND consumed_at IS NULL")
    .bind(await hash(env.OTP_PEPPER, `${tx.id}:${code}`), now + 480_000, tx.id).run();
  if (env.RESEND_API_KEY) {
    try {
      const response = await fetch("https://api.resend.com/emails", {
        method: "POST", headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, "Content-Type": "application/json", "Idempotency-Key": event },
        body: JSON.stringify({ from: brandedSender(env.OTP_FROM), to: [env.OWNER_EMAIL],
          ...buildOtpEmail(code, `统一登录 · ${cfg.clients[tx.client_id].name}`) }),
        signal: AbortSignal.timeout(10_000),
      });
      await response.body?.cancel();
      if (!response.ok) throw new Error();
    } catch {
      await env.DB.prepare("UPDATE auth_transactions SET otp_hash=NULL WHERE id=?").bind(tx.id).run();
      throw new Failure("mail_unavailable", 503);
    }
  }
  return secure(Response.json({ ok: true, ...(cfg.dev && !env.RESEND_API_KEY ? { dev_otp: code } : {}) }));
}
async function verifyOtp(request: Request, env: Env): Promise<Response> {
  const data = await body(request), tx = await transaction(request, env), now = Date.now();
  const attempt = await env.DB.prepare(`UPDATE auth_transactions SET attempts=attempts+1
    WHERE id=? AND consumed_at IS NULL AND expires_at>? AND otp_expires_at>? AND attempts<5
    RETURNING otp_hash,otp_expires_at`)
    .bind(tx.id, now, now).first<{ otp_hash: string; otp_expires_at: number }>();
  if (!attempt || typeof data.code !== "string" || !/^\d{6}$/.test(data.code)) throw new Failure("invalid_code");
  if (!await equal(attempt.otp_hash, await hash(env.OTP_PEPPER, `${tx.id}:${data.code}`))) throw new Failure("invalid_code");
  // A resend may replace the OTP after the attempt is reserved. Consume only
  // the exact OTP generation whose attempt budget this request decremented.
  const consumed = await env.DB.prepare(`UPDATE auth_transactions SET consumed_at=?
    WHERE id=? AND consumed_at IS NULL AND expires_at>? AND otp_expires_at=? AND otp_hash=? RETURNING id`)
    .bind(now, tx.id, now, attempt.otp_expires_at, attempt.otp_hash).first();
  if (!consumed) throw new Failure("invalid_code");
  const raw = random(), session = { id: await hash(env.SESSION_SECRET, raw), expires_at: now + 30 * DAY };
  await env.DB.prepare("INSERT INTO auth_sessions (id,created_at,expires_at) VALUES (?,?,?)")
    .bind(session.id, now, session.expires_at).run();
  const redirect = await issueCode(env, session, tx);
  const headers = new Headers({ "Content-Type": "application/json" });
  headers.append("Set-Cookie", cookie(request, "session", raw, 30 * 86400));
  headers.append("Set-Cookie", cookie(request, "transaction", "", 0));
  return secure(new Response(JSON.stringify({ ok: true, redirect }), { headers }));
}
async function internal(request: Request, env: Env, cfg: Config, path: string): Promise<Response> {
  let id = "", secret = "";
  try {
    const header = request.headers.get("Authorization") || "";
    if (!header.startsWith("Basic ")) throw new Error();
    const decoded = atob(header.slice(6)), colon = decoded.indexOf(":");
    id = decoded.slice(0, colon); secret = decoded.slice(colon + 1);
  } catch { throw new Failure("unauthorized", 401); }
  const client = Object.hasOwn(cfg.clients, id) ? cfg.clients[id] : undefined;
  if (!client || !await equal(secret, client.secret)) throw new Failure("unauthorized", 401);
  const data = await body(request), now = Date.now();
  if (path === "/internal/exchange") {
    if (!validToken(data.code) || typeof data.code_verifier !== "string" || !/^[A-Za-z0-9._~-]{43,128}$/.test(data.code_verifier)
      || typeof data.redirect_uri !== "string" || !client.redirectUris.includes(data.redirect_uri)) throw new Failure("invalid_login");
    const code = await env.DB.prepare(`UPDATE auth_codes SET consumed_at=? WHERE id=? AND client_id=?
      AND redirect_uri=? AND challenge=? AND expires_at>? AND consumed_at IS NULL
      AND EXISTS(SELECT 1 FROM auth_sessions s WHERE s.id=auth_codes.session_id AND s.revoked_at IS NULL AND s.expires_at>?)
      RETURNING session_id`)
      .bind(now, await hash(env.SESSION_SECRET, data.code), id, data.redirect_uri, await sha(data.code_verifier), now, now)
      .first<{ session_id: string }>();
    if (!code) throw new Failure("invalid_login");
    const raw = random();
    const ref = await env.DB.prepare(`INSERT INTO auth_refs (id,session_id,client_id,expires_at)
      SELECT ?,id,?,expires_at FROM auth_sessions WHERE id=? AND revoked_at IS NULL AND expires_at>? RETURNING expires_at`)
      .bind(await hash(env.SESSION_SECRET, raw), id, code.session_id, now).first<{ expires_at: number }>();
    if (!ref) throw new Failure("invalid_login");
    return secure(Response.json({ subject: "kdp-owner", session_ref: raw, expires_at: ref.expires_at }));
  }
  if (!validToken(data.session_ref)) throw new Failure("invalid_request");
  const refHash = await hash(env.SESSION_SECRET, data.session_ref);
  if (path === "/internal/session") {
    const session = await env.DB.prepare(`SELECT s.expires_at FROM auth_refs r JOIN auth_sessions s ON s.id=r.session_id
      WHERE r.id=? AND r.client_id=? AND r.expires_at>? AND s.expires_at>? AND s.revoked_at IS NULL`)
      .bind(refHash, id, now, now).first<{ expires_at: number }>();
    return secure(Response.json(session ? { active: true, subject: "kdp-owner", expires_at: session.expires_at } : { active: false }));
  }
  if (path === "/internal/logout") {
    const ref = await env.DB.prepare("SELECT session_id FROM auth_refs WHERE id=? AND client_id=?")
      .bind(refHash, id).first<{ session_id: string }>();
    if (ref) await env.DB.batch([
      env.DB.prepare("UPDATE auth_sessions SET revoked_at=? WHERE id=? AND revoked_at IS NULL").bind(now, ref.session_id),
      env.DB.prepare("DELETE FROM auth_codes WHERE session_id=?").bind(ref.session_id),
      env.DB.prepare("DELETE FROM auth_refs WHERE session_id=?").bind(ref.session_id),
    ]);
    return secure(Response.json({ ok: true }));
  }
  throw new Failure("not_found", 404);
}
async function route(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url), cfg = configuration(env);
  if (url.protocol !== "https:" && !(cfg.dev && loopback(url))) throw new Failure("https_required");
  if (url.pathname.startsWith("/internal/")) {
    if (request.method !== "POST") throw new Failure("method_not_allowed", 405);
    return internal(request, env, cfg, url.pathname);
  }
  if (url.origin !== cfg.origin) throw new Failure("origin_not_allowed", 403);
  if (url.pathname === "/api/health" && request.method === "GET") return secure(Response.json({ ok: true, service: "kdp-auth", mailConfigured: Boolean(env.RESEND_API_KEY) }));
  if (url.pathname === "/authorize" && request.method === "GET") return authorize(request, env, cfg);
  if (["/api/auth/request-otp", "/api/auth/verify-otp"].includes(url.pathname)) {
    if (request.method !== "POST") throw new Failure("method_not_allowed", 405);
    if (request.headers.get("Origin") !== cfg.origin) throw new Failure("origin_not_allowed", 403);
    return url.pathname.endsWith("request-otp") ? requestOtp(request, env, cfg) : verifyOtp(request, env);
  }
  throw new Failure("not_found", 404);
}
export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    try { return await route(request, env); }
    catch (error) {
      return secure(Response.json({ error: error instanceof Failure ? error.code : "auth_unavailable" },
        { status: error instanceof Failure ? error.status : 503 }));
    }
  },
  async scheduled(_controller: ScheduledController, env: Env): Promise<void> {
    const now = Date.now();
    await env.DB.batch([
      ...["auth_transactions", "auth_codes", "auth_refs", "auth_sessions"].map(table =>
        env.DB.prepare(`DELETE FROM ${table} WHERE id IN (SELECT id FROM ${table} WHERE expires_at<? LIMIT 1000)`).bind(now)),
      env.DB.prepare("DELETE FROM auth_otp_sends WHERE created_at<?").bind(now - DAY),
    ]);
  },
} satisfies ExportedHandler<Env>;
