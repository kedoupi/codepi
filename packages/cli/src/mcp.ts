import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import {
  StreamableHTTPClientTransport,
  StreamableHTTPError,
} from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import {
  UnauthorizedError,
  type OAuthClientProvider,
  type OAuthDiscoveryState,
} from "@modelcontextprotocol/sdk/client/auth.js";
import type {
  OAuthClientInformationMixed,
  OAuthClientMetadata,
  OAuthTokens,
} from "@modelcontextprotocol/sdk/shared/auth.js";
import {
  type AuthorizationMetadataRecord,
  type CredentialRecord,
  CredentialStore,
  type StoredTokens,
} from "./config.js";
import {
  CliError,
  EXIT,
  authError,
  errorMessage,
  scopeError,
} from "./errors.js";
import { acquireLock, type FileLock } from "./lock.js";
import { refreshCredentialsIfNeeded } from "./oauth.js";
import {
  assertTrustedUrl,
  mcpEndpoint,
  protectedResourceMetadataUrl,
  normalizeServer,
} from "./server.js";

type FetchLike = typeof fetch;
type CachedRefreshResponse = { response: Response } | { error: unknown };

const SAFE_TOOL_ERROR_CODES = new Set([
  "invalid_arguments",
  "invalid_cursor",
  "cursor_stale",
  "not_owner",
  "not_found",
  "client_required",
  "source_unavailable",
  "storage_unavailable",
  "secret_detected",
  "already_imported",
  "import_not_found",
  "chunk_conflict",
  "digest_mismatch",
  "chunk_out_of_order",
  "empty_import",
  "import_limit_exceeded",
  "import_chunk_too_large",
  // Blog domain rejections. They are fixed codes, so they are safe to show.
  "unknown_media",
  "cover_required",
  "too_many_images",
  "invalid_image",
  "alt_required",
  "unsafe_content",
  "test_draft",
  "archived",
  "unknown_category",
  "category_limit",
  "category_in_use",
  "revision_conflict",
  "markdown_unavailable",
  "payload_too_large",
]);
const SAFE_SCOPES = new Set([
  "context.read",
  "projects.read",
  "projects.write",
  "health.read",
  "health.sync",
  "me.read",
  "me.write",
  "invest.read",
  "blog.read",
  "blog.write",
]);
// The server names the failing argument as a schema path and the failed rule
// as a fixed token. Both are server-generated, but they are echoed only when
// they match these shapes, so a remote peer cannot smuggle text into a
// command's output.
const SAFE_FIELD = /^\/[A-Za-z0-9_]{1,64}(?:\/[A-Za-z0-9_]{1,64}){0,8}$/;
const SAFE_REASON = /^[A-Za-z]{1,32}$/;

export interface McpToolResult {
  structured: unknown;
  text: string | null;
}

export interface CallMcpOptions {
  server: string;
  name: string;
  args: Record<string, unknown>;
  fetchImpl?: FetchLike;
  configDir?: string;
}

