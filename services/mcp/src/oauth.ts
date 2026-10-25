import { readSsoSession } from "@kedoupi/shared/auth/client";
import type { Env } from "./env.ts";
import { HttpError, boundedText, escapeHtml, form, json, sameOrigin } from "./http.ts";
import { hidden, page } from "./pages.ts";
import { MODULES } from "./modules.ts";
import { tokenManagement } from "./personal-tokens.ts";
import { resolveMetadataClient } from "./client-metadata.ts";
import {
  SUPPORTED_SCOPES, resource, getClient, createClient, redirectAllowed, createConsentRequest, consentCsrfMatches,
  takeConsentRequest, createAuthCode, lookupAuthCode, exchangeAuthCode, exchangeRefreshToken, hasLiveGrant, sha256Base64Url,
  revokeToken, revokeClient, listConnections, registrableRedirect, clientSecretMatches, CLIENT_AUTH_METHODS,
  type ClientAuthMethod, type OAuthClient,
} from "./oauth-store.ts";

const OWNER = "kdp-owner";
const scopes = [...SUPPORTED_SCOPES];
const grantedScope = scopes.join(" ");
function oauthError(error: string, description: string, status = 400) {
  return json({ error, error_description: description }, status);
}

function validateResource(value: string | null, env: Env) {
  // Omission means this server's sole resource, never an arbitrary downstream API.
  // Clients differ on whether they name the origin or the endpoint, with or without a trailing slash.
  if (value === null) return;
  const canonical = resource(env);
  if (![canonical, `${canonical}/`, env.MCP_ORIGIN, `${env.MCP_ORIGIN}/`].includes(value)) throw new HttpError("invalid_target");
}

/** RFC 6749 §2.3.1: credentials arrive in a Basic header (form-urlencoded parts) or in the body. */
function clientCredentials(request: Request, fields: URLSearchParams) {
  const header = request.headers.get("Authorization")?.match(/^Basic\s+([A-Za-z0-9+/=]+)$/i);
  if (header) {
    try {
      const decoded = atob(header[1]), separator = decoded.indexOf(":");
      if (separator > 0) {
        const decode = (part: string) => decodeURIComponent(part.replace(/\+/g, " "));
        return { clientId: decode(decoded.slice(0, separator)), secret: decode(decoded.slice(separator + 1)) };
      }
    } catch { /* fall through to body credentials */ }
  }
  return { clientId: fields.get("client_id") ?? "", secret: fields.get("client_secret") };
}

async function resolveClient(env: Env, clientId: string): Promise<OAuthClient | null> {
  if (!clientId.startsWith("https://")) return getClient(env, clientId);
  return resolveMetadataClient(clientId);
}

async function authenticatedClient(request: Request, fields: URLSearchParams, env: Env): Promise<OAuthClient | null> {
  const { clientId, secret } = clientCredentials(request, fields);
  const client = await resolveClient(env, clientId);
  return client && await clientSecretMatches(client, secret ?? null) ? client : null;
}

export function discovery(env: Env, protectedResource: boolean) {
  const base = env.MCP_ORIGIN;
  return json(protectedResource ? {
    resource: resource(env), authorization_servers: [base], scopes_supported: scopes,
    bearer_methods_supported: ["header"], resource_documentation: base,
  } : {
    issuer: base, authorization_endpoint: `${base}/oauth/authorize`, token_endpoint: `${base}/oauth/token`,
    registration_endpoint: `${base}/oauth/register`, revocation_endpoint: `${base}/oauth/revoke`,
    scopes_supported: scopes, response_types_supported: ["code"], response_modes_supported: ["query"],
    grant_types_supported: ["authorization_code", "refresh_token"],
    code_challenge_methods_supported: ["S256"], token_endpoint_auth_methods_supported: [...CLIENT_AUTH_METHODS],
    client_id_metadata_document_supported: true,
    revocation_endpoint_auth_methods_supported: [...CLIENT_AUTH_METHODS],
  });
}

