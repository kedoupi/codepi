import type { Env } from "../env";
import { beginLogin, finishLogin, logoutSso, personalOwner, SsoError, ssoEnabled } from "../lib/sso";
import { requireSession, isResponse } from "../lib/authz";
import { normalizeApiError, storageQuotaResetAt } from "../lib/errors.ts";
import {
  allowDevLogin,
  DEV_PLACEHOLDER_CLIENT_ID,
  frontendOrigin,
  providerSettingsReturn,
  jsonError,
  oauthConfigured,
  OAUTH_STATE_COOKIE,
  redirectUri,
  resolveClientId,
  resolveEncryptionKey,
  resolveSessionSecret,
  SESSION_COOKIE,
} from "../lib/config";
import {
  buildAuthorizeUrl,
  exchangeCodeForTokens,
  fetchPersonalInfo,
} from "../lib/oura";
import {
  attachSessionCookie,
  attachStateCookie,
  clearCookie,
  createSession,
  deleteSession,
  ensureDevUser,
  readSessionFromRequest,
  readStateCookie,
  DEV_USER_ID,
} from "../lib/session";
import {
  saveOauthState,
  takeOauthState,
  tokensFromOura,
  upsertEncryptedTokens,
  upsertUser,
} from "../lib/tokens";

export async function handleLogin(request: Request, env: Env): Promise<Response> {
  if (ssoEnabled(env)) {
    personalOwner(env);
    return beginLogin(request, env);
  }
  return handleOuraStart(request, env);
}

export async function handleLoginCallback(request: Request, env: Env): Promise<Response> {
  if (!ssoEnabled(env)) return jsonError("sso_disabled", 404);
  try {
    const userId = personalOwner(env);
    const existing = await env.DB.prepare("SELECT id FROM users WHERE id=?").bind(userId).first();
    if (!existing) throw new SsoError("owner_not_configured", 503);
    return await finishLogin(request, env, { userId, ttlSeconds: 30 * 86400 });
  } catch (error) {
    return redirectToApp(request, env, {
      auth_error: normalizeApiError(error).status < 500 ? "retry" : "unavailable",
    });
  }
}

function redirectToApp(
  request: Request,
  env: Env,
  params: Record<string, string>,
  extra?: Headers,
): Response {
  const dest = new URL(frontendOrigin(request, env));
  dest.pathname = "/";
  for (const [k, v] of Object.entries(params)) dest.searchParams.set(k, v);
  const headers = extra ?? new Headers();
  headers.set("Location", dest.toString());
  return new Response(null, { status: 302, headers });
}

/** GET /api/auth/oura/start — always 302 to a real Oura authorize URL in DEV/local. */
export async function handleOuraStart(
  request: Request,
  env: Env,
): Promise<Response> {
  if (request.method !== "GET") return jsonError("method_not_allowed", 405);
  const auth = ssoEnabled(env) ? await requireSession(request, env) : null;
  if (isResponse(auth)) return auth;
  // Keep Oura's registered callback and its host-only session/state cookies
  // together until the provider's callback registration is changed.
  const providerOrigin = new URL(redirectUri(request, env)).origin;
  if (ssoEnabled(env) && providerOrigin !== new URL(request.url).origin) {
    const settings = new URL("/settings", providerOrigin);
    settings.searchParams.set("connect_oura", "1");
    const destination = new URL(request.url).searchParams.get("sync_health") === "1"
      ? "/settings?sync=90" : "/settings";
    settings.searchParams.set("health_return", new URL(destination, env.FRONTEND_ORIGIN).href);
    const login = new URL("/api/auth/login", providerOrigin);
    login.searchParams.set("return", settings.pathname + settings.search);
    return new Response(null, { status: 302, headers: {
      Location: login.href, "Cache-Control": "no-store",
    } });
  }
  const clientId = resolveClientId(request, env);
  if (!clientId) {
    return jsonError("OURA_CLIENT_ID not configured", 503, {
      hint: "Set Worker secrets / .dev.vars — see .env.example",
    });
  }

  const secret = resolveSessionSecret(request, env);
  if (!secret) {
    return jsonError("SESSION_SECRET not configured", 503, {
      hint: "Set Worker secrets / .dev.vars — see .env.example",
    });
  }

  const state = crypto.randomUUID();
  // `return` lets an MCP authorization request survive a fresh login. Accept
  // only that exact local consent URL; a loose prefix check would permit
  // backslash-normalized external redirects in some browsers.
  const rawReturn = new URL(request.url).searchParams.get("return");
  const parsedReturn = rawReturn ? new URL(rawReturn, new URL(request.url).origin) : null;
  const returnTo = parsedReturn?.origin === new URL(request.url).origin
      && parsedReturn?.pathname === "/oauth/authorize"
    ? parsedReturn.pathname + parsedReturn.search
    : providerSettingsReturn(request, env)
      ?? (new URL(request.url).searchParams.get("sync_health") === "1" ? "/settings?sync=90" : null);
  await saveOauthState(env, state, returnTo, auth ? {
    userId: auth.session.user_id, sessionId: auth.session.id,
  } : undefined);

  const headers = new Headers();
  await attachStateCookie(headers, request, secret, state);
  const url = buildAuthorizeUrl({
    clientId,
    redirectUri: redirectUri(request, env),
    state,
  });
  headers.set("Location", url);
  if (clientId === DEV_PLACEHOLDER_CLIENT_ID) {
    headers.set("X-Oura-Dev-Placeholder-Client", "1");
  }
  return new Response(null, { status: 302, headers });
}

