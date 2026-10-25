import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import type { Env } from "./env.ts";
import { findAccessToken, normalizeScope, type TokenRow } from "./oauth-store.ts";
import { personalToken } from "./personal-tokens.ts";
import { callTool, tools, instructions } from "./modules.ts";
import { MCP_LIMITS } from "@kedoupi/shared/mcp/contract";
import { boundedText, HttpError, json } from "./http.ts";

const MCP_REQUEST_LIMIT = MCP_LIMITS.blogBody * 4;

export async function authenticate(request: Request, env: Env): Promise<TokenRow | null> {
  const bearer = request.headers.get("Authorization")?.match(/^Bearer ([A-Za-z0-9_-]+)$/i)?.[1];
  if (!bearer) return null;
  if (/^kdp_pat_[A-Za-z0-9_-]{43}$/.test(bearer)) return personalToken(env, bearer);
  return /^[A-Za-z0-9_-]{43}$/.test(bearer) ? findAccessToken(env, bearer) : null;
}

export async function mcp(request: Request, env: Env) {
  const grant = await authenticate(request, env);
  if (!grant || grant.user_id !== "kdp-owner") {
    const response = json({ error: "invalid_token" }, 401);
    response.headers.set("WWW-Authenticate",
      `Bearer resource_metadata="${env.MCP_ORIGIN}/.well-known/oauth-protected-resource/mcp", error="invalid_token"`);
    return response;
  }
  if (!normalizeScope(grant.scope)) return json({ error: "insufficient_scope" }, 403);
  // Stateless transport has no standalone SSE stream or session to delete.
  if (request.method !== "POST") return new Response(null, { status: 405, headers: { Allow: "POST" } });
  if (!request.headers.get("Content-Type")?.toLowerCase().startsWith("application/json")) {
    return json({ error: "unsupported_media_type" }, 415);
  }
  const body = await boundedText(request, MCP_REQUEST_LIMIT);
  // Replies are always plain JSON (enableJsonResponse), so a client that only lists
  // application/json or */* is served the same response instead of an SDK 406.
  const headers = new Headers(request.headers);
  const accept = headers.get("Accept") ?? "";
  if (!accept.includes("application/json") || !accept.includes("text/event-stream")) {
    headers.set("Accept", "application/json, text/event-stream");
  }
  const incoming = new Request(request.url, { method: "POST", headers, body });
  const server = new Server({ name: "codepi", version: "1.0.0" }, {
    capabilities: { tools: {} },
    instructions: instructions(grant.scope),
  });
  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: tools(grant.scope) }));
  server.setRequestHandler(CallToolRequestSchema, async ({ params }) => {
    const started = Date.now();
    const requestId = crypto.randomUUID();
    let code: string | null = null;
    try {
      const data = await callTool(env, { subject: grant.user_id, client: grant.client_id,
        clientName: grant.client_name?.slice(0, 80), scope: grant.scope }, params.name, params.arguments ?? {});
      return { content: [{ type: "text", text: JSON.stringify(data) }], structuredContent: data };
    } catch (error) {
      code = error instanceof HttpError ? error.code : "source_unavailable";
      const data = { error: code, request_id: requestId };
      return { isError: true, content: [{ type: "text", text: JSON.stringify(data) }], structuredContent: data };
    } finally {
      console.log(JSON.stringify({ event: "mcp_tool", tool: tools(grant.scope).some(t => t.name === params.name) ? params.name : "unknown",
        request_id: requestId, duration_ms: Date.now() - started, code }));
    }
  });
  const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
  await server.connect(transport);
  try { return await transport.handleRequest(incoming); }
  finally { await server.close(); }
}
