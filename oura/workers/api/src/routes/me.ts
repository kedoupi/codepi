import type { Env } from "../env";
import { capabilities } from "../lib/capabilities.ts";
import { loadLocalePref } from "../lib/preferences";
import { readSyncState } from "../lib/sync-cache.ts";
import { API_CONTRACT, RELEASE } from "../lib/version.ts";
import {
  allowDevLogin,
  jsonError,
  oauthConfigured,
  resolveSessionSecret,
} from "../lib/config";
import { readSessionFromRequest } from "../lib/session";
import { ssoEnabled } from "../lib/sso";

/** GET /api/me — session status for the login gate + locale preferences. */
export async function handleMe(request: Request, env: Env): Promise<Response> {
  const secret = resolveSessionSecret(request, env);
  if (!secret && !ssoEnabled(env)) {
    return jsonError("SESSION_SECRET not configured", 503);
  }

  const session = await readSessionFromRequest(request, env, secret ?? "");
  const localePref = session ? await loadLocalePref(env, session.user_id) : null;
  const connection = session ? await env.DB.prepare(`SELECT u.oura_user_id,
    EXISTS(SELECT 1 FROM encrypted_tokens t WHERE t.user_id=u.id) AS has_tokens,
    (EXISTS(SELECT 1 FROM daily_cache d WHERE d.user_id=u.id)
      OR EXISTS(SELECT 1 FROM health_records h WHERE h.user_id=u.id)) AS has_history,
    (SELECT last_error FROM auto_sync_state a WHERE a.user_id=u.id) AS auto_error,
    (SELECT last_error FROM sync_state s WHERE s.user_id=u.id) AS sync_error
    FROM users u WHERE u.id=?`).bind(session.user_id)
    .first<{ oura_user_id: string | null; has_tokens: number; has_history: number; auto_error: string | null; sync_error: string | null }>() : null;

  return Response.json({
    authenticated: Boolean(session),
    source: session?.kind ?? null,
    userId: session?.user_id ?? null,
    allowDevLogin: allowDevLogin(request, env),
    oauthConfigured: oauthConfigured(env),
    ssoEnabled: ssoEnabled(env),
    websiteAccount: session ? { userId: session.user_id, source: session.kind } : null,
    ouraConnection: session ? {
      status: session.kind === "dev" ? "demo" : !connection?.has_tokens ? "disconnected"
        : connection.auto_error === "reconnect_required" || connection.sync_error === "reconnect_required"
          ? "reconnect_required" : "connected",
      ouraUserId: connection?.oura_user_id ?? null,
      hasCachedHistory: Boolean(connection?.has_history),
    } : null,
    localePref,
    capabilities: capabilities(env, session?.user_id ?? null),
    sync: session ? await readSyncState(env, session.user_id) : null,
    apiContract: API_CONTRACT,
    release: RELEASE,
    build: env.BUILD_SHA ?? "local",
  });
}