export async function register(request: Request, env: Env) {
  if (!request.headers.get("Content-Type")?.toLowerCase().startsWith("application/json")) throw new HttpError("invalid_client_metadata");
  let body: Record<string, unknown>;
  const text = await boundedText(request);
  try {
    body = JSON.parse(text);
    if (!body || typeof body !== "object" || Array.isArray(body)) throw new Error();
  } catch { return oauthError("invalid_client_metadata", "Body must be an object"); }
  const uris = body.redirect_uris;
  if (!Array.isArray(uris) || !uris.length || uris.length > 10 || !uris.every(registrableRedirect)) {
    return oauthError("invalid_redirect_uri", "Register exact HTTPS, loopback or private-use scheme redirect URIs");
  }
  const method = body.token_endpoint_auth_method ?? "none";
  if (!(CLIENT_AUTH_METHODS as readonly unknown[]).includes(method)) {
    return oauthError("invalid_client_metadata", `token_endpoint_auth_method must be one of ${CLIENT_AUTH_METHODS.join(", ")}`);
  }
  const client = await createClient(env, typeof body.client_name === "string" ? body.client_name.slice(0, 120) : null,
    uris as string[], method as ClientAuthMethod);
  return json({ client_id: client.client_id, client_id_issued_at: Math.floor(Date.now() / 1000),
    ...(client.client_secret ? { client_secret: client.client_secret, client_secret_expires_at: 0 } : {}),
    client_name: client.client_name, redirect_uris: uris,
    token_endpoint_auth_method: method, grant_types: ["authorization_code", "refresh_token"],
    response_types: ["code"], scope: grantedScope }, 201);
}

const callbackUrl = (uri: string, params: Record<string, string>) => {
  const target = new URL(uri);
  for (const [key, value] of Object.entries(params)) target.searchParams.set(key, value);
  return target.href;
};

const redirect = (uri: string, params: Record<string, string>) =>
  new Response(null, { status: 302, headers: { Location: callbackUrl(uri, params) } });

// A form POST's redirect chain stays bound by the consent page's CSP form-action,
// so clients whose callback redirects onward (Meta agent, Cursor) get blocked.
// A same-origin handoff page makes the hop to the client a fresh navigation.
function handoffPage(clientName: string, target: string) {
  return page("正在返回客户端", `<p>授权已完成，正在返回 <strong>${escapeHtml(clientName)}</strong>。</p>
<p><a href="${escapeHtml(target)}">如果没有自动跳转，点这里继续</a></p>`, undefined, target);
}

async function sign(env: Env, message: string) {
  if (!env.AUTH_CLIENT_SECRET) throw new HttpError("auth_not_configured", 503);
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(env.AUTH_CLIENT_SECRET),
    { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
  const bytes = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(message)));
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function validSignature(env: Env, message: string, signature: string) {
  const expected = await sign(env, message);
  if (signature.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) diff |= expected.charCodeAt(i) ^ signature.charCodeAt(i);
  return diff === 0;
}

async function owner(request: Request, env: Env) {
  const session = await readSsoSession(request, env);
  if (session && (session.subject !== OWNER || session.userId !== OWNER)) throw new HttpError("not_owner", 403);
  return session;
}

