import type { Env } from "../env";
import { resolveEncryptionKey, oauthConfigured } from "./config.ts";
import { DecryptError } from "./crypto.ts";
import { ApiError } from "./errors.ts";
import { refreshAccessToken } from "./oura.ts";
import { withD1Retry } from "./d1-retry.ts";
import { loadEncryptedTokenRecord, tokensFromOura, upsertEncryptedTokens } from "./tokens.ts";
import type { StoredTokens } from "./tokens.ts";

async function persistRefreshedTokens(
  env: Env, userId: string, key: string, refreshed: StoredTokens,
  originalRevision: string,
): Promise<void> {
  try {
    await withD1Retry(() => upsertEncryptedTokens(env, userId, key, refreshed, originalRevision));
    return;
  } catch {
    // A provider refresh may rotate the refresh token. Never return the new
    // access token until its replacement grant is durably stored. A failed D1
    // write can still have committed, so inspect the row before compensating.
    const latest = await loadEncryptedTokenRecord(env, userId, key).catch(() => null);
    if (!latest) throw new ApiError("sync_storage_failed", 503);
    if (latest.tokens.refresh_token === refreshed.refresh_token
      && latest.tokens.access_token === refreshed.access_token) return;
    if (latest.revision !== originalRevision) {
      // Fresh consent (or another fenced writer) won the row while refresh
      // was in flight; do not overwrite it with the provider response.
      throw new ApiError("sync_in_progress", 409);
    }
    try {
      await withD1Retry(() => upsertEncryptedTokens(env, userId, key, refreshed, latest.revision));
    } catch (retryError) {
      if (retryError instanceof ApiError && retryError.code === "sync_in_progress") throw retryError;
      throw new ApiError("sync_storage_failed", 503);
    }
  }
}

// Both callers hold the per-user sync_state lease, serializing token rotation.
export async function ouraAccessToken(
  request: Request, env: Env, userId: string, rejectedToken?: string,
): Promise<string> {
  const key = resolveEncryptionKey(request, env);
  if (!key || !oauthConfigured(env)) throw new ApiError("oura_not_configured", 503);
  const record = await loadEncryptedTokenRecord(env, userId, key).catch((error: unknown) => {
    // Retrying cannot repair an unreadable grant; fresh consent replaces it.
    if (error instanceof DecryptError) throw new ApiError("reconnect_required", 401);
    throw error;
  });
  if (!record) throw new ApiError("reconnect_required", 401);
  let stored = record.tokens;
  if (!stored.access_token || !Number.isFinite(stored.expires_at) || stored.expires_at <= Date.now()
    || stored.access_token === rejectedToken) {
    stored = tokensFromOura(await refreshAccessToken({
      refreshToken: stored.refresh_token,
      clientId: env.OURA_CLIENT_ID!,
      clientSecret: env.OURA_CLIENT_SECRET!,
    }));
    await persistRefreshedTokens(env, userId, key, stored, record.revision);
  }
  return stored.access_token;
}

/** Must run inside the caller's per-user sync lease, including the retry. */
export async function withOuraAccess<T>(
  request: Request, env: Env, userId: string, load: (token: string) => Promise<T>, lease: string,
): Promise<T> {
  const token = await ouraAccessToken(request, env, userId);
  let data: T;
  try {
    data = await load(token);
  } catch (error) {
    if (!(error instanceof ApiError) || error.code !== "oura_access_token_rejected") throw error;
    const refreshed = await ouraAccessToken(request, env, userId, token);
    try {
      data = await load(refreshed);
    } catch (retryError) {
      if (retryError instanceof ApiError && retryError.code === "oura_access_token_rejected") {
        throw new ApiError("upstream_access_denied", 502);
      }
      throw retryError;
    }
  }
  // An actual successful provider request proves an old global auth block is
  // obsolete. Cached reads must never clear it; keep failed windows for retry.
  await env.DB.prepare(`UPDATE auto_sync_state SET status='running', last_error=NULL
    WHERE user_id=? AND status='blocked' AND last_error='reconnect_required' AND lease_until<?
      AND EXISTS (SELECT 1 FROM sync_state WHERE user_id=? AND lease_id=?)`)
    .bind(userId, Date.now(), userId, lease).run();
  return data;
}
