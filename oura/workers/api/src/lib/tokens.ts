import type { Env } from "../env";
import { decryptJson, encryptJson, type EncryptedBlob } from "./crypto";
import type { OuraTokens } from "./oura";

export type StoredTokens = {
  refresh_token: string;
  access_token: string;
  expires_at: number;
};

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
): Promise<void> {
  const blob = await encryptJson(encryptionKey, tokens);
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
  const row = await env.DB.prepare(
    `SELECT ciphertext, iv FROM encrypted_tokens WHERE user_id = ?`,
  )
    .bind(userId)
    .first<{ ciphertext: string; iv: string }>();
  if (!row) return null;
  const blob: EncryptedBlob = { ciphertext: row.ciphertext, iv: row.iv };
  return decryptJson<StoredTokens>(encryptionKey, blob);
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

export async function saveOauthState(env: Env, state: string): Promise<void> {
  const expires = new Date(Date.now() + 10 * 60 * 1000).toISOString();
  await env.DB.prepare(
    `INSERT OR REPLACE INTO oauth_states (state, expires_at) VALUES (?, ?)`,
  )
    .bind(state, expires)
    .run();
}

export async function consumeOauthState(
  env: Env,
  state: string,
): Promise<boolean> {
  const row = await env.DB.prepare(
    `SELECT state, expires_at FROM oauth_states WHERE state = ?`,
  )
    .bind(state)
    .first<{ state: string; expires_at: string }>();
  if (!row) return false;
  await env.DB.prepare(`DELETE FROM oauth_states WHERE state = ?`).bind(state).run();
  return Date.parse(row.expires_at) >= Date.now();
}
