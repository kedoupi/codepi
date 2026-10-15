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

/** GET /api/me — session status for the login gate + locale preferences. */
export async function handleMe(request: Request, env: Env): Promise<Response> {
  const secret = resolveSessionSecret(request, env);
  if (!secret) {
    return jsonError("SESSION_SECRET not configured", 503);
  }

  const session = await readSessionFromRequest(request, env, secret);
  const localePref = session ? await loadLocalePref(env, session.user_id) : null;

  return Response.json({
    authenticated: Boolean(session),
    source: session?.kind ?? null,
    userId: session?.user_id ?? null,
    allowDevLogin: allowDevLogin(request, env),
    oauthConfigured: oauthConfigured(env),
    localePref,
    capabilities: capabilities(env, session?.user_id ?? null),
    sync: session ? await readSyncState(env, session.user_id) : null,
    apiContract: API_CONTRACT,
    release: RELEASE,
    build: env.BUILD_SHA ?? "local",
  });
}
