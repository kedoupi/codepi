import type { Env } from "../env";
import {
  allowDevLogin,
  DEV_PLACEHOLDER_CLIENT_ID,
  frontendOrigin,
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
import { ensureSchema } from "../lib/schema";
import {
  consumeOauthState,
  saveOauthState,
  tokensFromOura,
  upsertEncryptedTokens,
  upsertUser,
} from "../lib/tokens";

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
  try {
    await ensureSchema(env);
    await saveOauthState(env, state);
  } catch {
    // D1 optional for tonight check 1 — signed cookie still binds CSRF state.
  }

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
  let dbOk = false;
  try {
    dbOk = await consumeOauthState(env, state);
  } catch {
    dbOk = false;
  }
  if (cookieState !== state && !dbOk) {
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
    await ensureSchema(env);
    const tokens = await exchangeCodeForTokens({
      code,
      clientId: env.OURA_CLIENT_ID!,
      clientSecret: env.OURA_CLIENT_SECRET!,
      redirectUri: redirectUri(request, env),
    });
    const me = await fetchPersonalInfo(tokens.access_token);
    await upsertUser(env, {
      id: me.id,
      email: me.email,
      ouraUserId: me.id,
    });
    await upsertEncryptedTokens(env, me.id, encKey, tokensFromOura(tokens));
    const sessionId = await createSession(env, me.id, "oauth");
    const headers = new Headers();
    await attachSessionCookie(headers, request, secret, sessionId);
    headers.append(
      "Set-Cookie",
      `${OAUTH_STATE_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`,
    );
    return redirectToApp(request, env, { login: "ok" }, headers);
  } catch (e) {
    const message = e instanceof Error ? e.message : "token_exchange_failed";
    return redirectToApp(request, env, {
      error: "token_exchange_failed",
      detail: message.slice(0, 180),
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
    await ensureSchema(env);
    await ensureDevUser(env);
    const sessionId = await createSession(env, DEV_USER_ID, "dev");
    const headers = new Headers();
    await attachSessionCookie(headers, request, secret, sessionId);
    return redirectToApp(request, env, { login: "dev" }, headers);
  } catch (e) {
    const message = e instanceof Error ? e.message : "dev_session_failed";
    return jsonError("DEV session failed", 503, {
      hint: "Apply D1 migrations (wrangler d1 migrations apply oura_kdp --local)",
      detail: message,
    });
  }
}

export async function handleLogout(
  request: Request,
  env: Env,
): Promise<Response> {
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
