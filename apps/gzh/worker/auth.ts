import { hashSecret, randomDigits, randomToken, timingSafeEqual } from "./crypto";
import { beginLogin, finishLogin, logoutSso, readSsoSession, ssoEnabled, SsoError } from "../../../packages/shared/auth/client";
import {
  brandName,
  clientIp,
  isHttps,
  json,
  normalizeEmail,
  nowIso,
  parseAllowlist,
  plusMs,
  readCookie,
} from "./lib";
import { createMailer, exposeDevOtp, type Mailer } from "./mail";
import {
  OTP_MAX_ATTEMPTS,
  OTP_TTL_MS,
  SESSION_COOKIE,
  SESSION_TTL_SECONDS,
  type Account,
  type AuthedAccount,
} from "./types";

const GENERIC_OTP_MSG = "若在名单内将发送验证码";

interface RequestOtpBody {
  email?: unknown;
}

interface VerifyOtpBody {
  email?: unknown;
  code?: unknown;
}

export async function findAccountByEmail(env: Env, email: string): Promise<Account | null> {
  return env.DB.prepare(
    `SELECT id, email, display_name, role, active FROM accounts WHERE email = ?`,
  )
    .bind(email)
    .first<Account>();
}

export async function requireAccount(env: Env, request: Request): Promise<AuthedAccount | null> {
  if (ssoEnabled(env)) {
    const session = await readSsoSession(request, env);
    if (!session || session.subject !== "kdp-owner" || session.userId !== "acc_owner_kdp") return null;
    return activeOwner(env);
  }
  const token = readCookie(request, SESSION_COOKIE);
  if (!token || !env.SESSION_SECRET) return null;
  const sessionId = await hashSecret(token, env.SESSION_SECRET);
  const row = await env.DB.prepare(
    `SELECT s.id, s.account_id, s.expires_at, a.email, a.display_name, a.role, a.active
     FROM sessions s
     JOIN accounts a ON a.id = s.account_id
     WHERE s.id = ?`,
  )
    .bind(sessionId)
    .first<{
      id: string;
      account_id: string;
      expires_at: string;
      email: string;
      display_name: string;
      role: Account["role"];
      active: number;
    }>();

  if (!row || row.active !== 1) return null;
  if (Date.parse(row.expires_at) <= Date.now()) {
    await env.DB.prepare(`DELETE FROM sessions WHERE id = ?`).bind(sessionId).run();
    return null;
  }

  return {
    id: row.account_id,
    email: row.email,
    display_name: row.display_name,
    role: row.role,
    active: row.active,
  };
}

function cookieHeader(token: string, request: Request, maxAge: number): string {
  const parts = [
    `${SESSION_COOKIE}=${token}`,
    "HttpOnly",
    "Path=/",
    "SameSite=Lax",
    `Max-Age=${maxAge}`,
  ];
  if (isHttps(request)) parts.push("Secure");
  return parts.join("; ");
}

function allowlisted(env: Env, email: string): boolean {
  return parseAllowlist(env.ALLOWLIST).includes(email);
}

async function ipHash(env: Env, request: Request): Promise<string> {
  return hashSecret(clientIp(request), env.OTP_PEPPER || env.SESSION_SECRET || "dev");
}

