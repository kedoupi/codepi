import { beginLogin, finishLogin, logoutSso, readSsoSession, ssoEnabled, SsoError } from "@kedoupi/shared/auth/client";
import { OWNER_SUBJECT, OWNER_USER_ID, AppError } from "./lib";
import type { Env } from "./types";

function requireSso(env: Env) {
  if (!ssoEnabled(env) || env.AUTH_CLIENT_ID !== "me") throw new AppError("auth_not_configured", 503);
}
export async function authenticated(request: Request, env: Env) {
  requireSso(env);
  const session = await readSsoSession(request, env);
  return session?.userId === OWNER_USER_ID && session.subject === OWNER_SUBJECT;
}
export function login(request: Request, env: Env) {
  requireSso(env);
  return beginLogin(request, env);
}
export async function callback(request: Request, env: Env) {
  requireSso(env);
  try {
    return await finishLogin(request, env, { userId: OWNER_USER_ID, ttlSeconds: 7 * 86400 });
  } catch (error) {
    const target = new URL("/login", request.url);
    target.searchParams.set("auth_error", error instanceof SsoError && error.status < 500 ? "retry" : "unavailable");
    return new Response(null, { status: 302, headers: { Location: target.href } });
  }
}
export function logout(request: Request, env: Env) {
  requireSso(env);
  return logoutSso(request, env);
}
