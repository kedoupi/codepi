import { createHash, randomBytes } from "node:crypto";
import { createServer } from "node:http";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { spawn } from "node:child_process";
import { CliError, EXIT, argumentError } from "./errors.js";
import {
  type AuthorizationMetadataRecord,
  type CredentialRecord,
  type CredentialStore,
  type StoredTokens,
} from "./config.js";
import { acquireLock } from "./lock.js";
import {
  assertTrustedUrl,
  authorizationMetadataUrl,
  mcpEndpoint,
  normalizeServer,
} from "./server.js";

export const DEFAULT_SCOPES = ["context.read", "projects.read", "projects.write"] as const;
const LOGIN_TIMEOUT_MS = 5 * 60_000;
const REFRESH_WINDOW_MS = 60_000;
const REDIRECT_BASE = "http://127.0.0.1/callback";

type FetchLike = typeof fetch;

interface RawAuthorizationMetadata {
  issuer?: unknown;
  authorization_endpoint?: unknown;
  token_endpoint?: unknown;
  registration_endpoint?: unknown;
  revocation_endpoint?: unknown;
  scopes_supported?: unknown;
  response_types_supported?: unknown;
  code_challenge_methods_supported?: unknown;
  token_endpoint_auth_methods_supported?: unknown;
}

interface RawTokenResponse {
  access_token?: unknown;
  refresh_token?: unknown;
  token_type?: unknown;
  expires_in?: unknown;
  scope?: unknown;
}

export interface LoopbackCallback {
  redirectUri: string;
  port: number;
  waitForCode(): Promise<string>;
  close(): Promise<void>;
}

export function normalizeScopes(value?: string): string[] {
  const parts = (value ?? DEFAULT_SCOPES.join(","))
    .split(/[,\s]+/)
    .map((scope) => scope.trim())
    .filter(Boolean);
  const unique = [...new Set(parts)];
  if (unique.length === 0) throw argumentError("至少需要一个 scope");
  if (unique.some((scope) => !/^[A-Za-z0-9._:-]+$/.test(scope))) {
    throw argumentError("scope 只能包含字母、数字、点、下划线、冒号和连字符");
  }
  return unique;
}