export async function handleRequestOtp(
  request: Request,
  env: Env,
  mailer: Mailer = createMailer(env),
): Promise<Response> {
  if (ssoEnabled(env)) return json({ ok: false, error: "请使用统一登录" }, 404);
  let body: RequestOtpBody;
  try {
    body = (await request.json()) as RequestOtpBody;
  } catch {
    return json({ ok: true, message: GENERIC_OTP_MSG });
  }

  const email = typeof body.email === "string" ? normalizeEmail(body.email) : "";
  const generic = json({ ok: true, message: GENERIC_OTP_MSG });

  if (!email || !email.includes("@") || !env.OTP_PEPPER) {
    return generic;
  }
  if (!allowlisted(env, email)) {
    return generic;
  }

  const existing = await findAccountByEmail(env, email);
  if (existing && existing.active !== 1) {
    return generic;
  }

  const now = new Date();
  const hashedIp = await ipHash(env, request);
  const since60 = plusMs(-60_000, now);
  const since15m = plusMs(-15 * 60_000, now);
  const sinceDay = plusMs(-24 * 60 * 60_000, now);

  const emailRecent = await env.DB.prepare(
    `SELECT COUNT(*) AS n FROM otp_codes WHERE email = ? AND created_at > ?`,
  )
    .bind(email, since60)
    .first<{ n: number }>();
  if ((emailRecent?.n ?? 0) > 0) {
    return generic;
  }

  const emailWindow = await env.DB.prepare(
    `SELECT COUNT(*) AS n FROM otp_codes WHERE email = ? AND created_at > ?`,
  )
    .bind(email, since15m)
    .first<{ n: number }>();
  if ((emailWindow?.n ?? 0) >= 3) {
    return generic;
  }

  const emailDay = await env.DB.prepare(
    `SELECT COUNT(*) AS n FROM otp_codes WHERE email = ? AND created_at > ?`,
  )
    .bind(email, sinceDay)
    .first<{ n: number }>();
  if ((emailDay?.n ?? 0) >= 10) {
    return generic;
  }

  const ipWindow = await env.DB.prepare(
    `SELECT COUNT(*) AS n FROM otp_codes WHERE ip_hash = ? AND created_at > ?`,
  )
    .bind(hashedIp, since15m)
    .first<{ n: number }>();
  if ((ipWindow?.n ?? 0) >= 10) {
    return generic;
  }

  const code = randomDigits(6);
  const codeHash = await hashSecret(code, env.OTP_PEPPER);
  await env.DB.prepare(
    `INSERT INTO otp_codes (id, email, code_hash, expires_at, attempts, created_at, ip_hash)
     VALUES (?, ?, ?, ?, 0, ?, ?)`,
  )
    .bind(crypto.randomUUID(), email, codeHash, plusMs(OTP_TTL_MS, now), nowIso(now), hashedIp)
    .run();

  try {
    await mailer.sendOtp(email, code);
  } catch {
    return json({ ok: false, error: "发送失败，请稍后重试" }, 502);
  }

  if (exposeDevOtp(env)) {
    return json({ ok: true, message: GENERIC_OTP_MSG, dev_otp: code });
  }
  return generic;
}

