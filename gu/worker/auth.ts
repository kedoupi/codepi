import type { Env } from "./types";
import { brandedSender, buildOtpEmail } from "../../shared/email/otp";
import { beginLogin, finishLogin, logoutSso, readSsoSession, ssoEnabled, SsoError } from "../../shared/auth/client";
import { OWNER_EMAIL, bodyJson, cookie, equal, json, localDev, object, readCookie, secretHash, token } from "./lib";

const OTP_TTL = 8 * 60 * 1000;
const SESSION_SECONDS = 7 * 24 * 60 * 60;

export async function authenticated(request: Request, env: Env) {
  if (ssoEnabled(env)) {
    const session = await readSsoSession(request, env);
    return session?.userId === "gu-owner" && session.subject === "kdp-owner";
  }
  const raw = readCookie(request, "session");
  if (!raw || !env.SESSION_SECRET) return false;
  const id = await secretHash(raw, env.SESSION_SECRET);
  return !!await env.DB.prepare("SELECT id FROM sessions WHERE id = ? AND expires_at > ?")
    .bind(id, Date.now()).first();
}

export async function requestOtp(request: Request, env: Env) {
  if (ssoEnabled(env)) return json({ error: "请使用统一登录" }, 404);
  if (!env.OTP_PEPPER || !env.SESSION_SECRET || (!env.RESEND_API_KEY && !localDev(request, env))) {
    return json({ error: "邮件服务尚未配置，请联系站点维护者" }, 503);
  }
  const now = Date.now();
  const ip = await secretHash(request.headers.get("CF-Connecting-IP") || "local", env.OTP_PEPPER);
  await env.DB.batch([
    env.DB.prepare("DELETE FROM otp_codes WHERE created_at < ?").bind(now - 48 * 3600_000),
    env.DB.prepare("DELETE FROM sessions WHERE expires_at <= ?").bind(now),
  ]);
  let random: number;
  do { random = crypto.getRandomValues(new Uint32Array(1))[0]; } while (random >= 4294000000);
  const code = String(random % 1_000_000).padStart(6, "0");
  const id = token();
  const codeHash = await secretHash(`${id}:${code}`, env.OTP_PEPPER);
  // Enforce owner-wide quotas inside the insert, including concurrent requests.
  const inserted = await env.DB.prepare(`INSERT INTO otp_codes
    (id, code_hash, ip_hash, created_at, expires_at)
    SELECT ?, ?, ?, ?, ?
    WHERE NOT EXISTS (SELECT 1 FROM otp_codes WHERE created_at > ?)
      AND (SELECT COUNT(*) FROM otp_codes WHERE created_at > ?) < 3
      AND (SELECT COUNT(*) FROM otp_codes WHERE created_at > ?) < 10
    RETURNING id`).bind(id, codeHash, ip, now, now + OTP_TTL, now - 60_000, now - 900_000, now - 86400_000).first();
  if (!inserted) return json({ error: "发送较频繁，请稍后再试", retry_after: 60 }, 429, { "Retry-After": "60" });
  if (env.RESEND_API_KEY) {
    try {
      const response = await fetch("https://api.resend.com/emails", {
        method: "POST",
        signal: AbortSignal.timeout(10_000),
        headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, "Content-Type": "application/json", "Idempotency-Key": id },
        body: JSON.stringify({
          from: brandedSender(env.OTP_FROM || "otp@kdp.cool"),
          to: [OWNER_EMAIL],
          ...buildOtpEmail(code, "GU · 投资工作台"),
        }),
      });
      if (!response.ok) throw new Error("mail_failed");
    } catch {
      await env.DB.prepare("UPDATE otp_codes SET used_at = ? WHERE id = ?").bind(now, id).run();
      return json({ error: "验证码发送失败，请稍后重试" }, 502);
    }
  }
  return json({
    ok: true, retry_after: 60,
    ...(localDev(request, env) && !env.RESEND_API_KEY ? { dev_otp: code } : {}),
  }, 200, { "Set-Cookie": cookie(request, "challenge", id, OTP_TTL / 1000) });
}

export async function verifyOtp(request: Request, env: Env) {
  if (ssoEnabled(env)) return json({ error: "请使用统一登录" }, 404);
  const input = await bodyJson(request, 1024);
  const code = object(input) && typeof input.code === "string" ? input.code.trim() : "";
  const id = readCookie(request, "challenge");
  if (!env.OTP_PEPPER || !env.SESSION_SECRET || !/^\d{6}$/.test(code) || !id) {
    return json({ error: "验证码无效或已过期" }, 400);
  }
  // Reserve an attempt atomically so parallel requests cannot evade the limit.
  const row = await env.DB.prepare(`UPDATE otp_codes SET attempts = attempts + 1
    WHERE id = ? AND attempts < 5 AND used_at IS NULL AND expires_at > ?
    RETURNING code_hash`).bind(id, Date.now()).first<{ code_hash: string }>();
  if (!row || !equal(row.code_hash, await secretHash(`${id}:${code}`, env.OTP_PEPPER))) {
    return json({ error: "验证码无效或已过期" }, 400);
  }
  const consumed = await env.DB.prepare("UPDATE otp_codes SET used_at = ? WHERE id = ? AND used_at IS NULL RETURNING id")
    .bind(Date.now(), id).first();
  if (!consumed) return json({ error: "验证码已使用，请重新发送" }, 400);
  const raw = token();
  await env.DB.prepare("INSERT INTO sessions (id, expires_at) VALUES (?, ?)")
    .bind(await secretHash(raw, env.SESSION_SECRET), Date.now() + SESSION_SECONDS * 1000).run();
  const response = json({ ok: true }, 200, { "Set-Cookie": cookie(request, "session", raw, SESSION_SECONDS) });
  response.headers.append("Set-Cookie", cookie(request, "challenge", "", 0));
  return response;
}

export async function logout(request: Request, env: Env) {
  if (ssoEnabled(env)) return logoutSso(request, env);
  const raw = readCookie(request, "session");
  if (raw && env.SESSION_SECRET) await env.DB.prepare("DELETE FROM sessions WHERE id = ?")
    .bind(await secretHash(raw, env.SESSION_SECRET)).run();
  return json({ ok: true }, 200, { "Set-Cookie": cookie(request, "session", "", 0) });
}

export function loginSso(request: Request, env: Env) {
  return ssoEnabled(env) ? beginLogin(request, env) : Response.redirect(new URL("/login", request.url).href, 302);
}

export async function callbackSso(request: Request, env: Env) {
  if (!ssoEnabled(env)) return json({ error: "统一登录尚未启用" }, 404);
  try {
    return await finishLogin(request, env, { userId: "gu-owner", ttlSeconds: SESSION_SECONDS });
  } catch (error) {
    const target = new URL("/login", request.url);
    target.searchParams.set("auth_error", error instanceof SsoError && error.status < 500 ? "retry" : "unavailable");
    return new Response(null, { status: 302, headers: {
      Location: target.href, "Cache-Control": "no-store", "Referrer-Policy": "no-referrer",
    } });
  }
}
