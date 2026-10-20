/**
 * Storage for the MCP connector's OAuth 2.1 authorization server.
 *
 * Tokens and authorization codes are persisted as SHA-256 hashes only, so a
 * database leak does not hand out working connector credentials. Refresh tokens
 * are single-use and rotated on exchange (standard OAuth 2.1 behavior).
 */
import type { Env } from "./env";

export const SUPPORTED_SCOPES = [
  "context.read", "projects.read", "projects.write", "health.read", "health.sync",
  "me.read", "me.write", "invest.read",
] as const;
export type Scope = typeof SUPPORTED_SCOPES[number];
export const LEGACY_SCOPE = "health.read health.sync";
export function normalizeScope(value: string | null | undefined): string | null {
  if (typeof value !== "string") return null;
  const parts = value.trim().split(/\s+/);
  if (!parts.length || parts.some(s => !(SUPPORTED_SCOPES as readonly string[]).includes(s))) return null;
  return SUPPORTED_SCOPES.filter(s => parts.includes(s)).join(" ") || null;
}
export const scopeSubset = (requested: string, granted: string) =>
  requested.split(" ").every(s => granted.split(" ").includes(s));
export const hasScope = (granted: string, scope: Scope) => granted.split(" ").includes(scope);
export const resource = (env: Env) => `${env.MCP_ORIGIN}/mcp`;
export const ACCESS_TTL_SECONDS = 60 * 60;
export const REFRESH_TTL_SECONDS = 60 * 60 * 24 * 30;
const CODE_TTL_MS = 5 * 60 * 1000;
const CONSENT_TTL_MS = 10 * 60 * 1000;
// Each authorization has its own refresh-token rotation family.
const TOKEN_FAMILY_SQL = "family_id";

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