export async function handleVerifyOtp(request: Request, env: Env): Promise<Response> {
  if (ssoEnabled(env)) return json({ ok: false, error: "请使用统一登录" }, 404);
  let body: VerifyOtpBody;
  try {
    body = (await request.json()) as VerifyOtpBody;
  } catch {
    return json({ ok: false, error: "验证失败" }, 400);
  }

  const email = typeof body.email === "string" ? normalizeEmail(body.email) : "";
  const code = typeof body.code === "string" ? body.code.trim() : "";
  if (!email || !/^\d{6}$/.test(code) || !env.OTP_PEPPER || !env.SESSION_SECRET) {
    return json({ ok: false, error: "验证失败" }, 400);
  }
  if (!allowlisted(env, email)) {
    return json({ ok: false, error: "验证失败" }, 400);
  }

  const row = await env.DB.prepare(
    `SELECT id, code_hash, expires_at, attempts, used_at
     FROM otp_codes
     WHERE email = ?
     ORDER BY created_at DESC
     LIMIT 1`,
  )
    .bind(email)
    .first<{
      id: string;
      code_hash: string;
      expires_at: string;
      attempts: number;
      used_at: string | null;
    }>();

  if (!row || row.used_at || Date.parse(row.expires_at) <= Date.now()) {
    return json({ ok: false, error: "验证失败" }, 400);
  }

  if (row.attempts >= OTP_MAX_ATTEMPTS) {
    await env.DB.prepare(`UPDATE otp_codes SET used_at = ? WHERE id = ?`)
      .bind(nowIso(), row.id)
      .run();
    return json({ ok: false, error: "验证失败" }, 400);
  }

  const incoming = await hashSecret(code, env.OTP_PEPPER);
  if (!timingSafeEqual(incoming, row.code_hash)) {
    const nextAttempts = row.attempts + 1;
    await env.DB.prepare(`UPDATE otp_codes SET attempts = ? WHERE id = ?`)
      .bind(nextAttempts, row.id)
      .run();
    if (nextAttempts >= OTP_MAX_ATTEMPTS) {
      await env.DB.prepare(`UPDATE otp_codes SET used_at = ? WHERE id = ?`)
        .bind(nowIso(), row.id)
        .run();
    }
    return json({ ok: false, error: "验证失败" }, 400);
  }

  await env.DB.prepare(`UPDATE otp_codes SET used_at = ? WHERE id = ?`).bind(nowIso(), row.id).run();

  let account = await findAccountByEmail(env, email);
  if (!account) {
    const id = `acc_${crypto.randomUUID()}`;
    await env.DB.prepare(
      `INSERT INTO accounts (id, email, display_name, role, active) VALUES (?, ?, ?, 'reviewer', 1)`,
    )
      .bind(id, email, brandName(env))
      .run();
    account = await findAccountByEmail(env, email);
  }
  if (!account || account.active !== 1) {
    return json({ ok: false, error: "验证失败" }, 400);
  }

  const token = randomToken();
  const sessionId = await hashSecret(token, env.SESSION_SECRET);
  const expires = plusMs(SESSION_TTL_SECONDS * 1000);
  const hashedIp = await ipHash(env, request);
  await env.DB.prepare(
    `INSERT INTO sessions (id, account_id, expires_at, user_agent, ip_hash)
     VALUES (?, ?, ?, ?, ?)`,
  )
    .bind(sessionId, account.id, expires, request.headers.get("User-Agent")?.slice(0, 300) ?? null, hashedIp)
    .run();

  return json(
    {
      ok: true,
      account: {
        email: account.email,
        role: account.role,
        brand: brandName(env),
      },
    },
    200,
    { "Set-Cookie": cookieHeader(token, request, SESSION_TTL_SECONDS) },
  );
}

export async function handleLogout(request: Request, env: Env): Promise<Response> {
  if (ssoEnabled(env)) return logoutSso(request, env);
  const token = readCookie(request, SESSION_COOKIE);
  if (token && env.SESSION_SECRET) {
    const sessionId = await hashSecret(token, env.SESSION_SECRET);
    await env.DB.prepare(`DELETE FROM sessions WHERE id = ?`).bind(sessionId).run();
  }
  return json({ ok: true }, 200, { "Set-Cookie": cookieHeader("", request, 0) });
}

async function activeOwner(env: Env): Promise<AuthedAccount | null> {
  return env.DB.prepare(
    `SELECT id, email, display_name, role, active FROM accounts
     WHERE id = 'acc_owner_kdp' AND active = 1 AND role = 'owner'`,
  ).first<AuthedAccount>();
}

export function handleSsoLogin(request: Request, env: Env) {
  return ssoEnabled(env) ? beginLogin(request, env) : Response.redirect(new URL("/login", request.url).href, 302);
}

export async function handleSsoCallback(request: Request, env: Env) {
  if (!ssoEnabled(env)) return json({ ok: false, error: "统一登录尚未启用" }, 404);
  try {
    if (!await activeOwner(env)) throw new SsoError("owner_unavailable", 403);
    return await finishLogin(request, env, { userId: "acc_owner_kdp", ttlSeconds: SESSION_TTL_SECONDS });
  } catch (error) {
    const target = new URL("/login", request.url);
    target.searchParams.set("auth_error", error instanceof SsoError && error.status < 500 ? "retry" : "unavailable");
    return new Response(null, { status: 302, headers: {
      Location: target.href, "Cache-Control": "no-store", "Referrer-Policy": "no-referrer",
    } });
  }
}

export function mePayload(account: AuthedAccount, env: Env) {
  return {
    email: account.email,
    role: account.role,
    display_name: account.display_name,
    brand: brandName(env),
  };
}