export async function discoverAuthorizationMetadata(
  server: string,
  fetchImpl: FetchLike = fetch,
): Promise<AuthorizationMetadataRecord> {
  const normalized = normalizeServer(server);
  let response: Response;
  try {
    response = await fetchImpl(authorizationMetadataUrl(normalized), {
      headers: { Accept: "application/json" },
      redirect: "error",
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    throw new CliError("无法连接授权服务器元数据端点。", EXIT.REMOTE, {
      code: "oauth_discovery_unavailable",
    });
  }
  if (!response.ok) {
    throw new CliError(`授权服务器元数据请求失败（HTTP ${response.status}）。`, EXIT.REMOTE, {
      code: "oauth_discovery_failed",
    });
  }
  let raw: RawAuthorizationMetadata;
  try {
    raw = (await response.json()) as RawAuthorizationMetadata;
  } catch {
    throw new CliError("授权服务器元数据不是有效 JSON。", EXIT.REMOTE, {
      code: "oauth_discovery_invalid",
    });
  }
  try {
    return validateAuthorizationMetadata(raw, normalized);
  } catch (error) {
    throw new CliError(
      error instanceof Error ? error.message : "授权服务器元数据校验失败。",
      EXIT.REMOTE,
      { code: "oauth_metadata_origin_mismatch" },
    );
  }
}

export function validateAuthorizationMetadata(
  raw: RawAuthorizationMetadata,
  server: string,
): AuthorizationMetadataRecord {
  const normalized = normalizeServer(server);
  if (typeof raw.issuer !== "string") throw new Error("授权服务器 metadata 缺少 issuer");
  if (typeof raw.authorization_endpoint !== "string") {
    throw new Error("授权服务器 metadata 缺少 authorization_endpoint");
  }
  if (typeof raw.token_endpoint !== "string") throw new Error("授权服务器 metadata 缺少 token_endpoint");

  const issuer = assertTrustedUrl(raw.issuer, normalized, "issuer");
  assertTrustedUrl(raw.authorization_endpoint, normalized, "authorization_endpoint");
  assertTrustedUrl(raw.token_endpoint, normalized, "token_endpoint");
  const registrationEndpoint = optionalTrustedUrl(
    raw.registration_endpoint,
    normalized,
    "registration_endpoint",
  );
  const revocationEndpoint = optionalTrustedUrl(
    raw.revocation_endpoint,
    normalized,
    "revocation_endpoint",
  );

  if (Array.isArray(raw.response_types_supported) &&
      !raw.response_types_supported.includes("code")) {
    throw new Error("授权服务器不支持 authorization code");
  }
  if (Array.isArray(raw.code_challenge_methods_supported) &&
      !raw.code_challenge_methods_supported.includes("S256")) {
    throw new Error("授权服务器不支持 PKCE S256");
  }
  if (Array.isArray(raw.token_endpoint_auth_methods_supported) &&
      !raw.token_endpoint_auth_methods_supported.includes("none")) {
    throw new Error("授权服务器不支持公共客户端 token_endpoint_auth_method=none");
  }
  const scopes = stringArray(raw.scopes_supported);
  return {
    issuer: issuer.href,
    authorization_endpoint: raw.authorization_endpoint,
    token_endpoint: raw.token_endpoint,
    ...(registrationEndpoint ? { registration_endpoint: registrationEndpoint.href } : {}),
    ...(revocationEndpoint ? { revocation_endpoint: revocationEndpoint.href } : {}),
    ...(scopes ? { scopes_supported: scopes } : {}),
    ...(Array.isArray(raw.code_challenge_methods_supported)
      ? { code_challenge_methods_supported: raw.code_challenge_methods_supported.filter(isString) }
      : {}),
    resource: mcpEndpoint(normalized),
  };
}

function optionalTrustedUrl(value: unknown, server: string, label: string): URL | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string") throw new Error(`${label} 必须是 URL`);
  return assertTrustedUrl(value, server, label);
}

function stringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value) || !value.every(isString)) return undefined;
  return [...value];
}

function isString(value: unknown): value is string {
  return typeof value === "string";
}

export async function registerClient(
  metadata: AuthorizationMetadataRecord,
  scopes: string[],
  fetchImpl: FetchLike = fetch,
): Promise<NonNullable<CredentialRecord["client"]>> {
  if (!metadata.registration_endpoint) {
    throw new CliError("授权服务器未提供动态客户端注册端点。", EXIT.REMOTE, {
      code: "dcr_unavailable",
    });
  }
  assertTrustedUrl(metadata.registration_endpoint, metadata.issuer, "registration_endpoint");
  let response: Response;
  try {
    response = await fetchImpl(metadata.registration_endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({
        client_name: "codepi CLI",
        redirect_uris: [REDIRECT_BASE],
        token_endpoint_auth_method: "none",
        grant_types: ["authorization_code", "refresh_token"],
        response_types: ["code"],
        scope: scopes.join(" "),
      }),
      redirect: "error",
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    throw new CliError("无法连接动态客户端注册端点。", EXIT.REMOTE, { code: "dcr_unavailable" });
  }
  if (!response.ok) {
    throw new CliError(`动态客户端注册失败（HTTP ${response.status}）。`, EXIT.REMOTE, {
      code: "dcr_failed",
    });
  }
  let raw: Record<string, unknown>;
  try {
    raw = (await response.json()) as Record<string, unknown>;
  } catch {
    throw new CliError("动态客户端注册响应不是有效 JSON。", EXIT.REMOTE, { code: "dcr_invalid" });
  }
  if (typeof raw.client_id !== "string" || raw.client_id.length === 0) {
    throw new CliError("动态客户端注册响应缺少 client_id。", EXIT.REMOTE, { code: "dcr_invalid" });
  }
  return {
    client_id: raw.client_id,
    ...(typeof raw.client_name === "string" ? { client_name: raw.client_name } : {}),
    redirect_uris: stringArray(raw.redirect_uris) ?? [REDIRECT_BASE],
    token_endpoint_auth_method: "none",
    issuer: metadata.issuer,
  };
}

export function pkcePair(verifier = base64Url(randomBytes(32))): {
  verifier: string;
  challenge: string;
} {
  if (!/^[A-Za-z0-9._~-]{43,128}$/.test(verifier)) {
    throw new Error("PKCE verifier 必须为 43-128 个 RFC 7636 字符");
  }
  const challenge = base64Url(createHash("sha256").update(verifier).digest());
  return { verifier, challenge };
}

export function randomState(): string {
  return base64Url(randomBytes(32));
}

export async function startLoopbackCallback(
  expectedState: string,
  options: { timeoutMs?: number } = {},
): Promise<LoopbackCallback> {
  let settled = false;
  let resolveCode!: (code: string) => void;
  let rejectCode!: (error: Error) => void;
  const codePromise = new Promise<string>((resolve, reject) => {
    resolveCode = resolve;
    rejectCode = reject;
  });

  const server = createServer((request, response) => {
    handleCallbackRequest(request, response, expectedState, () => settled, {
      resolve(code) {
        if (settled) return;
        settled = true;
        resolveCode(code);
      },
      reject(error) {
        if (settled) return;
        settled = true;
        rejectCode(error);
      },
    });
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject);
      resolve();
    });
  });
  const address = server.address() as AddressInfo;
  const timeout = setTimeout(() => {
    if (settled) return;
    settled = true;
    rejectCode(new CliError("登录等待回调超时（5 分钟），请重新运行 `codepi login`。", EXIT.AUTH, {
      code: "oauth_callback_timeout",
    }));
    server.close();
  }, options.timeoutMs ?? LOGIN_TIMEOUT_MS);
  timeout.unref();

  const close = async () => {
    clearTimeout(timeout);
    await new Promise<void>((resolve) => server.close(() => resolve()));
  };
  codePromise.catch(() => undefined).finally(() => {
    clearTimeout(timeout);
    server.close();
  });

  return {
    redirectUri: `http://127.0.0.1:${address.port}/callback`,
    port: address.port,
    waitForCode: () => codePromise,
    close,
  };
}