export async function callMcpTool(options: CallMcpOptions): Promise<McpToolResult> {
  const server = normalizeServer(options.server);
  const store = new CredentialStore(server, {
    ...(options.configDir === undefined ? {} : { configDir: options.configDir }),
  });
  await refreshCredentialsIfNeeded(store, {
    ...(options.fetchImpl === undefined ? {} : { fetchImpl: options.fetchImpl }),
  });
  const credentials = await store.read();
  if (!credentials?.metadata || !credentials.client) {
    throw authError("本地登录信息不完整，请运行 `codepi login`。");
  }

  const provider = new CredentialOAuthProvider(server, store);
  const transport = new StreamableHTTPClientTransport(new URL(mcpEndpoint(server)), {
    authProvider: provider,
    fetch: createTransportFetch(provider, options.fetchImpl ?? fetch),
    redirectPolicy: "same-origin",
    reconnectionOptions: {
      initialReconnectionDelay: 100,
      maxReconnectionDelay: 500,
      reconnectionDelayGrowFactor: 2,
      maxRetries: 0,
    },
  });
  const client = new Client(
    { name: "codepi-cli", version: "0.1.0" },
    { capabilities: {} },
  );

  try {
    await client.connect(transport as unknown as Parameters<typeof client.connect>[0]);
    const result = await client.callTool({
      name: options.name,
      arguments: options.args,
    });
    if ("toolResult" in result) {
      return { structured: result.toolResult, text: null };
    }
    const textParts = result.content
      .filter((item): item is Extract<(typeof result.content)[number], { type: "text" }> =>
        item.type === "text")
      .map((item) => item.text);
    const text = textParts.length > 0 ? textParts.join("\n") : null;
    if (result.isError) {
      const code = result.structuredContent?.error;
      if (code === "insufficient_scope" || code === "tool_not_available") {
        // The server names the scope the tool needs, so the command can ask
        // for exactly that instead of "some scope".
        const scope = safeScope(
          typeof result.structuredContent?.scope === "string" ? result.structuredContent.scope : null);
        throw scopeError(
          scope
            ? `当前授权没有此工具的权限，缺少 scope：${scope}。请运行 \`codepi login --scopes ${scope}\` 重新授权。`
            : "当前授权没有此工具的权限，请运行 `codepi login` 并授予所需 scope。",
          scope ?? undefined,
        );
      }
      const safeCode = typeof code === "string" && SAFE_TOOL_ERROR_CODES.has(code) ? code : null;
      // Without the field path a rejected call is indistinguishable from a
      // broken one, so the server's own argument diagnostic is carried over.
      const field = result.structuredContent?.field;
      const reason = result.structuredContent?.reason;
      const where = safeCode && typeof field === "string" && SAFE_FIELD.test(field) ? ` ${field}` : "";
      const why = safeCode && typeof reason === "string" && SAFE_REASON.test(reason) ? ` (${reason})` : "";
      throw new CliError(
        safeCode ? `MCP 工具返回错误：${safeCode}${where}${why}。` : "MCP 工具返回错误。",
        EXIT.REMOTE,
        { code: "tool_error" },
      );
    }
    return { structured: result.structuredContent, text };
  } catch (error) {
    if (error instanceof CliError) throw error;
    throw mapMcpError(error, provider);
  } finally {
    await provider.releaseLease();
    await client.close().catch(() => undefined);
  }
}

class CredentialOAuthProvider implements OAuthClientProvider {
  private readonly server: string;
  private readonly store: CredentialStore;
  private lease: FileLock | null = null;
  private expectingRefresh = false;
  private rejectedAccessToken: string | null = null;
  private refreshResponse: Promise<CachedRefreshResponse> | null = null;
  private adoptionOperation: Promise<CredentialRecord | null> | null = null;
  private savedRefreshAccessToken: string | null = null;
  private savedRefreshToken: string | null = null;
  private saveOperation: Promise<void> | null = null;
  private tokenEndpointValue: string | null = null;
  private codeVerifierValue: string | null = null;
  private forbiddenScopeValue: string | null = null;

  constructor(server: string, store: CredentialStore) {
    this.server = server;
    this.store = store;
  }

  get redirectUrl(): string {
    return "http://127.0.0.1/callback";
  }

  get clientMetadata(): OAuthClientMetadata {
    return {
      client_name: "codepi CLI",
      redirect_uris: [this.redirectUrl],
      token_endpoint_auth_method: "none",
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
    };
  }

  noteUnauthorized(accessToken: string | null = null): void {
    this.expectingRefresh = true;
    this.rejectedAccessToken = accessToken;
  }

  noteForbidden(scope: string | null): void {
    this.forbiddenScopeValue = scope;
  }

  takeForbiddenScope(): string | null {
    return this.forbiddenScopeValue;
  }

  async clientInformation(): Promise<OAuthClientInformationMixed | undefined> {
    const record = await this.store.read();
    if (!record?.client) return undefined;
    return {
      client_id: record.client.client_id,
      token_endpoint_auth_method: "none",
      ...(record.client.redirect_uris ? { redirect_uris: record.client.redirect_uris } : {}),
      ...(record.client.issuer ? { issuer: record.client.issuer } : {}),
    };
  }

  async saveClientInformation(information: OAuthClientInformationMixed): Promise<void> {
    await this.withCredentialLock(async () => {
      const record = await this.store.read();
      if (!record) throw authError("本地登录信息不完整，请运行 `codepi login`。");
      await this.store.write({
        ...record,
        client: {
          client_id: information.client_id,
          ...("client_name" in information && typeof information.client_name === "string"
            ? { client_name: information.client_name }
            : {}),
          ...("redirect_uris" in information && Array.isArray(information.redirect_uris)
            ? { redirect_uris: information.redirect_uris.map(String) }
            : {}),
          token_endpoint_auth_method: "none",
          ...("issuer" in information && typeof information.issuer === "string"
            ? { issuer: information.issuer }
            : {}),
        },
      });
    });
  }

