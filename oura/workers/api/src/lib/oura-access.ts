import type { Env } from "../env";
import { resolveEncryptionKey, oauthConfigured } from "./config";
import { ApiError } from "./errors.ts";
import { refreshAccessToken } from "./oura";
import { loadEncryptedTokens, tokensFromOura, upsertEncryptedTokens } from "./tokens";

// Both callers hold the per-user sync_state lease, serializing token rotation.
export async function ouraAccessToken(request: Request, env: Env, userId: string): Promise<string> {
  const key = resolveEncryptionKey(request, env);
  if (!key || !oauthConfigured(env)) throw new ApiError("oura_not_configured", 503);
  let stored = await loadEncryptedTokens(env, userId, key);
  if (!stored) throw new ApiError("reconnect_required", 401);
  if (!stored.access_token || stored.expires_at <= Date.now()) {
    stored = tokensFromOura(await refreshAccessToken({
      refreshToken: stored.refresh_token,
      clientId: env.OURA_CLIENT_ID!,
      clientSecret: env.OURA_CLIENT_SECRET!,
    }));
    await upsertEncryptedTokens(env, userId, key, stored);
  }
  return stored.access_token;
}