function handleCallbackRequest(
  request: IncomingMessage,
  response: ServerResponse,
  expectedState: string,
  settled: () => boolean,
  done: { resolve(code: string): void; reject(error: Error): void },
): void {
  const url = new URL(request.url ?? "/", "http://127.0.0.1");
  if (request.method !== "GET" || url.pathname !== "/callback") {
    sendText(response, 404, "Not found");
    return;
  }
  const state = url.searchParams.get("state") ?? "";
  if (!sameSecret(state, expectedState)) {
    sendText(response, 400, "Invalid OAuth state");
    return;
  }
  if (settled()) {
    sendText(response, 409, "Callback already handled");
    return;
  }
  const error = url.searchParams.get("error");
  if (error) {
    sendText(response, 400, "Authorization was not completed");
    const accessDenied = error === "access_denied";
    done.reject(new CliError(
      accessDenied ? "授权已取消。" : "授权失败，请重新运行 `codepi login`。",
      accessDenied ? EXIT.AUTH : EXIT.REMOTE,
      { code: accessDenied ? "oauth_access_denied" : "oauth_authorization_failed" },
    ));
    return;
  }
  const code = url.searchParams.get("code");
  if (!code) {
    sendText(response, 400, "Missing authorization code");
    return;
  }
  sendText(response, 200, "CodePi 登录完成，可以关闭此页面。");
  done.resolve(code);
}