  async tokens(): Promise<OAuthTokens | undefined> {
    let record = await this.store.read();
    if (!record?.tokens) return undefined;
    if (record.metadata) this.tokenEndpointValue = record.metadata.token_endpoint;
    if (this.expectingRefresh) {
      this.expectingRefresh = false;
      const observedTokens = record.tokens;
      const rejectedAccessToken = this.rejectedAccessToken;
      this.rejectedAccessToken = null;
      const operation = this.adoptOrHoldRefresh(observedTokens, rejectedAccessToken);
      this.adoptionOperation = operation;
      try {
        record = await operation;
      } finally {
        if (this.adoptionOperation === operation) this.adoptionOperation = null;
      }
      if (!record?.tokens) return undefined;
    } else if (this.adoptionOperation) {
      // Another in-process 401 handler is still deciding whether a different
      // process already rotated the token family. Wait for that decision so
      // this caller cannot replay the old refresh token in the meantime.
      await this.adoptionOperation;
      record = await this.store.read();
      if (!record?.tokens) return undefined;
    }
    return toOAuthTokens(record.tokens);
  }

  private async adoptOrHoldRefresh(
    observedTokens: StoredTokens,
    rejectedAccessToken: string | null,
  ): Promise<CredentialRecord | null> {
    this.lease = await acquireLock(this.store.lockPath);
    const record = await this.store.read();
    if (!record?.tokens) {
      await this.releaseLease();
      return null;
    }
    if (record.metadata) this.tokenEndpointValue = record.metadata.token_endpoint;
    if (!record.tokens.refresh_token) {
      await this.releaseLease();
    } else if (
      (rejectedAccessToken !== null && rejectedAccessToken !== record.tokens.access_token) ||
      !sameStoredTokens(observedTokens, record.tokens)
    ) {
      this.adoptRefreshedTokens(record.tokens);
    }
    return record;
  }

  async saveTokens(tokens: OAuthTokens): Promise<void> {
    if (this.refreshAlreadySaved(tokens)) {
      await this.releaseLease();
      return;
    }
    if (this.saveOperation) {
      await this.saveOperation;
      if (this.refreshAlreadySaved(tokens)) return;
    }
    const operation = this.persistTokens(tokens);
    this.saveOperation = operation;
    try {
      await operation;
    } finally {
      if (this.saveOperation === operation) this.saveOperation = null;
    }
  }

  private async persistTokens(tokens: OAuthTokens): Promise<void> {
    try {
      await this.withCredentialLock(async () => {
        const record = await this.store.read();
        if (!record) throw authError("本地登录信息不完整，请运行 `codepi login`。");
        if (tokens.issuer && record.metadata && tokens.issuer !== record.metadata.issuer) {
          throw new CliError("刷新响应来自未受信任的授权服务器。", EXIT.REMOTE, {
            code: "oauth_issuer_mismatch",
          });
        }
        await this.store.write({
          ...record,
          tokens: fromOAuthTokens(tokens, record.metadata),
        });
        this.savedRefreshAccessToken = tokens.access_token;
        this.savedRefreshToken = tokens.refresh_token ?? null;
      });
    } finally {
      await this.releaseLease();
    }
  }

  private refreshAlreadySaved(tokens: OAuthTokens): boolean {
    return this.savedRefreshAccessToken === tokens.access_token &&
      this.savedRefreshToken === (tokens.refresh_token ?? null);
  }