/** GET /api/auth/oura/callback — exchange code, encrypt refresh_token, set session. */
export async function handleOuraCallback(
  request: Request,
  env: Env,
): Promise<Response> {
  if (request.method !== "GET") return jsonError("method_not_allowed", 405);
  const auth = ssoEnabled(env) ? await requireSession(request, env) : null;
  if (isResponse(auth)) return auth;
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const err = url.searchParams.get("error");

  if (err) {
    return redirectToApp(request, env, { error: err });
  }
  if (!code || !state) {
    return redirectToApp(request, env, { error: "missing_code_or_state" });
  }

  const secret = resolveSessionSecret(request, env);
  if (!secret) {
    return jsonError("SESSION_SECRET not configured", 503);
  }

  const cookieState = await readStateCookie(request, secret);
  if (cookieState !== state) {
    return redirectToApp(request, env, { error: "invalid_state" });
  }
  let dbOk = false;
  let returnTo: string | null = null;
  try {
    const taken = await takeOauthState(env, state);
    dbOk = taken.ok;
    returnTo = taken.returnTo;
    if (auth && (taken.userId !== auth.session.user_id || taken.sessionId !== auth.session.id)) {
      dbOk = false;
    }
  } catch (error) {
    if (normalizeApiError(error).code === "storage_write_quota_exceeded") {
      return redirectToApp(request, env, { error: "storage_write_quota_exceeded", retry_at: storageQuotaResetAt() });
    }
    dbOk = false;
  }
  if (!dbOk) {
    return redirectToApp(request, env, { error: "invalid_state" });
  }

  if (!oauthConfigured(env)) {
    return redirectToApp(request, env, {
      error: "oauth_not_configured",
      hint: allowDevLogin(request, env)
        ? "Use DEV 演示登录, or set real OURA_CLIENT_ID/SECRET"
        : "Set Oura Worker secrets",
    });
  }

  const encKey = resolveEncryptionKey(request, env);
  if (!encKey) {
    return jsonError("TOKEN_ENCRYPTION_KEY not configured", 503);
  }

  try {
    const tokens = await exchangeCodeForTokens({
      code,
      clientId: env.OURA_CLIENT_ID!,
      clientSecret: env.OURA_CLIENT_SECRET!,
      redirectUri: redirectUri(request, env),
    });
    const me = await fetchPersonalInfo(tokens.access_token);
    const userId = auth ? auth.session.user_id : me.id;
    if (auth) {
      const existing = await env.DB.prepare("SELECT oura_user_id FROM users WHERE id=?")
        .bind(userId).first<{ oura_user_id: string | null }>();
      if (!existing) return redirectToApp(request, env, { auth_error: "unavailable" });
      // Legacy owners used their provider id as their primary key. Also guard
      // unconnected migrated rows so consent cannot silently switch accounts.
      const expectedId = existing.oura_user_id ?? personalOwner(env);
      if (me.id !== expectedId) {
        return redirectToApp(request, env, { error: "oura_account_mismatch" });
      }
    }
    await upsertUser(env, {
      id: userId,
      email: me.email,
      ouraUserId: me.id,
    });
    await upsertEncryptedTokens(env, userId, encKey, tokensFromOura(tokens));
    // Fence outstanding work before clearing refusal evidence. Its late
    // response must not pause or overwrite a newly authorized connection.
    await env.DB.batch([
      env.DB.prepare(`UPDATE sync_state SET lease_id=?,lease_until=0,
        last_error=CASE WHEN last_error='reconnect_required' THEN NULL ELSE last_error END WHERE user_id=?`)
        .bind(crypto.randomUUID(), userId),
      env.DB.prepare("UPDATE health_sync_windows SET synced_at=NULL,last_error=NULL WHERE user_id=?").bind(userId),
      env.DB.prepare(`UPDATE auto_sync_state SET lease_id=?,lease_until=0 WHERE user_id=?`)
        .bind(crypto.randomUUID(), userId),
      env.DB.prepare(`UPDATE auto_sync_state SET status='running',last_error=NULL,finished_at=NULL,
        payload=(SELECT json_group_array(json(CASE
          WHEN json_extract(value,'$.state')='unavailable'
            OR json_extract(value,'$.error') IN ('upstream_access_denied','permission_or_membership_required')
          THEN json_remove(json_set(value,'$.state','pending','$.attempts',0,'$.after',0),'$.error')
          ELSE value END)) FROM json_each(payload))
        WHERE user_id=? AND (status='blocked' OR EXISTS (
          SELECT 1 FROM json_each(payload) WHERE json_extract(value,'$.state')='unavailable'
            OR json_extract(value,'$.error') IN ('upstream_access_denied','permission_or_membership_required')
        ))`).bind(userId),
    ]);
    const headers = new Headers();
    if (!auth) {
      const sessionId = await createSession(env, userId, "oauth");
      await attachSessionCookie(headers, request, secret, sessionId);
    }
    clearCookie(headers, request, OAUTH_STATE_COOKIE);
    if (returnTo) {
      headers.set("Location", returnTo);
      return new Response(null, { status: 302, headers });
    }
    return redirectToApp(request, env, { login: "ok" }, headers);
  } catch (error) {
    if (normalizeApiError(error).code === "storage_write_quota_exceeded") {
      return redirectToApp(request, env, { error: "storage_write_quota_exceeded", retry_at: storageQuotaResetAt() });
    }
    return redirectToApp(request, env, {
      error: "token_exchange_failed",
    });
  }
}