/** RFC 8252: only an HTTP loopback IP's port may vary; all other bytes match. */
export function redirectAllowed(client: OAuthClient, redirectUri: string): boolean {
  const registered = clientRedirects(client);
  if (registered.includes(redirectUri)) return true;
  const loopback = (value: string) => {
    const match = /^(http:\/\/(?:127\.0\.0\.1|\[::1\]))(?::([0-9]{1,5}))?(\/[^#]*)?$/.exec(value);
    if (!match || (match[2] && (Number(match[2]) < 1 || Number(match[2]) > 65535))) return null;
    return match[1] + (match[3] ?? "");
  };
  const candidate = loopback(redirectUri);
  return candidate !== null && registered.some(uri => loopback(uri) === candidate);
}

export async function createAuthCode(
  env: Env,
  args: { clientId: string; userId: string; redirectUri: string; codeChallenge: string; scope: string },
): Promise<string> {
  const code = randomToken(32);
  await env.DB.prepare(
    `INSERT INTO oauth_auth_codes
       (code_hash, client_id, user_id, redirect_uri, code_challenge, scope, expires_at, resource)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).bind(
    await sha256Base64Url(code), args.clientId, args.userId, args.redirectUri,
    args.codeChallenge, args.scope, Date.now() + CODE_TTL_MS, resource(env),
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

/**
 * Non-consuming lookup. The token endpoint validates client, redirect_uri and
 * PKCE against this first, so a failed attempt does not burn the code the
 * client may still be able to redeem correctly.
 */
export async function lookupAuthCode(env: Env, code: string): Promise<AuthCodeRow | null> {
  return env.DB.prepare(
    `SELECT client_id, user_id, redirect_uri, code_challenge, scope
     FROM oauth_auth_codes
     WHERE code_hash = ? AND consumed_at IS NULL AND expires_at > ? AND resource = ?`,
  ).bind(await sha256Base64Url(code), Date.now(), resource(env)).first<AuthCodeRow>();
}

/** Consent screen GET is transactional: approval must carry this one-time id. */
export async function createConsentRequest(
  env: Env,
  args: {
    clientId: string;
    userId: string;
    redirectUri: string;
    codeChallenge: string;
    scope: string;
  },
): Promise<{ consentId: string; csrfToken: string }> {
  const consentId = `mcp_consent_${randomToken(16)}`;
  const csrfToken = randomToken(24);
  await env.DB.prepare(
    `INSERT INTO oauth_consent_requests
       (consent_id, client_id, user_id, redirect_uri, code_challenge, scope, csrf_hash, expires_at, resource)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).bind(
    consentId, args.clientId, args.userId, args.redirectUri,
    args.codeChallenge, args.scope, await sha256Base64Url(csrfToken),
    Date.now() + CONSENT_TTL_MS, resource(env),
  ).run();
  return { consentId, csrfToken };
}

export type ConsentRequestRow = {
  client_id: string;
  user_id: string;
  redirect_uri: string;
  code_challenge: string;
  scope: string;
};

/** Atomic consume: a reused consent id returns null even under a race. */
export async function takeConsentRequest(
  env: Env,
  consentId: string,
): Promise<ConsentRequestRow | null> {
  const row = await env.DB.prepare(
    `UPDATE oauth_consent_requests SET consumed_at = ?
     WHERE consent_id = ? AND consumed_at IS NULL AND expires_at > ? AND resource = ?
     RETURNING client_id, user_id, redirect_uri, code_challenge, scope`,
  ).bind(Date.now(), consentId, Date.now(), resource(env)).first<ConsentRequestRow>();
  return row ?? null;
}

/** Constant-shape lookup: a wrong CSRF token never consumes the consent. */
export async function consentCsrfMatches(
  env: Env,
  consentId: string,
  csrfToken: string,
): Promise<boolean> {
  const row = await env.DB.prepare(
    `SELECT csrf_hash FROM oauth_consent_requests
     WHERE consent_id = ? AND consumed_at IS NULL AND expires_at > ? AND resource = ?`,
  ).bind(consentId, Date.now(), resource(env)).first<{ csrf_hash: string }>();
  return row !== null && row.csrf_hash === await sha256Base64Url(csrfToken);
}

export type IssuedTokens = {
  access_token: string;
  refresh_token: string;
  token_type: "Bearer";
  expires_in: number;
  scope: string;
};

/** After validation, consume the code and issue its pair in one D1 transaction. */
export async function exchangeAuthCode(
  env: Env, code: string, validated: AuthCodeRow,
): Promise<IssuedTokens | null> {
  const now = Date.now();
  const access = randomToken(32);
  const refresh = randomToken(32);
  const codeHash = await sha256Base64Url(code);
  const refreshHash = await sha256Base64Url(refresh);
  const scope = validated.scope;
  const results = await env.DB.batch([
    // Only a still-live, unchanged code can create this request's random
    // successor. That hash gates every remaining write, so a concurrent loser
    // neither consumes the code nor issues credentials.
    env.DB.prepare(
      `INSERT INTO mcp_tokens (token_hash, user_id, client_id, kind, scope, expires_at, family_id, resource)
       SELECT ?, user_id, client_id, 'refresh', ?, ?, ?, resource
       FROM oauth_auth_codes
       WHERE code_hash = ? AND consumed_at IS NULL AND expires_at > ?
         AND client_id = ? AND user_id = ? AND redirect_uri = ? AND code_challenge = ? AND scope = ? AND resource = ?`,
    ).bind(
      refreshHash, scope, now + REFRESH_TTL_SECONDS * 1000, refreshHash, codeHash, now,
      validated.client_id, validated.user_id, validated.redirect_uri, validated.code_challenge, validated.scope, resource(env),
    ),
    env.DB.prepare(
      `UPDATE oauth_auth_codes SET consumed_at = ?
       WHERE code_hash = ? AND consumed_at IS NULL
         AND EXISTS (SELECT 1 FROM mcp_tokens WHERE token_hash = ?)`,
    ).bind(now, codeHash, refreshHash),
    env.DB.prepare(
      `INSERT INTO mcp_tokens (token_hash, user_id, client_id, kind, scope, expires_at, family_id, resource)
       SELECT ?, user_id, client_id, 'access', scope, ?, family_id, resource
       FROM mcp_tokens WHERE token_hash = ?`,
    ).bind(await sha256Base64Url(access), now + ACCESS_TTL_SECONDS * 1000, refreshHash),
    env.DB.prepare("SELECT token_hash FROM mcp_tokens WHERE token_hash = ?").bind(refreshHash),
  ]);
  if (!results.at(-1)?.results?.length) return null;
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
  client_name: string | null;
};

export async function findAccessToken(env: Env, token: string): Promise<TokenRow | null> {
  const row = await env.DB.prepare(
    `SELECT t.user_id, t.client_id, t.scope, t.expires_at, c.client_name FROM mcp_tokens t
     LEFT JOIN oauth_clients c ON c.client_id = t.client_id
     WHERE t.token_hash = ? AND t.kind = 'access' AND t.revoked_at IS NULL AND t.expires_at > ? AND t.resource = ?`,
  ).bind(await sha256Base64Url(token), Date.now(), resource(env)).first<TokenRow>();
  return row ?? null;
}

export type RefreshExchange =
  | { ok: true; userId: string; clientId: string; tokens: IssuedTokens }
  | { ok: false; reason: "invalid" | "replay" | "invalid_scope" };

/**
 * Exchanges a refresh token for a new pair in ONE transaction.
 *
 * Revoking the old token and inserting its successor either both happen or
 * neither does, so a failure can no longer leave the connector without
 * credentials. The successor's own hash gates the exchange, which makes
 * concurrent redemptions of the same token mutually exclusive: only the
 * request that really inserted the successor may retire the old row.
 *
 * A replayed (already rotated) refresh token is treated as a leak: the whole
 * family is revoked, per OAuth 2.1 refresh-token reuse detection.
 */
export async function exchangeRefreshToken(
  env: Env, refreshToken: string, clientId: string, requestedScope?: string,
): Promise<RefreshExchange> {
  const now = Date.now();
  const access = randomToken(32);
  const refresh = randomToken(32);
  const oldHash = await sha256Base64Url(refreshToken);
  const successorHash = await sha256Base64Url(refresh);
  const previous = await env.DB.prepare(
    "SELECT scope FROM mcp_tokens WHERE token_hash=? AND client_id=? AND kind='refresh' AND resource=?",
  ).bind(oldHash, clientId, resource(env)).first<{ scope: string }>();
  if (requestedScope !== undefined && (!normalizeScope(requestedScope)
    || (previous && !scopeSubset(requestedScope, previous.scope)))) {
    return { ok: false, reason: "invalid_scope" };
  }
  const nextScope = requestedScope ?? previous?.scope ?? "";

  const results = await env.DB.batch([
    // 1. Insert the successor, inheriting identity, scope and family from the
    //    presented row. This only matches while that row is still live.
    env.DB.prepare(
      `INSERT INTO mcp_tokens (token_hash, user_id, client_id, kind, scope, expires_at, family_id, resource)
       SELECT ?, user_id, client_id, 'refresh', ?, ?, ${TOKEN_FAMILY_SQL}, resource
       FROM mcp_tokens
       WHERE token_hash = ? AND kind = 'refresh' AND revoked_at IS NULL
         AND expires_at > ? AND client_id = ? AND resource = ? AND scope = ?`,
    ).bind(successorHash, nextScope, now + REFRESH_TTL_SECONDS * 1000, oldHash, now, clientId, resource(env), previous?.scope ?? ""),
    // 2. Retire the presented token only if this batch issued its successor.
    //    A failed exchange is checked separately for authenticated replay.
    env.DB.prepare(
      `UPDATE mcp_tokens SET revoked_at = ?
       WHERE token_hash = ? AND revoked_at IS NULL
         AND EXISTS (SELECT 1 FROM mcp_tokens WHERE token_hash = ?)`,
    ).bind(now, oldHash, successorHash),
    // 3. The paired access token, gated on the successor existing.
    env.DB.prepare(
      `INSERT INTO mcp_tokens (token_hash, user_id, client_id, kind, scope, expires_at, family_id, resource)
       SELECT ?, user_id, client_id, 'access', scope, ?, family_id, resource
       FROM mcp_tokens WHERE token_hash = ?`,
    ).bind(await sha256Base64Url(access), now + ACCESS_TTL_SECONDS * 1000, successorHash),
    // 4. Read the granted identity back; empty means the exchange did not happen.
    env.DB.prepare(`SELECT user_id, client_id, scope FROM mcp_tokens WHERE token_hash = ?`)
      .bind(successorHash),
  ]);

  const granted = results.at(-1)?.results?.[0] as
    | { user_id: string; client_id: string; scope: string }
    | undefined;
  if (!granted) {
    const replayed = await env.DB.prepare(
      `SELECT ${TOKEN_FAMILY_SQL} AS family_id FROM mcp_tokens
       WHERE token_hash = ? AND client_id = ? AND kind = 'refresh' AND revoked_at IS NOT NULL`,
    ).bind(oldHash, clientId).first<{ family_id: string }>();
    if (replayed) {
      await revokeFamily(env, replayed.family_id, clientId);
      return { ok: false, reason: "replay" };
    }
    return { ok: false, reason: "invalid" };
  }
  const scope = granted.scope;
  return {
    ok: true,
    userId: granted.user_id,
    clientId: granted.client_id,
    tokens: {
      access_token: access, refresh_token: refresh, token_type: "Bearer",
      expires_in: ACCESS_TTL_SECONDS, scope,
    },
  };
}

/** Retires every live token that belongs to one rotation family. */
async function revokeFamily(env: Env, familyId: string, clientId: string): Promise<number> {
  const result = await env.DB.prepare(
    `UPDATE mcp_tokens SET revoked_at = ?
     WHERE revoked_at IS NULL AND ${TOKEN_FAMILY_SQL} = ? AND client_id = ?`,
  ).bind(Date.now(), familyId, clientId).run();
  return result.meta?.changes ?? 0;
}

/**
 * RFC 7009 revocation. Revoking a token also retires its family, so a
 * connector that is being disconnected cannot keep rotating the pair it has.
 */
export async function revokeToken(env: Env, token: string, clientId: string): Promise<number> {
  const hash = await sha256Base64Url(token);
  const result = await env.DB.prepare(
    `UPDATE mcp_tokens SET revoked_at = ?
     WHERE revoked_at IS NULL AND client_id = ?
       AND ${TOKEN_FAMILY_SQL} =
           (SELECT ${TOKEN_FAMILY_SQL} FROM mcp_tokens WHERE token_hash = ? AND client_id = ?)`,
  ).bind(Date.now(), clientId, hash, clientId).run();
  return result.meta?.changes ?? 0;
}

export type ConnectionRow = {
  client_id: string;
  client_name: string | null;
  created_at: string;
  expires_at: number;
  scope: string;
};

/** Active refresh tokens = the connected apps currently holding access. */
export async function listConnections(env: Env, userId: string): Promise<ConnectionRow[]> {
  const result = await env.DB.prepare(
    `SELECT t.client_id, c.client_name, t.created_at, t.expires_at, t.scope
     FROM mcp_tokens t LEFT JOIN oauth_clients c ON c.client_id = t.client_id
     WHERE t.user_id = ? AND t.kind = 'refresh' AND t.revoked_at IS NULL AND t.expires_at > ?
     ORDER BY t.created_at DESC`,
  ).bind(userId, Date.now()).all<ConnectionRow>();
  const clients = new Map<string, ConnectionRow>();
  for (const row of result.results ?? []) {
    const existing = clients.get(row.client_id);
    if (!existing) clients.set(row.client_id, { ...row });
    else {
      existing.scope = normalizeScope(`${existing.scope} ${row.scope}`) ?? "";
      existing.expires_at = Math.max(existing.expires_at, row.expires_at);
    }
  }
  return [...clients.values()];
}

export async function revokeClient(env: Env, userId: string, clientId: string): Promise<number> {
  const result = await env.DB.prepare(
    "UPDATE mcp_tokens SET revoked_at = ? WHERE user_id = ? AND client_id = ? AND revoked_at IS NULL",
  ).bind(Date.now(), userId, clientId).run();
  return result.meta?.changes ?? 0;
}
