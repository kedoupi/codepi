import type { Env } from "../env";
import {
  decryptJson,
  encryptJson,
  packEncryptedBlob,
  unpackEncryptedBlob,
} from "./crypto.ts";
import type { OuraTokens } from "./oura";
import { ApiError } from "./errors.ts";

export type StoredTokens = {
  refresh_token: string;
  access_token: string;
  expires_at: number;
};

/**
 * AAD binding a token row to its owner: moving A's (ciphertext, iv) to B's row
 * makes decryption fail instead of silently returning A's tokens.
 */
export function tokenAad(userId: string): string {
  return `oura-oauth-tokens:${userId}`;
}

export function tokensFromOura(tokens: OuraTokens): StoredTokens {
  const skewMs = 60_000;
  return {
    refresh_token: tokens.refresh_token,
    access_token: tokens.access_token,
    expires_at: Date.now() + tokens.expires_in * 1000 - skewMs,
  };
}

export async function upsertEncryptedTokens(
  env: Env,
  userId: string,
  encryptionKey: string,
  tokens: StoredTokens,
  expectedRevision?: string,
): Promise<void> {
  const blob = packEncryptedBlob(
    await encryptJson(encryptionKey, tokens, tokenAad(userId)),
  );
  if (expectedRevision !== undefined) {
    // A refresh that finishes after fresh consent must not replace that grant.
    const result = await env.DB.prepare(`UPDATE encrypted_tokens SET ciphertext=?,iv=?,updated_at=datetime('now')
      WHERE user_id=? AND iv=?`).bind(blob.ciphertext, blob.iv, userId, expectedRevision).run();
    if (result.meta.changes !== 1) throw new ApiError("sync_in_progress", 409);
    return;
  }
  await env.DB.prepare(
    `INSERT INTO encrypted_tokens (user_id, ciphertext, iv, updated_at)
     VALUES (?, ?, ?, datetime('now'))
     ON CONFLICT(user_id) DO UPDATE SET
       ciphertext = excluded.ciphertext,
       iv = excluded.iv,
       updated_at = datetime('now')`,
  )
    .bind(userId, blob.ciphertext, blob.iv)
    .run();
}

export async function loadEncryptedTokens(
  env: Env,
  userId: string,
  encryptionKey: string,
): Promise<StoredTokens | null> {
  return (await loadEncryptedTokenRecord(env, userId, encryptionKey))?.tokens ?? null;
}

export async function loadEncryptedTokenRecord(env: Env, userId: string, encryptionKey: string) {
  const row = await env.DB.prepare(
    `SELECT ciphertext, iv FROM encrypted_tokens WHERE user_id = ?`,
  )
    .bind(userId)
    .first<{ ciphertext: string; iv: string }>();
  if (!row) return null;
  // Versioned blobs are AAD-bound; legacy (unversioned) rows decrypt without
  // AAD so already-authorized users keep working without re-consent.
  const tokens = await decryptJson<StoredTokens>(
    encryptionKey,
    unpackEncryptedBlob(row),
    tokenAad(userId),
  );
  return { tokens, revision: row.iv };
}

export async function upsertUser(env: Env, args: {
  id: string;
  email?: string | null;
  ouraUserId: string;
}): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO users (id, email, oura_user_id)
     VALUES (?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       email = excluded.email,
       oura_user_id = excluded.oura_user_id,
       updated_at = datetime('now')`,
  )
    .bind(args.id, args.email ?? null, args.ouraUserId)
    .run();
}

export async function saveOwnerOuraConnection(env: Env, args: {
  userId: string;
  expectedProviderId: string;
  expectedEmail: string | null;
  providerId: string;
  email: string | null;
  encryptionKey: string;
  tokens: StoredTokens;
}): Promise<void> {
  const blob = packEncryptedBlob(
    await encryptJson(args.encryptionKey, args.tokens, tokenAad(args.userId)),
  );
  // Both writes share one transaction and the same old binding guard. Stale
  // consent cannot replace a connection repaired while its callback was pending.
  const results = await env.DB.batch([
    env.DB.prepare(`INSERT INTO encrypted_tokens (user_id, ciphertext, iv, updated_at)
      SELECT id, ?, ?, datetime('now') FROM users
      WHERE id=? AND COALESCE(oura_user_id,id)=? AND email IS ?
      ON CONFLICT(user_id) DO UPDATE SET ciphertext=excluded.ciphertext,
        iv=excluded.iv,updated_at=excluded.updated_at`)
      .bind(blob.ciphertext, blob.iv, args.userId, args.expectedProviderId, args.expectedEmail),
    env.DB.prepare(`UPDATE users SET oura_user_id=?,email=?,updated_at=datetime('now')
      WHERE id=? AND COALESCE(oura_user_id,id)=? AND email IS ?`)
      .bind(args.providerId, args.email, args.userId, args.expectedProviderId, args.expectedEmail),
  ]);
  if (results.some(result => result.meta.changes !== 1)) {
    throw new ApiError("sync_in_progress", 409);
  }
}

export async function saveOauthState(
  env: Env,
  state: string,
  returnTo?: string | null,
  initiator?: { userId: string; sessionId: string },
  repairFromProviderId?: string | null,
): Promise<void> {
  const expires = new Date(Date.now() + 10 * 60 * 1000).toISOString();
  await env.DB.prepare(
    `INSERT OR REPLACE INTO oauth_states (state, expires_at, return_to, initiator_user_id, initiator_session_id, repair_from_provider_id) VALUES (?, ?, ?, ?, ?, ?)`,
  )
    .bind(state, expires, returnTo ?? null, initiator?.userId ?? null, initiator?.sessionId ?? null, repairFromProviderId ?? null)
    .run();
}

/** Single-use: a replayed state returns null. Expired states are also rejected. */
export async function takeOauthState(
  env: Env,
  state: string,
): Promise<{ ok: boolean; returnTo: string | null; userId?: string | null; sessionId?: string | null; repairFromProviderId?: string | null }> {
  const row = await env.DB.prepare(
    `DELETE FROM oauth_states WHERE state = ? RETURNING state, expires_at, return_to, initiator_user_id, initiator_session_id, repair_from_provider_id`,
  )
    .bind(state)
    .first<{ state: string; expires_at: string; return_to: string | null; initiator_user_id: string | null; initiator_session_id: string | null; repair_from_provider_id: string | null }>();
  if (!row) return { ok: false, returnTo: null };
  return {
    ok: Date.parse(row.expires_at) >= Date.now(),
    returnTo: row.return_to ?? null,
    userId: row.initiator_user_id,
    sessionId: row.initiator_session_id,
    repairFromProviderId: row.repair_from_provider_id,
  };
}

export async function consumeOauthState(
  env: Env,
  state: string,
): Promise<boolean> {
  return (await takeOauthState(env, state)).ok;
}
