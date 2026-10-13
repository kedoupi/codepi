/**
 * Remote MCP endpoint (Streamable HTTP, JSON-RPC 2.0).
 *
 * Auth is a bearer token issued by our own OAuth server (see mcp-oauth.ts).
 * Requests without a valid token get 401 + `resource_metadata` so MCP clients
 * can discover the authorization server and start the consent flow.
 */
import type { Env } from "../env";
import { findAccessToken, MCP_SCOPE } from "../lib/mcp-store.ts";
import { runTool, TOOLS } from "../lib/mcp-tools.ts";

const SUPPORTED_PROTOCOL_VERSIONS = ["2025-06-18", "2025-03-26", "2024-11-05"];
const LATEST_PROTOCOL_VERSION = SUPPORTED_PROTOCOL_VERSIONS[0];

const SERVER_INFO = {
  name: "oura-personal-health",
  title: "Oura personal health",
  version: "1.0.0",
};

const INSTRUCTIONS =
  "Read-only access to one person's Oura ring data (sleep, readiness, activity). " +
  "Scores are Oura's official values; missing metrics are null, never estimated. " +
  "Always state the date range you used, and mention coverage when days are missing. " +
  "This is wellness data, not medical advice: do not diagnose, and say so if asked.";

function jsonRpcResult(id: unknown, result: unknown): Response {
  return Response.json({ jsonrpc: "2.0", id: id ?? null, result });
}

function jsonRpcError(id: unknown, code: number, message: string, data?: unknown): Response {
  return Response.json({
    jsonrpc: "2.0",
    id: id ?? null,
    error: { code, message, ...(data === undefined ? {} : { data }) },
  });
}

function resourceMetadataUrl(request: Request): string {
  return new URL("/.well-known/oauth-protected-resource", request.url).toString();
}

function unauthorized(request: Request, detail: string): Response {
  return Response.json(
    { error: "invalid_token", error_description: detail },
    {
      status: 401,
      headers: {
        "WWW-Authenticate":
          `Bearer realm="oura-mcp", error="invalid_token", resource_metadata="${resourceMetadataUrl(request)}"`,
        "Access-Control-Expose-Headers": "WWW-Authenticate",
      },
    },
  );
}

function bearerToken(request: Request): string | null {
  const header = request.headers.get("Authorization") ?? "";
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  if (match) return match[1].trim();
  return new URL(request.url).searchParams.get("access_token");
}

/** POST /mcp — the single JSON-RPC entry point. */
export async function handleMcp(request: Request, env: Env): Promise<Response> {
  if (request.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
        "Access-Control-Allow-Headers": "Authorization, Content-Type, MCP-Protocol-Version, MCP-Session-Id",
        "Access-Control-Max-Age": "86400",
      },
    });
  }

  if (request.method === "GET") {
    // We answer with plain JSON only, so there is no server-initiated stream.
    return Response.json(
      { error: "method_not_allowed", error_description: "This server does not offer an SSE stream; POST JSON-RPC to this URL." },
      { status: 405, headers: { Allow: "POST, OPTIONS" } },
    );
  }
  if (request.method !== "POST") {
    return Response.json({ error: "method_not_allowed" }, { status: 405, headers: { Allow: "POST, OPTIONS" } });
  }

  const token = bearerToken(request);
  if (!token) return unauthorized(request, "Missing bearer token");
  const grant = await findAccessToken(env, token);
  if (!grant) return unauthorized(request, "Unknown or expired token");
  if (!grant.scope.split(" ").includes(MCP_SCOPE)) {
    return Response.json({ error: "insufficient_scope", scope: MCP_SCOPE }, { status: 403 });
  }

  let payload: {
    jsonrpc?: string;
    id?: unknown;
    method?: string;
    params?: Record<string, unknown>;
  };
  try {
    payload = (await request.json()) as typeof payload;
  } catch {
    return jsonRpcError(null, -32700, "Parse error");
  }
  if (!payload || typeof payload.method !== "string") {
    return jsonRpcError(payload?.id ?? null, -32600, "Invalid Request");
  }

  const { id, method, params } = payload;

  // Notifications carry no id and expect 202 with an empty body.
  if (id === undefined || id === null) {
    return new Response(null, { status: 202 });
  }

  switch (method) {
    case "initialize": {
      const requested = String((params?.protocolVersion as string) ?? "");
      const protocolVersion = SUPPORTED_PROTOCOL_VERSIONS.includes(requested)
        ? requested
        : LATEST_PROTOCOL_VERSION;
      return jsonRpcResult(id, {
        protocolVersion,
        capabilities: { tools: { listChanged: false } },
        serverInfo: SERVER_INFO,
        instructions: INSTRUCTIONS,
      });
    }
    case "ping":
      return jsonRpcResult(id, {});
    case "tools/list":
      return jsonRpcResult(id, {
        tools: TOOLS.map(tool => ({
          name: tool.name,
          title: tool.title,
          description: tool.description,
          inputSchema: tool.inputSchema,
        })),
      });
    case "tools/call": {
      const name = params?.name;
      if (typeof name !== "string") {
        return jsonRpcError(id, -32602, "Invalid params: 'name' is required");
      }
      const args = (params?.arguments ?? {}) as Record<string, unknown>;
      if (typeof args !== "object" || args === null || Array.isArray(args)) {
        return jsonRpcError(id, -32602, "Invalid params: 'arguments' must be an object");
      }
      const result = await runTool(env, request, grant.user_id, name, args);
      return jsonRpcResult(id, result);
    }
    default:
      return jsonRpcError(id, -32601, `Method not found: ${method}`);
  }
}
