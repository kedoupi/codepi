import { beginLogin, finishLogin, logoutSso, ssoReady, SsoError } from "@kedoupi/shared/auth/client";
import type { Env } from "./env.ts";
import { authorize, connections, discovery, register, revoke, token } from "./oauth.ts";
import { mcp } from "./protocol.ts";
import { HttpError, json } from "./http.ts";
import { contentSecurityPolicy, page } from "./pages.ts";

function allowedMcpOrigin(origin: string, env: Env) {
  return origin === env.MCP_ORIGIN
    || (env.MCP_ALLOWED_ORIGINS ?? "").split(",").map(value => value.trim()).includes(origin);
}

async function ready(env: Env) {
  if (!env.AUTH_CLIENT_SECRET || env.AUTH_CLIENT_SECRET.length < 32 || !env.AUTH || !env.HEALTH
    || !env.PROJECT || !env.ME || !env.GU) return false;
  return ssoReady(env);
}

async function route(request: Request, env: Env, requestId: string) {
  const url = new URL(request.url);
  // Discovery and callbacks must share one canonical issuer; do not derive it from Host.
  if (env.AUTH_CLIENT_ID !== "mcp" || env.SSO_ENABLED !== "1") {
    throw new HttpError("mcp_not_configured", 503);
  }
  // Wrong-origin probes are client/edge errors: answer 4xx so they never raise a 5xx Workers Issue.
  if (url.origin !== env.MCP_ORIGIN) {
    console.warn(JSON.stringify({ event: "mcp_rejected_origin", request_id: requestId, origin: url.origin }));
    return json({ error: "canonical_origin_required" }, 403);
  }
  const path = url.pathname, method = request.method;
  const bearer = path === "/mcp" || path.startsWith("/.well-known/") || ["/oauth/register", "/oauth/token", "/oauth/revoke"].includes(path);
  const origin = request.headers.get("Origin");
  if (origin && origin !== url.origin && !bearer) throw new HttpError("origin_not_allowed", 403);
  if (path === "/mcp" && origin && !allowedMcpOrigin(origin, env)) throw new HttpError("origin_not_allowed", 403);
  if (method === "OPTIONS" && bearer) {
    return new Response(null, { status: 204, headers: {
      "Access-Control-Allow-Origin": path === "/mcp" ? origin ?? url.origin : "*",
      "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
      "Access-Control-Allow-Headers": "Authorization, Content-Type, MCP-Protocol-Version, MCP-Session-Id",
      "Access-Control-Expose-Headers": "WWW-Authenticate, MCP-Protocol-Version",
    } });
  }
  if (path === "/mcp") return mcp(request, env);
  if (path.startsWith("/.well-known/") && method === "GET") {
    if (["/.well-known/oauth-protected-resource", "/.well-known/oauth-protected-resource/mcp"].includes(path)) return discovery(env, true);
    if (["/.well-known/oauth-authorization-server", "/.well-known/oauth-authorization-server/mcp"].includes(path)) return discovery(env, false);
  }
  if (path === "/oauth/register" && method === "POST") return register(request, env);
  if (path === "/oauth/authorize" && ["GET", "POST"].includes(method)) return authorize(request, env);
  if (path === "/oauth/token" && method === "POST") return token(request, env);
  if (path === "/oauth/revoke" && method === "POST") return revoke(request, env);
  if (path === "/api/auth/login" && method === "GET") return beginLogin(request, env);
  if (path === "/api/auth/callback" && method === "GET") return finishLogin(request, env, { userId: "kdp-owner", ttlSeconds: 30 * 86400 });
  if (path === "/api/auth/logout" && method === "POST") return logoutSso(request, env);
  if (path === "/connections" && ["GET", "POST"].includes(method)) return connections(request, env);
  if (path === "/api/health" && method === "GET") {
    const configured = await ready(env);
    return json({ ok: configured, service: "codepi-mcp", build: env.BUILD_SHA ?? "local" }, configured ? 200 : 503);
  }
  if (path === "/" && method === "GET") return page("CodePi MCP", `<p>在 ChatGPT、Claude 或支持远程 MCP 的 Agent CLI 中添加：</p>
<p><code>${env.MCP_ORIGIN}/mcp</code></p><p>按需授权 Health、项目、个人记忆与投资数据。先读取概览，再深入各领域。连接时使用统一登录并单独授权客户端。</p>
<p><a href="/connections">管理已授权客户端</a> · <a href="https://health.codepi.app/">打开 Health</a></p>`);
  return json({ error: "not_found" }, 404);
}

export default {
  async fetch(request: Request, env: Env) {
    const requestId = crypto.randomUUID();
    let result: Response;
    try { result = await route(request, env, requestId); }
    catch (error) {
      const known = error instanceof HttpError || error instanceof SsoError;
      const code = known ? error.code : "internal_error", status = known ? error.status : 500;
      console.error(JSON.stringify({ event: "mcp_failure", request_id: requestId, code, status }));
      result = json({ error: code, request_id: requestId }, status);
    }
    const headers = new Headers(result.headers);
    headers.set("Cache-Control", "no-store");
    headers.set("X-Request-ID", requestId);
    // Form POSTs need their real Origin for CSRF checks; cross-origin
    // callbacks still receive no referrer under this policy.
    headers.set("Referrer-Policy", "same-origin");
    headers.set("X-Content-Type-Options", "nosniff");
    if (!headers.has("Content-Security-Policy")) headers.set("Content-Security-Policy", contentSecurityPolicy());
    const path = new URL(request.url).pathname, origin = request.headers.get("Origin");
    if (path === "/mcp") {
      headers.set("Vary", "Origin");
      if (origin && allowedMcpOrigin(origin, env)) headers.set("Access-Control-Allow-Origin", origin);
      headers.set("Access-Control-Expose-Headers", "WWW-Authenticate, MCP-Protocol-Version");
    } else if (path !== "/oauth/authorize" && !path.startsWith("/api/auth/")) {
      headers.set("Access-Control-Allow-Origin", "*");
      headers.set("Access-Control-Expose-Headers", "WWW-Authenticate, MCP-Protocol-Version");
    }
    return new Response(result.body, { status: result.status, headers });
  },
} satisfies ExportedHandler<Env>;