  private adoptRefreshedTokens(tokens: StoredTokens): void {
    // Another process already completed the rotation; satisfy the SDK refresh
    // step with these tokens instead of posting the new refresh token again.
    this.savedRefreshAccessToken = tokens.access_token;
    this.savedRefreshToken = tokens.refresh_token ?? null;
    const response = new Response(JSON.stringify({
      access_token: tokens.access_token,
      ...(tokens.refresh_token ? { refresh_token: tokens.refresh_token } : {}),
      token_type: tokens.token_type,
      expires_in: Math.max(1, Math.floor((tokens.expires_at - Date.now()) / 1000)),
      scope: tokens.scope,
    }), {
      status: 200,
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": "no-store",
      },
    });
    this.refreshResponse = Promise.resolve({ response });
  }

  async invalidateCredentials(scope: "all" | "client" | "tokens" | "verifier" | "discovery"): Promise<void> {
    try {
      if (scope === "verifier") {
        this.codeVerifierValue = null;
      } else if (scope === "tokens" || scope === "client" || scope === "all") {
        await this.withCredentialLock(async () => {
          const record = await this.store.read();
          if (!record) return;
          if (scope === "tokens") {
            const { tokens: _tokens, ...rest } = record;
            await this.store.write(rest);
            return;
          }
          const { tokens: _tokens, client: _client, ...rest } = record;
          await this.store.write(rest);
        });
      }
    } finally {
      await this.releaseLease();
    }
  }

  async discoveryState(): Promise<OAuthDiscoveryState | undefined> {
    const record = await this.store.read();
    if (!record?.metadata) return undefined;
    const metadata = validatedRecordMetadata(record.metadata, this.server);
    return {
      authorizationServerUrl: metadata.issuer,
      resourceMetadataUrl: protectedResourceMetadataUrl(this.server),
      resourceMetadata: {
        resource: metadata.resource,
        authorization_servers: [metadata.issuer],
        bearer_methods_supported: ["header"],
        ...(metadata.scopes_supported ? { scopes_supported: metadata.scopes_supported } : {}),
      },
      authorizationServerMetadata: {
        issuer: metadata.issuer,
        authorization_endpoint: metadata.authorization_endpoint,
        token_endpoint: metadata.token_endpoint,
        ...(metadata.registration_endpoint
          ? { registration_endpoint: metadata.registration_endpoint }
          : {}),
        ...(metadata.revocation_endpoint ? { revocation_endpoint: metadata.revocation_endpoint } : {}),
        ...(metadata.scopes_supported ? { scopes_supported: metadata.scopes_supported } : {}),
        response_types_supported: ["code"],
        ...(metadata.code_challenge_methods_supported
          ? { code_challenge_methods_supported: metadata.code_challenge_methods_supported }
          : { code_challenge_methods_supported: ["S256"] }),
        token_endpoint_auth_methods_supported: ["none"],
      },
    };
  }

  async saveDiscoveryState(state: OAuthDiscoveryState): Promise<void> {
    if (!state.authorizationServerUrl) return;
    const record = await this.store.read();
    if (!record?.metadata) return;
    validatedRecordMetadata(record.metadata, this.server);
  }

  async validateResourceURL(_serverUrl: string | URL, resource?: string): Promise<URL | undefined> {
    const expected = mcpEndpoint(this.server);
    if (resource === undefined) return new URL(expected);
    if (resource !== expected) throw new Error("OAuth resource 与 CodePi MCP endpoint 不一致");
    return new URL(expected);
  }

  saveCodeVerifier(codeVerifier: string): void {
    this.codeVerifierValue = codeVerifier;
  }

  codeVerifier(): string {
    if (!this.codeVerifierValue) throw authError("OAuth 会话状态缺失，请重新登录。");
    return this.codeVerifierValue;
  }

  async redirectToAuthorization(): Promise<void> {
    await this.releaseLease();
    throw authError("需要重新授权，请运行 `codepi login`。");
  }

  async releaseLease(): Promise<void> {
    const lease = this.lease;
    this.lease = null;
    await lease?.release();
  }

  async transportFetch(input: Parameters<FetchLike>[0], init: RequestInit, baseFetch: FetchLike): Promise<Response> {
    if (this.isRefreshTokenRequest(input, init)) {
      // Never post a refresh while an in-process adoption read is pending: it
      // may be about to prove that another process already rotated the family.
      if (!this.refreshResponse && this.adoptionOperation) await this.adoptionOperation;
      if (this.refreshResponse) {
        const cached = await this.refreshResponse;
        if ("error" in cached) throw cached.error;
        return cached.response.clone();
      }
      const response = baseFetch(input, init);
      this.refreshResponse = response.then(
        value => ({ response: value.clone() }),
        error => ({ error }),
      );
      return response;
    }
    return baseFetch(input, init);
  }

  private isRefreshTokenRequest(input: Parameters<FetchLike>[0], init: RequestInit): boolean {
    if (!this.tokenEndpointValue || (init.method ?? "GET").toUpperCase() !== "POST") return false;
    let url: string;
    try {
      url = new URL(input instanceof Request ? input.url : String(input)).href;
    } catch {
      return false;
    }
    if (url !== new URL(this.tokenEndpointValue).href) return false;
    const body = init.body;
    const encoded = body instanceof URLSearchParams
      ? body.toString()
      : typeof body === "string"
        ? body
        : null;
    return encoded !== null && new URLSearchParams(encoded).get("grant_type") === "refresh_token";
  }

  private async withCredentialLock<T>(operation: () => Promise<T>): Promise<T> {
    if (this.lease) return operation();
    const lock = await acquireLock(this.store.lockPath);
    try {
      return await operation();
    } finally {
      await lock.release();
    }
  }
}