function sameSecret(actual: string, expected: string): boolean {
  const a = Buffer.from(actual);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

function timingSafeEqual(a: Buffer, b: Buffer): boolean {
  let difference = 0;
  for (let i = 0; i < a.length; i += 1) difference |= (a[i] ?? 0) ^ (b[i] ?? 0);
  return difference === 0;
}

function sendText(response: ServerResponse, status: number, text: string): void {
  response.writeHead(status, {
    "Content-Type": "text/plain; charset=utf-8",
    "Cache-Control": "no-store",
    "Content-Security-Policy": "default-src 'none'",
    "X-Content-Type-Options": "nosniff",
  });
  response.end(text);
}

export async function openBrowser(url: string): Promise<boolean> {
  const command = process.platform === "darwin"
    ? ["open", [url]]
    : process.platform === "win32"
      ? ["cmd", ["/c", "start", "", url]]
      : ["xdg-open", [url]];
  return new Promise((resolve) => {
    try {
      const child = spawn(command[0] as string, command[1] as string[], {
        detached: true,
        stdio: "ignore",
      });
      child.once("error", () => resolve(false));
      child.once("spawn", () => {
        child.unref();
        resolve(true);
      });
    } catch {
      resolve(false);
    }
  });
}

export function authorizationUrl(
  metadata: AuthorizationMetadataRecord,
  clientId: string,
  redirectUri: string,
  state: string,
  scope: string[],
  codeChallenge: string,
): string {
  const url = new URL(metadata.authorization_endpoint);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", clientId);
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("code_challenge", codeChallenge);
  url.searchParams.set("code_challenge_method", "S256");
  url.searchParams.set("state", state);
  url.searchParams.set("scope", scope.join(" "));
  url.searchParams.set("resource", metadata.resource);
  return url.href;
}

export async function exchangeAuthorizationCode(
  metadata: AuthorizationMetadataRecord,
  clientId: string,
  code: string,
  verifier: string,
  redirectUri: string,
  fetchImpl: FetchLike = fetch,
): Promise<StoredTokens> {
  const params = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    code_verifier: verifier,
    redirect_uri: redirectUri,
    client_id: clientId,
    resource: metadata.resource,
  });
  return tokenRequest(metadata, params, fetchImpl);
}

export function validateStoredMetadata(
  metadata: AuthorizationMetadataRecord,
  server: string,
): AuthorizationMetadataRecord {
  const normalized = normalizeServer(server);
  assertTrustedUrl(metadata.issuer, normalized, "issuer");
  assertTrustedUrl(metadata.authorization_endpoint, normalized, "authorization_endpoint");
  assertTrustedUrl(metadata.token_endpoint, normalized, "token_endpoint");
  if (metadata.registration_endpoint) {
    assertTrustedUrl(metadata.registration_endpoint, normalized, "registration_endpoint");
  }
  if (metadata.revocation_endpoint) {
    assertTrustedUrl(metadata.revocation_endpoint, normalized, "revocation_endpoint");
  }
  return metadata;
}

export async function refreshCredentialsIfNeeded(
  store: CredentialStore,
  options: {
    fetchImpl?: FetchLike;
    now?: number;
    minValidityMs?: number;
  } = {},
): Promise<{ tokens: StoredTokens; refreshed: boolean }> {
  const now = options.now ?? Date.now();
  const minValidityMs = options.minValidityMs ?? REFRESH_WINDOW_MS;
  const first = await store.read();
  if (!first?.tokens) {
    throw new CliError("本地没有登录凭证，请运行 `codepi login`。", EXIT.AUTH, {
      code: "authentication_required",
    });
  }
  if (first.tokens.expires_at - now > minValidityMs) {
    return { tokens: first.tokens, refreshed: false };
  }

  const lock = await acquireLock(store.lockPath);
  try {
    const current = await store.read();
    if (!current?.tokens) {
      throw new CliError("本地没有登录凭证，请运行 `codepi login`。", EXIT.AUTH, {
        code: "authentication_required",
      });
    }
    const checkNow = options.now ?? Date.now();
    if (current.tokens.expires_at - checkNow > minValidityMs) {
      return { tokens: current.tokens, refreshed: false };
    }
    if (!current.metadata) {
      throw new CliError("本地登录信息不完整，请运行 `codepi login`。", EXIT.AUTH, {
        code: "metadata_missing",
      });
    }
    if (!current.client) {
      throw new CliError("本地客户端信息不完整，请运行 `codepi login`。", EXIT.AUTH, {
        code: "client_missing",
      });
    }
    const metadata = validateStoredMetadata(current.metadata, store.server);
    const refreshed = await refreshAuthorization(
      metadata,
      current.client.client_id,
      current.tokens,
      store.server,
      options.fetchImpl ?? fetch,
    );
    await store.write({ ...current, tokens: refreshed });
    return { tokens: refreshed, refreshed: true };
  } finally {
    await lock.release();
  }
}