function consentPage(clientName: string, fields: Record<string, string>, redirectUri: string, clientId: string) {
  const item = (scope: string, label: string, sensitive: boolean) =>
    `<li>${escapeHtml(label)} <code>${scope}</code>${sensitive ? " · 敏感数据" : ""}</li>`;
  return page("连接 CodePi MCP", `<p>连接 <strong>${escapeHtml(clientName)}</strong> 将获得 CodePi MCP 当前支持的全部权限。敏感数据只能由已登录的所有者授权访问，不会向客户端提供第三方凭证。</p>
<p>返回地址：<code>${escapeHtml(redirectUri)}</code>${clientId.startsWith("https:") ? `<br>客户端元数据：<code>${escapeHtml(clientId)}</code>` : ""}</p>
<form method="POST" action="/oauth/authorize">${hidden(fields)}
<fieldset><legend>授权范围</legend><ul>
${item("context.read", "读取已授权领域的简短概览", false)}
${MODULES.map(m => Object.entries(m.consent).map(([s, label]) => item(s, label, m.sensitive)).join("")).join("")}
</ul></fieldset>
<p>当前连接的全部权限一次开通；以后新增的已支持领域在 token 刷新后生效。可以在连接管理中随时撤销。</p>
<div class="actions"><button class="approve" name="decision" value="approve">允许连接</button>
<button name="decision" value="deny">拒绝</button></div></form>`);
}

export async function authorize(request: Request, env: Env) {
  if (request.method === "POST") return consent(request, env);
  const params = new URL(request.url).searchParams;
  const client = await resolveClient(env, params.get("client_id") ?? "");
  if (!client) return oauthError("invalid_client", "Unknown client_id");
  const uri = params.get("redirect_uri") ?? "";
  if (!redirectAllowed(client, uri)) return oauthError("invalid_redirect_uri", "URI is not registered");
  const state = params.get("state") ?? "";
  const deny = (error: string) => redirect(uri, { error, ...(state ? { state } : {}) });
  if (params.get("response_type") !== "code") return deny("unsupported_response_type");
  if (params.get("code_challenge_method") !== "S256" || !/^[A-Za-z0-9_-]{43}$/.test(params.get("code_challenge") ?? "")) {
    return deny("invalid_request");
  }
  if (params.getAll("resource").length > 1) return deny("invalid_target");
  try { validateResource(params.get("resource"), env); } catch { return deny("invalid_target"); }
  // The owner always grants the full supported set, so requested scopes (including
  // offline_access/openid/profile or another server's names) never narrow or block it.
  const session = await owner(request, env);
  if (!session) {
    const target = new URL("/api/auth/login", env.MCP_ORIGIN);
    target.searchParams.set("return", new URL(request.url).pathname + new URL(request.url).search);
    return new Response(null, { status: 302, headers: { Location: target.href } });
  }
  // A client with a live grant was already approved by the owner for the fixed
  // full-scope set; re-authorization skips the consent screen. Revoking the
  // connection in the manager removes the grant and restores manual consent.
  if (!client.client_id.startsWith("https://") && await hasLiveGrant(env, client.client_id)) {
    const code = await createAuthCode(env, { clientId: client.client_id, userId: session.userId,
      redirectUri: uri, codeChallenge: params.get("code_challenge")!, scope: grantedScope });
    return redirect(uri, { code, ...(state ? { state } : {}) });
  }
  const tx = await createConsentRequest(env, { clientId: client.client_id, userId: session.userId,
    redirectUri: uri, codeChallenge: params.get("code_challenge")!, scope: grantedScope });
  const signed = `${tx.consentId}.${await sign(env, `${tx.consentId}:${state}`)}`;
  return consentPage(client.client_name ?? client.client_id, { client_id: client.client_id, state,
    consent_id: signed, csrf_token: tx.csrfToken }, uri, client.client_id);
}

