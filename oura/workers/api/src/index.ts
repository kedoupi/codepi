import type { Env } from "./env";
import { runAutomaticSync } from "./lib/auto-sync.ts";
import { allowDevLogin, oauthConfigured } from "./lib/config";
import { normalizeApiError, storageQuotaResetAt } from "./lib/errors.ts";
import { API_CONTRACT, RELEASE } from "./lib/version.ts";
import {
  handleDevSession,
  handleLogout,
  handleOuraCallback,
  handleOuraStart,
} from "./routes/auth";
import { handleMeAi } from "./routes/ai";
import { handleMeDaily } from "./routes/daily";
import { handleHealthRecords } from "./routes/health-records";
import { handleCompareInsights, handleWeeklyInsights } from "./routes/insights";
import { handleMe } from "./routes/me";
import { handleMePrefs } from "./routes/prefs";
import { handleMcp } from "./routes/mcp";
import {
  handleAuthorize,
  handleAuthorizationServerMetadata,
  handleConnections,
  handleProtectedResourceMetadata,
  handleRegister,
  handleRevoke,
  handleToken,
} from "./routes/mcp-oauth";

function cors(req: Request, env: Env): HeadersInit {
  const origin = req.headers.get("Origin");
  const allowed = origin === new URL(req.url).origin || origin === env.FRONTEND_ORIGIN;
  if (!origin || !allowed) return { Vary: "Origin" };
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "GET, POST, PUT, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Allow-Credentials": "true",
    Vary: "Origin",
  };
}

export default {
  async scheduled(controller: ScheduledController, env: Env): Promise<void> {
    await runAutomaticSync(env, controller.scheduledTime, controller.cron);
  },
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const requestId = crypto.randomUUID();
    const origin = request.headers.get("Origin");
    const isMcpPath = url.pathname === "/mcp" || url.pathname.startsWith("/.well-known/")
      || url.pathname.startsWith("/oauth/");
    // Bearer-token OAuth endpoints accept cross-origin API clients. The
    // authorization screen itself is cookie-backed, so consent POSTs are
    // checked again in mcp-oauth.ts before a code can be issued.
    if (!isMcpPath && origin && origin !== url.origin && origin !== env.FRONTEND_ORIGIN) {
      return Response.json({ error: "origin_not_allowed", requestId }, { status: 403 });
    }

    if (request.method === "OPTIONS") {
      if (isMcpPath) return handleMcp(request, env);
      return new Response(null, { status: 204, headers: cors(request, env) });
    }

    try {
      let res: Response;
      switch (url.pathname) {
        case "/api/auth/oura/start":
          res = await handleOuraStart(request, env);
          break;
        case "/api/auth/oura/callback":
          res = await handleOuraCallback(request, env);
          break;
        case "/api/auth/dev/session":
          res = await handleDevSession(request, env);
          break;
        case "/api/auth/logout":
          res = await handleLogout(request, env);
          break;
        case "/api/me":
          res = await handleMe(request, env);
          break;
        case "/api/me/prefs":
          res = await handleMePrefs(request, env);
          break;
        case "/api/me/connections":
          res = await handleConnections(request, env);
          break;
        case "/mcp":
          res = await handleMcp(request, env);
          break;
        case "/.well-known/oauth-protected-resource":
        case "/.well-known/oauth-protected-resource/mcp":
          res = handleProtectedResourceMetadata(request);
          break;
        case "/.well-known/oauth-authorization-server":
        case "/.well-known/oauth-authorization-server/mcp":
          res = handleAuthorizationServerMetadata(request);
          break;
        case "/oauth/register":
          res = await handleRegister(request, env);
          break;
        case "/oauth/authorize":
          res = await handleAuthorize(request, env);
          break;
        case "/oauth/token":
          res = await handleToken(request, env);
          break;
        case "/oauth/revoke":
          res = await handleRevoke(request, env);
          break;
        case "/api/me/daily":
        case "/api/me/sync":
          res = await handleMeDaily(request, env);
          break;
        case "/api/me/health-records":
        case "/api/me/health-records/status":
        case "/api/me/health-records/automatic":
          res = await handleHealthRecords(request, env);
          break;
        case "/api/me/ai":
          res = await handleMeAi(request, env);
          break;
        case "/api/me/insights/weekly":
          res = await handleWeeklyInsights(request, env);
          break;
        case "/api/me/insights/compare":
          res = await handleCompareInsights(request, env);
          break;
        case "/api/health":
          res = Response.json({
            ok: true,
            service: "oura-kdp-api",
            allowDevLogin: allowDevLogin(request, env),
            oauthConfigured: oauthConfigured(env),
            apiContract: API_CONTRACT,
            release: RELEASE,
            build: env.BUILD_SHA ?? "local",
          });
          break;
        default:
          res = Response.json({ error: "not found" }, { status: 404 });
      }

      const headers = new Headers(res.headers);
      headers.set("Cache-Control", "no-store");
      headers.set("X-Request-ID", requestId);
      // Bearer-authenticated connector endpoints are safe to expose to any
      // origin (no cookies involved), so browser-based MCP clients work.
      if (isMcpPath && origin && !headers.has("Access-Control-Allow-Origin")) {
        headers.set("Access-Control-Allow-Origin", "*");
      }
      for (const [k, v] of Object.entries(cors(request, env))) {
        if (!headers.has(k)) headers.set(k, v);
      }
      return new Response(res.body, { status: res.status, headers });
    } catch (err) {
      const error = normalizeApiError(err);
      const retryAt = error.code === "storage_write_quota_exceeded" ? storageQuotaResetAt() : null;
      // Keep operational evidence without health data, credentials, query
      // parameters or raw provider/database exception messages.
      console.error(JSON.stringify({ event: "api_failure", requestId, route: url.pathname, code: error.code, status: error.status }));
      return Response.json(
        { error: error.code, requestId, ...(retryAt ? { retryAt } : {}) },
        { status: error.status, headers: { ...cors(request, env), "Cache-Control": "no-store", "X-Request-ID": requestId,
          ...(retryAt ? { "Retry-After": String(Math.max(1, Math.ceil((Date.parse(retryAt) - Date.now()) / 1000))) } : {}),
        } },
      );
    }
  },
} satisfies ExportedHandler<Env>;