export async function refreshAuthorization(
  metadata: AuthorizationMetadataRecord,
  clientId: string,
  tokens: StoredTokens,
  server: string,
  fetchImpl: FetchLike = fetch,
): Promise<StoredTokens> {
  if (!tokens.refresh_token) {
    throw new CliError("登录已过期且没有 refresh token，请运行 `codepi login`。", EXIT.AUTH, {
      code: "refresh_token_missing",
    });
  }
  validateStoredMetadata(metadata, server);
  const params = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: tokens.refresh_token,
    client_id: clientId,
    resource: metadata.resource,
  });
  return tokenRequest(metadata, params, fetchImpl, tokens.refresh_token);
}

async function tokenRequest(
  metadata: AuthorizationMetadataRecord,
  params: URLSearchParams,
  fetchImpl: FetchLike,
  previousRefreshToken?: string,
): Promise<StoredTokens> {
  const endpoint = assertTrustedUrl(metadata.token_endpoint, metadata.issuer, "token_endpoint");
  let response: Response;
  try {
    response = await fetchImpl(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "application/json",
      },
      body: params,
      redirect: "error",
      signal: AbortSignal.timeout(15_000),
    });
  } catch {
    throw new CliError("无法连接 token 端点。", EXIT.REMOTE, { code: "token_endpoint_unavailable" });
  }
  let raw: RawTokenResponse = {};
  try {
    raw = (await response.json()) as RawTokenResponse;
  } catch {
    // The status below still determines the user-facing error.
  }
  if (!response.ok) {
    const oauthError = typeof (raw as { error?: unknown }).error === "string"
      ? (raw as { error: string }).error
      : `http_${response.status}`;
    if (oauthError === "invalid_grant" || response.status === 400 || response.status === 401) {
      throw new CliError("登录凭证已失效，请运行 `codepi login`。", EXIT.AUTH, {
        code: oauthError,
      });
    }
    throw new CliError(`token 端点返回错误（HTTP ${response.status}）。`, EXIT.REMOTE, {
      code: oauthError,
    });
  }
  const accessToken = raw.access_token;
  const tokenType = raw.token_type;
  const expiresIn = raw.expires_in;
  if (
    typeof accessToken !== "string" ||
    accessToken.length === 0 ||
    typeof tokenType !== "string" ||
    tokenType.toLowerCase() !== "bearer" ||
    typeof expiresIn !== "number" ||
    !Number.isFinite(expiresIn) ||
    expiresIn <= 0
  ) {
    throw new CliError("token 端点返回了无效响应。", EXIT.REMOTE, { code: "token_response_invalid" });
  }
  const scope = typeof raw.scope === "string" && raw.scope.length > 0
    ? raw.scope
    : metadataScopesFallback(metadata);
  return {
    access_token: accessToken,
    ...(typeof raw.refresh_token === "string" && raw.refresh_token.length > 0
      ? { refresh_token: raw.refresh_token }
      : previousRefreshToken === undefined
        ? {}
        : { refresh_token: previousRefreshToken }),
    token_type: "Bearer",
    scope,
    expires_at: Date.now() + Math.floor(expiresIn * 1000),
    issuer: metadata.issuer,
  };
}

function metadataScopesFallback(metadata: AuthorizationMetadataRecord): string {
  return metadata.scopes_supported?.join(" ") ?? "";
}

export async function revokeAuthorization(
  metadata: AuthorizationMetadataRecord,
  clientId: string,
  token: string,
  server: string,
  fetchImpl: FetchLike = fetch,
): Promise<void> {
  if (!metadata.revocation_endpoint) return;
  validateStoredMetadata(metadata, server);
  const endpoint = new URL(metadata.revocation_endpoint);
  const response = await fetchImpl(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
    },
    body: new URLSearchParams({ token, token_type_hint: "refresh_token", client_id: clientId }),
    redirect: "error",
    signal: AbortSignal.timeout(10_000),
  });
  await response.body?.cancel();
  if (!response.ok) {
    throw new CliError(`撤销端点返回错误（HTTP ${response.status}）。`, EXIT.REMOTE, {
      code: "oauth_revocation_failed",
    });
  }
}

function base64Url(value: Uint8Array | Buffer): string {
  return Buffer.from(value).toString("base64url");
}