async function consent(request: Request, env: Env) {
  sameOrigin(request);
  const fields = await form(request);
  const session = await owner(request, env);
  if (!session) throw new HttpError("unauthorized", 401);
  const signed = fields.get("consent_id") ?? "";
  const separator = signed.lastIndexOf(".");
  const id = signed.slice(0, separator), signature = signed.slice(separator + 1), state = fields.get("state") ?? "";
  if (separator < 1 || !["approve", "deny"].includes(fields.get("decision") ?? "")
    || !(await validSignature(env, `${id}:${state}`, signature))
    || !(await consentCsrfMatches(env, id, fields.get("csrf_token") ?? ""))) {
    return oauthError("invalid_request", "Consent is invalid, expired or already used", 403);
  }
  // Validate ownership before consumption; a different browser transaction cannot burn it.
  const bound = await env.DB.prepare(`SELECT client_id,user_id,redirect_uri FROM oauth_consent_requests WHERE consent_id=?`)
    .bind(id).first<{ client_id: string; user_id: string; redirect_uri: string }>();
  if (bound?.client_id !== fields.get("client_id") || bound?.user_id !== session.userId) {
    return oauthError("invalid_request", "Consent owner or client mismatch", 403);
  }
  const tx = await takeConsentRequest(env, id);
  if (!tx) return oauthError("invalid_request", "Consent is expired or used", 403);
  const metadataClient = tx.client_id.startsWith("https://") ? await resolveClient(env, tx.client_id) : null;
  if (tx.client_id.startsWith("https://") && (!metadataClient || !redirectAllowed(metadataClient, tx.redirect_uri))) {
    return oauthError("invalid_client", "Client metadata changed during authorization");
  }
  const clientName = metadataClient?.client_name ?? (await getClient(env, tx.client_id))?.client_name ?? tx.client_id;
  if (fields.get("decision") === "deny") {
    return handoffPage(clientName, callbackUrl(tx.redirect_uri, { error: "access_denied", ...(state ? { state } : {}) }));
  }
  const code = await createAuthCode(env, { clientId: tx.client_id, userId: tx.user_id, redirectUri: tx.redirect_uri,
    codeChallenge: tx.code_challenge, scope: grantedScope });
  return handoffPage(clientName, callbackUrl(tx.redirect_uri, { code, ...(state ? { state } : {}) }));
}

export async function token(request: Request, env: Env) {
  const fields = await form(request);
  try {
    if (fields.getAll("resource").length > 1) throw new HttpError("invalid_target");
    validateResource(fields.get("resource"), env);
  } catch { return oauthError("invalid_target", "Token audience must be the CodePi MCP resource"); }
  // A requested scope never narrows the fixed full grant, so it is not validated here either.
  const client = await authenticatedClient(request, fields, env);
  if (!client) return oauthError("invalid_client", "Unknown client_id or invalid client credentials", 401);
  const clientId = client.client_id;
  if (fields.get("grant_type") === "authorization_code") {
    const code = fields.get("code") ?? "", verifier = fields.get("code_verifier") ?? "";
    const tx = await lookupAuthCode(env, code);
    if (!tx || tx.user_id !== OWNER || tx.client_id !== clientId || tx.redirect_uri !== fields.get("redirect_uri")
      || !redirectAllowed(client, tx.redirect_uri)
      || !/^[A-Za-z0-9._~-]{43,128}$/.test(verifier)
      || await sha256Base64Url(verifier) !== tx.code_challenge) return oauthError("invalid_grant", "Invalid authorization code or PKCE");
    const pair = await exchangeAuthCode(env, code, tx);
    return pair ? json(pair) : oauthError("invalid_grant", "Authorization code expired or already used");
  }
  if (fields.get("grant_type") === "refresh_token") {
    const result = await exchangeRefreshToken(env, fields.get("refresh_token") ?? "", clientId);
    return result.ok ? json(result.tokens) : oauthError("invalid_grant", "Refresh token expired, revoked or reused");
  }
  return oauthError("unsupported_grant_type", "Use authorization_code or refresh_token");
}

export async function revoke(request: Request, env: Env) {
  const fields = await form(request);
  if (!fields.get("token")) return oauthError("invalid_request", "token is required");
  const client = await authenticatedClient(request, fields, env);
  if (!client) return oauthError("invalid_client", "Unknown client_id or invalid client credentials", 401);
  await revokeToken(env, fields.get("token")!, client.client_id);
  return json({ ok: true });
}

