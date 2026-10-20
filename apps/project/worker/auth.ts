import {
  beginLogin,
  finishLogin,
  logoutSso,
  readSsoSession,
  ssoEnabled,
  SsoError,
} from "@kedoupi/shared/auth/client";
import { json, LOCAL_OWNER_ID } from "./lib";
import type { Env } from "./types";

const SESSION_SECONDS = 7 * 24 * 60 * 60;

export async function authenticated(request: Request, env: Env): Promise<boolean> {
  if (!ssoEnabled(env)) return false;
  const session = await readSsoSession(request, env);
  return session?.userId === LOCAL_OWNER_ID && session.subject === "kdp-owner";
}

export function loginSso(request: Request, env: Env): Response | Promise<Response> {
  if (!ssoEnabled(env)) return json({ error: "sso_required" }, 503);
  return beginLogin(request, env);
}

export async function callbackSso(request: Request, env: Env): Promise<Response> {
  if (!ssoEnabled(env)) return json({ error: "sso_required" }, 503);
  try {
    return await finishLogin(request, env, {
      userId: LOCAL_OWNER_ID,
      ttlSeconds: SESSION_SECONDS,
    });
  } catch (error) {
    const target = new URL("/login", request.url);
    target.searchParams.set(
      "auth_error",
      error instanceof SsoError && error.status < 500 ? "retry" : "unavailable",
    );
    return new Response(null, {
      status: 302,
      headers: {
        Location: target.href,
        "Cache-Control": "no-store",
        "Referrer-Policy": "no-referrer",
      },
    });
  }
}

export async function logout(request: Request, env: Env): Promise<Response> {
  if (!ssoEnabled(env)) return json({ error: "sso_required" }, 503);
  return logoutSso(request, env);
}