function createTransportFetch(provider: CredentialOAuthProvider, baseFetch: FetchLike): FetchLike {
  return async (input, init = {}) => {
    const timeout = AbortSignal.timeout(45_000);
    const signal = init.signal ? AbortSignal.any([init.signal, timeout]) : timeout;
    const response = await provider.transportFetch(input, {
      ...init,
      redirect: init.redirect ?? "error",
      signal,
    }, baseFetch);
    if (response.status === 401) provider.noteUnauthorized(bearerToken(init.headers));
    if (response.status === 403) {
      const header = response.headers.get("WWW-Authenticate");
      const scope = header?.match(/(?:^|[,\s])scope="([^"]+)"/i)?.[1] ?? null;
      provider.noteForbidden(scope);
      if (header) {
        const headers = new Headers(response.headers);
        headers.delete("WWW-Authenticate");
        return new Response(response.body, {
          status: response.status,
          statusText: response.statusText,
          headers,
        });
      }
    }
    return response;
  };
}

function bearerToken(headers: RequestInit["headers"]): string | null {
  if (!headers) return null;
  const authorization = new Headers(headers).get("authorization");
  if (!authorization?.toLowerCase().startsWith("bearer ")) return null;
  const token = authorization.slice(7).trim();
  return token.length > 0 ? token : null;
}

function toOAuthTokens(tokens: StoredTokens): OAuthTokens {
  return {
    access_token: tokens.access_token,
    ...(tokens.refresh_token ? { refresh_token: tokens.refresh_token } : {}),
    token_type: tokens.token_type,
    scope: tokens.scope,
    expires_in: Math.max(1, Math.floor((tokens.expires_at - Date.now()) / 1000)),
    ...(tokens.issuer ? { issuer: tokens.issuer } : {}),
  };
}

function sameStoredTokens(left: StoredTokens, right: StoredTokens): boolean {
  return left.access_token === right.access_token &&
    left.refresh_token === right.refresh_token &&
    left.token_type === right.token_type &&
    left.scope === right.scope &&
    left.expires_at === right.expires_at &&
    left.issuer === right.issuer;
}

function fromOAuthTokens(
  tokens: OAuthTokens,
  metadata?: AuthorizationMetadataRecord,
): StoredTokens {
  if (tokens.token_type.toLowerCase() !== "bearer") {
    throw new CliError("刷新响应包含不支持的 token type。", EXIT.REMOTE, {
      code: "token_type_invalid",
    });
  }
  return {
    access_token: tokens.access_token,
    ...(tokens.refresh_token ? { refresh_token: tokens.refresh_token } : {}),
    token_type: "Bearer",
    scope: tokens.scope ?? metadata?.scopes_supported?.join(" ") ?? "",
    expires_at: Date.now() + Math.floor((tokens.expires_in ?? 3600) * 1000),
    ...(tokens.issuer ? { issuer: tokens.issuer } : {}),
  };
}

function validatedRecordMetadata(
  metadata: AuthorizationMetadataRecord,
  server: string,
): AuthorizationMetadataRecord {
  assertTrustedUrl(metadata.issuer, server, "issuer");
  assertTrustedUrl(metadata.authorization_endpoint, server, "authorization_endpoint");
  assertTrustedUrl(metadata.token_endpoint, server, "token_endpoint");
  if (metadata.registration_endpoint) {
    assertTrustedUrl(metadata.registration_endpoint, server, "registration_endpoint");
  }
  if (metadata.revocation_endpoint) {
    assertTrustedUrl(metadata.revocation_endpoint, server, "revocation_endpoint");
  }
  return metadata;
}

function mapMcpError(error: unknown, provider: CredentialOAuthProvider): CliError {
  if (error instanceof StreamableHTTPError) {
    if (error.code === 401) return authError();
    if (error.code === 403) {
      const scope = safeScope(provider.takeForbiddenScope());
      return scopeError(
        scope
          ? `权限不足，缺少 scope：${scope}。请运行 \`codepi login --scopes ${scope}\` 重新授权。`
          : "权限不足；请运行 `codepi login` 并授予所需 scope。",
        scope ?? undefined,
      );
    }
    return new CliError(`MCP 服务返回 HTTP ${error.code ?? "错误"}。`, EXIT.REMOTE, {
      code: "mcp_http_error",
    });
  }
  if (error instanceof UnauthorizedError) return authError();
  const message = errorMessage(error);
  if (/\bHTTP\s*401\b|\bstatus\s*401\b/i.test(message)) return authError();
  if (/\bHTTP\s*403\b|\bstatus\s*403\b/i.test(message)) {
    return scopeError("权限不足；请运行 `codepi login` 并授予所需 scope。");
  }
  return new CliError("MCP 请求失败。", EXIT.REMOTE, { code: "mcp_request_failed" });
}

function safeScope(value: string | null): string | null {
  if (!value) return null;
  const scopes = [...new Set(value.split(/\s+/).filter(scope => SAFE_SCOPES.has(scope)))];
  return scopes.length ? scopes.join(" ") : null;
}