export async function connections(request: Request, env: Env) {
  const session = await owner(request, env);
  if (!session) {
    const target = encodeURIComponent(new URL(request.url).pathname);
    return new Response(null, { status: 302, headers: { Location: `/api/auth/login?return=${target}` } });
  }
  if (new URL(request.url).pathname === "/connections/tokens") {
    return tokenManagement(request, env, session.userId, await sign(env, `tokens:${session.id}`));
  }
  if (new URL(request.url).pathname === "/connections/clients") {
    const csrf = await sign(env, `clients:${session.id}`);
    if (request.method === "POST") {
      sameOrigin(request);
      const fields = await form(request);
      if (fields.get("csrf_token") !== csrf) throw new HttpError("invalid_csrf", 403);
      const uris = (fields.get("redirect_uris") ?? "").split(/\s+/).filter(Boolean);
      if (!uris.length || uris.length > 10 || !uris.every(registrableRedirect)) throw new HttpError("invalid_redirect_uri");
      const method = fields.get("method") ?? "none";
      if (!(CLIENT_AUTH_METHODS as readonly string[]).includes(method)) throw new HttpError("invalid_client_metadata");
      const client = await createClient(env, (fields.get("name") ?? "AI client").slice(0, 120), uris, method as ClientAuthMethod);
      return page("客户端已注册", `<p>将以下信息填写到客户端，再完成 OAuth 授权。</p><p>Client ID：<code>${escapeHtml(client.client_id)}</code></p>
${client.client_secret ? `<p>Client secret 仅显示一次：</p><textarea readonly aria-label="Client secret">${escapeHtml(client.client_secret)}</textarea>` : ""}
<p>授权地址：<code>${env.MCP_ORIGIN}/oauth/authorize</code></p><p>Token 地址：<code>${env.MCP_ORIGIN}/oauth/token</code></p><p><a href="/connections">返回连接管理</a></p>`);
    }
    return page("注册 AI 客户端", `<p>用于不能自动注册、需要手动填写 Client ID 的客户端。</p><form method="POST">${hidden({ csrf_token: csrf })}
<label>名称 <input name="name" required maxlength="120"></label><label>回调地址（每行一个）<textarea name="redirect_uris" required></textarea></label>
<label>认证方式 <select name="method">${CLIENT_AUTH_METHODS.map(m => `<option>${m}</option>`).join("")}</select></label><button>注册客户端</button></form><p><a href="/connections">返回连接管理</a></p>`);
  }
  if (request.method === "POST") {
    sameOrigin(request);
    const fields = await form(request);
    if (!(await validSignature(env, `connections:${session.id}`, fields.get("csrf_token") ?? ""))) {
      throw new HttpError("invalid_csrf", 403);
    }
    await revokeClient(env, session.userId, fields.get("client_id") ?? "");
    return new Response(null, { status: 303, headers: { Location: "/connections" } });
  }
  const rows = await listConnections(env, session.userId);
  const csrf = await sign(env, `connections:${session.id}`);
  return page("已授权的 AI 客户端", `<p>撤销只会断开该客户端；不会断开 Oura 或退出网站登录。</p>
<p><a href="/connections/tokens">个人访问令牌</a> · <a href="/connections/clients">手动注册客户端</a></p>
${rows.length ? `<ul>${rows.map(row => `<li><strong>${escapeHtml(row.client_name ?? row.client_id)}</strong>
<p><code>${escapeHtml(row.scope)}</code> · ${MODULES.filter(m => Object.keys(m.consent).some(s => row.scope.split(" ").includes(s))).map(m => escapeHtml(m.title)).join("、")} · 有效至 ${escapeHtml(new Date(row.expires_at).toISOString())}</p>
<form action="/connections" method="POST">${hidden({ client_id: row.client_id, csrf_token: csrf })}
<button>撤销连接</button></form></li>`).join("")}</ul>` : "<p>还没有已授权客户端。</p>"}
<p><a href="/">返回 MCP 入口</a> · <a href="https://health.codepi.app/settings#connections">Health 设置</a></p>`);
}
