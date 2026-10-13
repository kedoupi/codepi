/**
 * OAuth 2.1 authorization server for the MCP connector.
 *
 * Claude and ChatGPT both require a standards-shaped OAuth flow for remote MCP
 * servers: discovery metadata, dynamic client registration, authorization code
 * + PKCE (S256), and rotating refresh tokens. Consent is granted by an already
 * logged-in site user, so only the account owner can authorize a connector.
 */
import type { Env } from "../env";
import { jsonError, resolveSessionSecret } from "../lib/config";
import { readSessionFromRequest } from "../lib/session";
import { hmacSign, hmacVerify } from "../lib/crypto.ts";
import {
  ACCESS_TTL_SECONDS,
  clientRedirects,
  consumeAuthCode,
  consentCsrfMatches,
  createAuthCode,
  createClient,
  createConsentRequest,
  getClient,
  issueTokens,
  listConnections,
  MCP_SCOPE,
  redirectAllowed,
  revokeClient,
  rotateRefreshToken,
  takeConsentRequest,
  sha256Base64Url,
} from "../lib/mcp-store.ts";
import { RELEASE } from "../lib/version.ts";

const GRANTED_SCOPE = MCP_SCOPE;

function issuer(request: Request): string {
  return new URL(request.url).origin;
}

function json(body: unknown, status = 200): Response {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

function oauthError(error: string, description: string, status = 400): Response {
  return json({ error, error_description: description }, status);
}

/** GET /.well-known/oauth-protected-resource[/mcp] — RFC 9728. */
export function handleProtectedResourceMetadata(request: Request): Response {
  const base = issuer(request);
  return json({
    resource: `${base}/mcp`,
    authorization_servers: [base],
    scopes_supported: [GRANTED_SCOPE],
    bearer_methods_supported: ["header"],
    resource_documentation: `${base}/`,
  });
}

/** GET /.well-known/oauth-authorization-server — RFC 8414. */
export function handleAuthorizationServerMetadata(request: Request): Response {
  const base = issuer(request);
  return json({
    issuer: base,
    authorization_endpoint: `${base}/oauth/authorize`,
    token_endpoint: `${base}/oauth/token`,
    registration_endpoint: `${base}/oauth/register`,
    revocation_endpoint: `${base}/oauth/revoke`,
    scopes_supported: [GRANTED_SCOPE],
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code", "refresh_token"],
    code_challenge_methods_supported: ["S256"],
    token_endpoint_auth_methods_supported: ["none"],
    service_documentation: `${base}/`,
  });
}

/** POST /oauth/register — RFC 7591 dynamic client registration (public clients). */
export async function handleRegister(request: Request, env: Env): Promise<Response> {
  if (request.method !== "POST") return jsonError("method not allowed", 405);
  let body: { client_name?: unknown; redirect_uris?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return oauthError("invalid_client_metadata", "Body must be JSON");
  }
  const uris = Array.isArray(body.redirect_uris)
    ? body.redirect_uris.filter((u): u is string => typeof u === "string")
    : [];
  if (uris.length === 0) {
    return oauthError("invalid_redirect_uri", "redirect_uris must contain at least one absolute URL");
  }
  for (const uri of uris) {
    let parsed: URL;
    try {
      parsed = new URL(uri);
    } catch {
      return oauthError("invalid_redirect_uri", `Not a valid URL: ${uri}`);
    }
    // Loopback http is allowed for local MCP clients; everything else must be https.
    const loopback = parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1" || parsed.hostname === "[::1]";
    if (parsed.protocol !== "https:" && !(parsed.protocol === "http:" && loopback)) {
      return oauthError("invalid_redirect_uri", `redirect_uri must use https: ${uri}`);
    }
    if (parsed.hash) {
      return oauthError("invalid_redirect_uri", "redirect_uri must not contain a fragment");
    }
  }
  const name = typeof body.client_name === "string" ? body.client_name.slice(0, 120) : null;
  const client = await createClient(env, name, uris);
  return json(
    {
      client_id: client.client_id,
      client_name: client.client_name,
      redirect_uris: uris,
      token_endpoint_auth_method: "none",
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      scope: GRANTED_SCOPE,
    },
    201,
  );
}

const CONSENT_CSS = `
  :root { color-scheme: light; }
  body { margin:0; min-height:100vh; display:grid; place-items:center;
    background:#fdf8f3; color:#1f2937;
    font:16px/1.55 -apple-system,BlinkMacSystemFont,"Segoe UI",system-ui,sans-serif; }
  .card { width:min(560px,92vw); background:#fff; border:1px solid #f0e2d4;
    border-radius:20px; padding:28px; box-shadow:0 14px 40px rgba(120,72,30,.10); }
  .kicker { font-size:12px; letter-spacing:.14em; text-transform:uppercase; color:#a16207; }
  .brand { display:flex; align-items:center; gap:12px; margin-bottom:12px; }
  .brand img { width:48px; height:48px; flex-shrink:0; }
  h1 { margin:.35rem 0 .5rem; font-size:1.5rem; }
  p { margin:.5rem 0; color:#4b5563; }
  ul { margin:.75rem 0; padding-left:1.1rem; color:#4b5563; }
  .row { display:flex; gap:12px; margin-top:1.25rem; flex-wrap:wrap; }
  button { font:inherit; border-radius:999px; padding:11px 22px; cursor:pointer; border:1px solid transparent; }
  .approve { background:#f97316; color:#fff; }
  .deny { background:#fff; color:#9a3412; border-color:#f6d3b4; }
  dl { margin:1rem 0 0; display:grid; grid-template-columns:auto 1fr; gap:.35rem .9rem; font-size:14px; }
  dt { color:#9a3412; } dd { margin:0; overflow-wrap:anywhere; }
`;

function consentPage(request: Request, env: Env, fields: Record<string, string>, message?: string): Response {
  const client = fields.client_name ? `${fields.client_name} (${fields.client_id})` : fields.client_id;
  const hidden = Object.entries(fields)
    .map(([k, v]) => `<input type="hidden" name="${k}" value="${escapeHtml(v)}">`)
    .join("");
  const html = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<link rel="icon" href="/favicon.ico" sizes="32x32">
<link rel="icon" href="/icon.svg" type="image/svg+xml" sizes="any">
<title>授权连接 · Oura 健康看板</title><style>${CONSENT_CSS}</style></head><body>
<div class="card">
  <div class="brand"><img src="/icon.svg" width="48" height="48" alt="">
    <div class="kicker">Oura 健康看板 · ${escapeHtml(RELEASE)}</div>
  </div>
  <h1>允许这个应用读取你的 Oura 数据？</h1>
  ${message ? `<p style="color:#b45309">${escapeHtml(message)}</p>` : ""}
  <p>请求方：</p>
  <dl>
    <dt>应用</dt><dd>${escapeHtml(client)}</dd>
    <dt>权限</dt><dd>只读：睡眠、准备度、活动日汇总</dd>
    <dt>账号</dt><dd>${escapeHtml(env.PERSONAL_OWNER_ID ?? "")}</dd>
  </dl>
  <ul>
    <li>不会提供 Oura 密码，也不会提供 Oura 令牌。</li>
    <li>仅限本人账号使用；可随时在设置页撤销。</li>
    <li>数据为健康参考，非医疗建议。</li>
  </ul>
  <form method="POST" action="/oauth/authorize">
    ${hidden}
    <div class="row">
      <button class="approve" type="submit" name="decision" value="approve">允许连接</button>
      <button class="deny" type="submit" name="decision" value="deny">拒绝</button>
    </div>
  </form>
</div></body></html>`;
  return new Response(html, {
    status: 200,
    headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" },
  });
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, ch =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch] as string);
}

type AuthorizeParams = {
  client_id: string;
  redirect_uri: string;
  response_type: string;
  code_challenge: string;
  code_challenge_method: string;
  state: string;
  scope: string;
  decision?: string;
};

function readAuthorizeParams(source: URLSearchParams | FormData): AuthorizeParams {
  const get = (key: string) => {
    const value = source instanceof URLSearchParams ? source.get(key) : source.get(key);
    return typeof value === "string" ? value : "";
  };
  return {
    client_id: get("client_id"),
    redirect_uri: get("redirect_uri"),
    response_type: get("response_type"),
    code_challenge: get("code_challenge"),
    code_challenge_method: get("code_challenge_method"),
    state: get("state"),
    scope: get("scope"),
    decision: get("decision") || undefined,
  };
}

/** Redirect back to the client with an authorization code (or an error). */
function redirectToClient(redirectUri: string, params: Record<string, string>): Response {
  const target = new URL(redirectUri);
  for (const [k, v] of Object.entries(params)) target.searchParams.set(k, v);
  return new Response(null, { status: 302, headers: { Location: target.toString(), "Cache-Control": "no-store" } });
}

type StoredConsentRequest = NonNullable<Awaited<ReturnType<typeof takeConsentRequest>>>;
type ApprovedConsent = StoredConsentRequest & { state: string };

async function signConsentId(secret: string, consentId: string, state: string): Promise<string> {
  return `${consentId}.${await hmacSign(secret, `${consentId}:${state}`)}`;
}

async function approvedConsent(
  request: StoredConsentRequest | null,
  expected: { clientId: string; userId: string; consentId: string; state: string; secret: string },
): Promise<ApprovedConsent | null> {
  if (!request || request.client_id !== expected.clientId || request.user_id !== expected.userId) return null;
  return { ...request, state: expected.state };
}

export async function handleAuthorize(request: Request, env: Env): Promise<Response> {
  if (request.method !== "GET" && request.method !== "POST") return jsonError("method not allowed", 405);
  const origin = request.headers.get("Origin");
  const requestOrigin = new URL(request.url).origin;
  if (request.method === "POST" && origin && origin !== requestOrigin) {
    return oauthError("invalid_request", "Authorization consent must be submitted from this site", 403);
  }

  if (request.method === "POST") {
    return handleConsentDecision(request, env, requestOrigin);
  }

  const params = readAuthorizeParams(new URL(request.url).searchParams);

  if (params.response_type !== "code") {
    return oauthError("unsupported_response_type", "Only response_type=code is supported");
  }
  if (!params.client_id) return oauthError("invalid_request", "client_id is required");

  const client = await getClient(env, params.client_id);
  if (!client) return oauthError("invalid_client", "Unknown client_id");

  // Validate the redirect before doing anything that could leak to it.
  if (!redirectAllowed(client, params.redirect_uri)) {
    return oauthError("invalid_redirect_uri", "redirect_uri is not registered for this client");
  }
  const state = params.state;
  const denyAndReturn = (error: string, description: string) =>
    redirectToClient(params.redirect_uri, {
      error, error_description: description, ...(state ? { state } : {}),
    });

  if (params.code_challenge_method !== "S256" || !params.code_challenge) {
    return denyAndReturn("invalid_request", "PKCE with code_challenge_method=S256 is required");
  }

  const secret = resolveSessionSecret(request, env);
  if (!secret) return jsonError("SESSION_SECRET not configured", 503);
  const session = await readSessionFromRequest(request, env, secret);

  if (!session) {
    // Send the browser through the existing Oura login, then come back here.
    const back = new URL(request.url);
    const start = new URL("/api/auth/oura/start", request.url);
    start.searchParams.set("return", back.pathname + back.search);
    return new Response(null, { status: 302, headers: { Location: start.toString(), "Cache-Control": "no-store" } });
  }

  if (!env.PERSONAL_OWNER_ID || session.user_id !== env.PERSONAL_OWNER_ID) {
    return denyAndReturn("access_denied", "This connector is restricted to the account owner");
  }

  // A login round-trip survives through D1 OAuth state. Once signed in, render
  // a one-time consent request instead of trusting any action/query params.
  const storedConsent = await createConsentRequest(env, {
    clientId: client.client_id,
    userId: session.user_id,
    redirectUri: params.redirect_uri,
    codeChallenge: params.code_challenge,
    scope: GRANTED_SCOPE,
  });
  const consent = storedConsent;
  const fields = {
    client_id: params.client_id,
    client_name: client.client_name ?? "",
    redirect_uri: params.redirect_uri,
    state,
    consent_id: await signConsentId(secret, consent.consentId, state),
    csrf_token: consent.csrfToken,
  };
  return consentPage(request, env, fields);
}

async function handleConsentDecision(
  request: Request,
  env: Env,
  requestOrigin: string,
): Promise<Response> {
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return oauthError("invalid_request", "Body must be application/x-www-form-urlencoded");
  }
  const field = (key: string) => {
    const value = form.get(key);
    return typeof value === "string" ? value : "";
  };
  const signedConsentId = field("consent_id");
  const csrfToken = field("csrf_token");
  const clientId = field("client_id");
  const decision = field("decision");
  const state = field("state");
  const separator = signedConsentId.lastIndexOf(".");
  const consentId = separator > 0 ? signedConsentId.slice(0, separator) : "";
  const consentSig = separator > 0 ? signedConsentId.slice(separator + 1) : "";

  if (!consentId || !consentSig || !csrfToken || !clientId || (decision !== "approve" && decision !== "deny")) {
    return oauthError("invalid_request", "Complete the authorization screen and choose Allow or Deny");
  }
  const client = await getClient(env, clientId);
  if (!client) return oauthError("invalid_client", "Unknown client_id", 401);

  const secret = resolveSessionSecret(request, env);
  if (!secret) return jsonError("SESSION_SECRET not configured", 503);
  const session = await readSessionFromRequest(request, env, secret);
  if (!session) {
    return oauthError("invalid_request", "Your login expired; open the authorization URL again", 401);
  }
  if (!env.PERSONAL_OWNER_ID || session.user_id !== env.PERSONAL_OWNER_ID) {
    return oauthError("access_denied", "This connector is restricted to the account owner", 403);
  }

  // A forged POST can reuse a consent id from another tab only by also knowing
  // its random token; the GET screen is the only place that token is disclosed.
  if (!(await consentCsrfMatches(env, consentId, csrfToken))) {
    return oauthError("invalid_request", "Authorization request is invalid, reused or expired", 403);
  }
  const expectedSignature = await hmacSign(secret, `${consentId}:${state}`);
  if (!(await hmacVerify(secret, `${consentId}:${state}`, consentSig)) || consentSig !== expectedSignature) {
    return oauthError("invalid_request", "Authorization request is invalid, reused or expired", 403);
  }
  const consent = await approvedConsent(await takeConsentRequest(env, consentId), {
    clientId, userId: session.user_id, consentId, state, secret,
  });
  if (!consent) {
    return oauthError("invalid_request", "Authorization request is invalid, reused or expired", 403);
  }

  if (decision === "deny") {
    return redirectToClient(consent.redirect_uri, {
      error: "access_denied",
      ...(consent.state ? { state: consent.state } : {}),
    });
  }

  const code = await createAuthCode(env, {
    clientId: consent.client_id,
    userId: consent.user_id,
    redirectUri: consent.redirect_uri,
    codeChallenge: consent.code_challenge,
    scope: consent.scope,
  });
  // `requestOrigin` keeps TypeScript honest that the server never takes a
  // browser-provided absolute target here; the URI came from D1 registration.
  void requestOrigin;
  return redirectToClient(consent.redirect_uri, {
    code,
    ...(consent.state ? { state: consent.state } : {}),
  });
}

function verifyPkce(verifier: string | null, challenge: string): Promise<boolean> {
  if (!verifier) return Promise.resolve(false);
  return sha256Base64Url(verifier).then(computed => computed === challenge);
}

/** POST /oauth/token — authorization_code (PKCE) and refresh_token grants. */
export async function handleToken(request: Request, env: Env): Promise<Response> {
  if (request.method !== "POST") return jsonError("method not allowed", 405);
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return oauthError("invalid_request", "Body must be application/x-www-form-urlencoded");
  }
  const value = (key: string) => {
    const raw = form.get(key);
    return typeof raw === "string" ? raw : null;
  };
  const grantType = value("grant_type");

  if (grantType === "authorization_code") {
    const code = value("code");
    const clientId = value("client_id");
    const redirectUri = value("redirect_uri");
    if (!code || !clientId || !redirectUri) {
      return oauthError("invalid_request", "code, client_id and redirect_uri are required");
    }
    const client = await getClient(env, clientId);
    if (!client) return oauthError("invalid_client", "Unknown client_id", 401);

    // Single-use: consuming before validation keeps replays from racing.
    const row = await consumeAuthCode(env, code);
    if (!row) return oauthError("invalid_grant", "Authorization code is invalid, expired or already used");
    if (row.client_id !== clientId) return oauthError("invalid_grant", "Code was issued to a different client");
    if (row.redirect_uri !== redirectUri) return oauthError("invalid_grant", "redirect_uri does not match the authorization request");
    if (!(await verifyPkce(value("code_verifier"), row.code_challenge))) {
      return oauthError("invalid_grant", "PKCE verification failed");
    }
    const tokens = await issueTokens(env, row.user_id, clientId, row.scope || GRANTED_SCOPE);
    return json(tokens);
  }

  if (grantType === "refresh_token") {
    const refreshToken = value("refresh_token");
    const clientId = value("client_id");
    if (!refreshToken || !clientId) {
      return oauthError("invalid_request", "refresh_token and client_id are required");
    }
    const rotated = await rotateRefreshToken(env, refreshToken);
    if (!rotated) return oauthError("invalid_grant", "Refresh token is invalid, expired or already used");
    if (rotated.clientId !== clientId) return oauthError("invalid_grant", "Refresh token belongs to a different client");
    const tokens = await issueTokens(env, rotated.userId, clientId, rotated.scope || GRANTED_SCOPE);
    return json(tokens);
  }

  return oauthError("unsupported_grant_type", `Unsupported grant_type: ${grantType ?? "(missing)"}`);
}

/** POST /oauth/revoke — RFC 7009 token revocation. */
export async function handleRevoke(request: Request, env: Env): Promise<Response> {
  if (request.method !== "POST") return jsonError("method not allowed", 405);
  const form = await request.formData().catch(() => null);
  const token = form?.get("token");
  const clientId = form?.get("client_id");
  if (typeof token !== "string" || typeof clientId !== "string") {
    return oauthError("invalid_request", "token and client_id are required");
  }
  // Rotation marks the presented token itself; revoke any token matching it.
  const rotated = await rotateRefreshToken(env, token);
  if (!rotated) {
    await env.DB.prepare(
      "UPDATE mcp_tokens SET revoked_at = ? WHERE token_hash = ? AND revoked_at IS NULL",
    ).bind(Date.now(), await sha256Base64Url(token)).run();
  }
  return json({ ok: true });
}

export const TOKEN_TTL_SECONDS = ACCESS_TTL_SECONDS;

/** GET /api/me/connections — drives the settings page "connected apps" list. */
export async function handleConnections(request: Request, env: Env): Promise<Response> {
  if (request.method === "GET") {
    const secret = resolveSessionSecret(request, env);
    if (!secret) return jsonError("SESSION_SECRET not configured", 503);
    const session = await readSessionFromRequest(request, env, secret);
    if (!session) return jsonError("unauthorized", 401);
    const connections = await listConnections(env, session.user_id);
    return json({ connections, scopes: [GRANTED_SCOPE] });
  }
  if (request.method === "POST") {
    const secret = resolveSessionSecret(request, env);
    if (!secret) return jsonError("SESSION_SECRET not configured", 503);
    const session = await readSessionFromRequest(request, env, secret);
    if (!session) return jsonError("unauthorized", 401);
    const body = (await request.json().catch(() => ({}))) as { client_id?: unknown };
    if (typeof body.client_id !== "string") return jsonError("client_id is required", 400);
    const removed = await revokeClient(env, session.user_id, body.client_id);
    return json({ ok: true, revoked: removed });
  }
  return jsonError("method not allowed", 405);
}

export { clientRedirects };
