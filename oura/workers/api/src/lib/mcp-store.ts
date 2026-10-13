/**
 * Storage for the MCP connector's OAuth 2.1 authorization server.
 *
 * Tokens and authorization codes are persisted as SHA-256 hashes only, so a
 * database leak does not hand out working connector credentials. Refresh tokens
 * are single-use and rotated on exchange (standard OAuth 2.1 behavior).
 */
import type { Env } from "../env";

export const MCP_SCOPE = "oura.read";
export const ACCESS_TTL_SECONDS = 60 * 60;
export const REFRESH_TTL_SECONDS = 60 * 60 * 24 * 30;
const CODE_TTL_MS = 5 * 60 * 1000;

function base64Url(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

export function randomToken(bytes = 32): string {
  return base64Url(crypto.getRandomValues(new Uint8Array(bytes)));
}

export async function sha256Base64Url(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return base64Url(new Uint8Array(digest));
}

export type OAuthClient = {
  client_id: string;
  client_name: string | null;
  redirect_uris: string; // JSON array
};

export async function createClient(
  env: Env,
  name: string | null,
  redirectUris: string[],
): Promise<OAuthClient> {
  const client: OAuthClient = {
    client_id: `mcp_${randomToken(16)}`,
    client_name: name,
    redirect_uris: JSON.stringify(redirectUris),
  };
  await env.DB.prepare(
    "INSERT INTO oauth_clients (client_id, client_name, redirect_uris) VALUES (?, ?, ?)",
  ).bind(client.client_id, client.client_name, client.redirect_uris).run();
  return client;
}

export async function getClient(env: Env, clientId: string): Promise<OAuthClient | null> {
  return env.DB.prepare(
    "SELECT client_id, client_name, redirect_uris FROM oauth_clients WHERE client_id = ?",
  ).bind(clientId).first<OAuthClient>();
}

export function clientRedirects(client: OAuthClient): string[] {
  try {
    const parsed: unknown = JSON.parse(client.redirect_uris);
    return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === "string") : [];
  } catch {
    return [];
  }
}

/** Exact-match redirect URI validation — never prefix-match, per OAuth 2.1. */
export function redirectAllowed(client: OAuthClient, redirectUri: string): boolean {
  return clientRedirects(client).includes(redirectUri);
}

export async function createAuthCode(
  env: Env,
  args: { clientId: string; userId: string; redirectUri: string; codeChallenge: string; scope: string },
): Promise<string> {
  const code = randomToken(32);
  await env.DB.prepare(
    `INSERT INTO oauth_auth_codes
       (code_hash, client_id, user_id, redirect_uri, code_challenge, scope, expires_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).bind(
    await sha256Base64Url(code), args.clientId, args.userId, args.redirectUri,
    args.codeChallenge, args.scope, Date.now() + CODE_TTL_MS,
  ).run();
  return code;
}

export type AuthCodeRow = {
  client_id: string;
  user_id: string;
  redirect_uri: string;
  code_challenge: string;
  scope: string;
};

/** Atomic single-use consume: a replayed code returns null even under a race. */
export async function consumeAuthCode(env: Env, code: string): Promise<AuthCodeRow | null> {
  const row = await env.DB.prepare(
    `UPDATE oauth_auth_codes SET consumed_at = ?
     WHERE code_hash = ? AND consumed_at IS NULL AND expires_at > ?
     RETURNING client_id, user_id, redirect_uri, code_challenge, scope`,
  ).bind(Date.now(), await sha256Base64Url(code), Date.now())
    .first<AuthCodeRow>();
  return row ?? null;
}

export type IssuedTokens = {
  access_token: string;
  refresh_token: string;
  token_type: "Bearer";
  expires_in: number;
  scope: string;
};

async function storeToken(
  env: Env, token: string, userId: string, clientId: string,
  kind: "access" | "refresh", scope: string, ttlSeconds: number,
): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO mcp_tokens (token_hash, user_id, client_id, kind, scope, expires_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).bind(await sha256Base64Url(token), userId, clientId, kind, scope, Date.now() + ttlSeconds * 1000).run();
}

export async function issueTokens(
  env: Env, userId: string, clientId: string, scope: string,
): Promise<IssuedTokens> {
  const access = randomToken(32);
  const refresh = randomToken(32);
  await storeToken(env, access, userId, clientId, "access", scope, ACCESS_TTL_SECONDS);
  await storeToken(env, refresh, userId, clientId, "refresh", scope, REFRESH_TTL_SECONDS);
  return {
    access_token: access, refresh_token: refresh, token_type: "Bearer",
    expires_in: ACCESS_TTL_SECONDS, scope,
  };
}

export type TokenRow = {
  user_id: string;
  client_id: string;
  scope: string;
  expires_at: number;
};

export async function findAccessToken(env: Env, token: string): Promise<TokenRow | null> {
  const row = await env.DB.prepare(
    `SELECT user_id, client_id, scope, expires_at FROM mcp_tokens
     WHERE token_hash = ? AND kind = 'access' AND revoked_at IS NULL AND expires_at > ?`,
  ).bind(await sha256Base64Url(token), Date.now()).first<TokenRow>();
  return row ?? null;
}

/** Rotates a refresh token; the old one stops working immediately. */
export async function rotateRefreshToken(
  env: Env, refreshToken: string,
): Promise<{ userId: string; clientId: string; scope: string } | null> {
  const hash = await sha256Base64Url(refreshToken);
  const row = await env.DB.prepare(
    `UPDATE mcp_tokens SET revoked_at = ?
     WHERE token_hash = ? AND kind = 'refresh' AND revoked_at IS NULL AND expires_at > ?
     RETURNING user_id, client_id, scope`,
  ).bind(Date.now(), hash, Date.now()).first<{ user_id: string; client_id: string; scope: string }>();
  if (!row) return null;
  return { userId: row.user_id, clientId: row.client_id, scope: row.scope };
}

export type ConnectionRow = {
  client_id: string;
  client_name: string | null;
  created_at: string;
  expires_at: number;
};

/** Active refresh tokens = the connected apps currently holding access. */
export async function listConnections(env: Env, userId: string): Promise<ConnectionRow[]> {
  const result = await env.DB.prepare(
    `SELECT t.client_id, c.client_name, t.created_at, MAX(t.expires_at) AS expires_at
     FROM mcp_tokens t LEFT JOIN oauth_clients c ON c.client_id = t.client_id
     WHERE t.user_id = ? AND t.kind = 'refresh' AND t.revoked_at IS NULL AND t.expires_at > ?
     GROUP BY t.client_id, c.client_name ORDER BY MAX(t.created_at) DESC`,
  ).bind(userId, Date.now()).all<ConnectionRow>();
  return result.results ?? [];
}

export async function revokeClient(env: Env, userId: string, clientId: string): Promise<number> {
  const result = await env.DB.prepare(
    "UPDATE mcp_tokens SET revoked_at = ? WHERE user_id = ? AND client_id = ? AND revoked_at IS NULL",
  ).bind(Date.now(), userId, clientId).run();
  return result.meta?.changes ?? 0;
}