/** GET /api/auth/dev/session — localhost / ALLOW_DEV_LOGIN only. */
export async function handleDevSession(
  request: Request,
  env: Env,
): Promise<Response> {
  if (!allowDevLogin(request, env)) {
    return jsonError("DEV login disabled", 403, {
      hint: "Set ALLOW_DEV_LOGIN=1 for local demo, or use Oura OAuth",
    });
  }
  const secret = resolveSessionSecret(request, env);
  if (!secret) {
    return jsonError("SESSION_SECRET not configured", 503);
  }
  try {
    await ensureDevUser(env);
    const sessionId = await createSession(env, DEV_USER_ID, "dev");
    const headers = new Headers();
    await attachSessionCookie(headers, request, secret, sessionId);
    return redirectToApp(request, env, { login: "dev" }, headers);
  } catch {
    return jsonError("DEV session failed", 503, {
      hint: "Apply D1 migrations (wrangler d1 migrations apply oura_kdp --local)",
    });
  }
}

export async function handleLogout(
  request: Request,
  env: Env,
): Promise<Response> {
  if (ssoEnabled(env)) return logoutSso(request, env);
  const secret = resolveSessionSecret(request, env);
  const headers = new Headers();
  if (secret) {
    const session = await readSessionFromRequest(request, env, secret);
    if (session) await deleteSession(env, session.id);
  }
  clearCookie(headers, request, SESSION_COOKIE);
  clearCookie(headers, request, OAUTH_STATE_COOKIE);
  if (request.method === "GET") {
    headers.set("Location", `${frontendOrigin(request, env)}/`);
    return new Response(null, { status: 302, headers });
  }
  headers.set("Content-Type", "application/json");
  return new Response(JSON.stringify({ ok: true }), { status: 200, headers });
}
