import type { Env } from "./env.ts";

const DAY_MS = 86400_000;
const TOKEN_REPLAY_RETENTION_MS = 7 * DAY_MS;
const DELETE_BATCH_SIZE = 1000;

type CleanupResult = Record<string, number>;

async function deleteBatch(env: Env, sql: string, ...bindings: number[]) {
  const result = await env.DB.prepare(sql).bind(...bindings).run();
  return result.meta?.changes ?? 0;
}

/**
 * Remove only temporary OAuth/SSO state and expired credentials. Each table
 * is bounded independently so one busy table cannot turn a scheduled run
 * into an unbounded D1 transaction.
 */
export async function cleanupExpiredData(env: Env, now = Date.now()): Promise<CleanupResult> {
  const replayCutoff = now - TOKEN_REPLAY_RETENTION_MS;
  return {
    oauth_consent_requests: await deleteBatch(env, `DELETE FROM oauth_consent_requests
      WHERE rowid IN (
        SELECT rowid FROM oauth_consent_requests
        WHERE expires_at <= ? LIMIT ${DELETE_BATCH_SIZE}
      )`, now),
    oauth_auth_codes: await deleteBatch(env, `DELETE FROM oauth_auth_codes
      WHERE rowid IN (
        SELECT rowid FROM oauth_auth_codes
        WHERE expires_at <= ? LIMIT ${DELETE_BATCH_SIZE}
      )`, now),
    mcp_tokens: await deleteBatch(env, `DELETE FROM mcp_tokens
      WHERE rowid IN (
        SELECT rowid FROM mcp_tokens
        WHERE (revoked_at IS NULL AND expires_at <= ?)
           OR (revoked_at IS NOT NULL AND revoked_at <= ?)
        LIMIT ${DELETE_BATCH_SIZE}
      )`, now, replayCutoff),
    mcp_personal_tokens: await deleteBatch(env, `DELETE FROM mcp_personal_tokens
      WHERE rowid IN (
        SELECT rowid FROM mcp_personal_tokens
        WHERE expires_at <= ?
           OR (revoked_at IS NOT NULL AND revoked_at <= ?)
        LIMIT ${DELETE_BATCH_SIZE}
      )`, now, replayCutoff),
    kdp_sso_transactions: await deleteBatch(env, `DELETE FROM kdp_sso_transactions
      WHERE rowid IN (
        SELECT rowid FROM kdp_sso_transactions
        WHERE expires_at <= ? LIMIT ${DELETE_BATCH_SIZE}
      )`, now),
    kdp_sso_sessions: await deleteBatch(env, `DELETE FROM kdp_sso_sessions
      WHERE rowid IN (
        SELECT rowid FROM kdp_sso_sessions
        WHERE expires_at <= ? LIMIT ${DELETE_BATCH_SIZE}
      )`, now),
    oauth_registration_events: await deleteBatch(env, `DELETE FROM oauth_registration_events
      WHERE rowid IN (
        SELECT rowid FROM oauth_registration_events
        WHERE created_at <= ? LIMIT ${DELETE_BATCH_SIZE}
      )`, now - DAY_MS),
  };
}
