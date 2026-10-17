import { Hono, type Handler } from "hono";
import type { Env } from "./env";
import { handleDeskSummary } from "./routes/desk-summary";
import { allowDevLogin, oauthConfigured } from "./lib/config";
import { API_CONTRACT, RELEASE } from "./lib/version.ts";
import { ssoEnabled } from "./lib/sso";
import {
  handleDevSession,
  handleLogin,
  handleLoginCallback,
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

type AppEnv = {
  Bindings: Env;
  Variables: { executionCtx?: ExecutionContext };
};

// Preserve URL.pathname matching rather than decoding encoded route names.
export const app = new Hono<AppEnv>({ getPath: request => new URL(request.url).pathname });

export function isMcpPath(pathname: string): boolean {
  return pathname === "/mcp" || pathname.startsWith("/.well-known/")
    || pathname.startsWith("/oauth/");
}

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

app.use("*", async (c, next) => {
  // Resolve the ExecutionContext once at the boundary. Hono's c.executionCtx
  // getter throws when no context was passed (module-level fetch without a
  // third argument); handlers must keep their previous "no ctx" path.
  try { c.set("executionCtx", c.executionCtx as ExecutionContext | undefined); }
  catch { c.set("executionCtx", undefined); }
  return next();
});

// Let handler-thrown errors bubble to the entry's single catch, which owns
// logging, requestId and Retry-After. Hono's default onError would flatten
// every ApiError to 500.
app.onError((error) => { throw error; });

// Routes that historically answered 405 from inside their handler stay
// registered with app.all so Hono does not turn them into 404.
const all = (path: string, handler: Handler<AppEnv>) => app.all(path, handler);

all("/api/internal/desk-summary", c => handleDeskSummary(c.req.raw, c.env));
all("/api/auth/login", c => handleLogin(c.req.raw, c.env));
all("/api/auth/callback", c => handleLoginCallback(c.req.raw, c.env));
all("/api/auth/oura/start", c => handleOuraStart(c.req.raw, c.env));
all("/api/auth/oura/callback", c => handleOuraCallback(c.req.raw, c.env));
all("/api/auth/dev/session", c => handleDevSession(c.req.raw, c.env));
all("/api/auth/logout", c => handleLogout(c.req.raw, c.env));
all("/api/me", c => handleMe(c.req.raw, c.env));
all("/api/me/prefs", c => handleMePrefs(c.req.raw, c.env));
all("/api/me/connections", c => handleConnections(c.req.raw, c.env));
all("/mcp", c => handleMcp(c.req.raw, c.env));
all("/.well-known/oauth-protected-resource", c => handleProtectedResourceMetadata(c.req.raw));
all("/.well-known/oauth-protected-resource/mcp", c => handleProtectedResourceMetadata(c.req.raw));
all("/.well-known/oauth-authorization-server", c => handleAuthorizationServerMetadata(c.req.raw));
all("/.well-known/oauth-authorization-server/mcp", c => handleAuthorizationServerMetadata(c.req.raw));
all("/oauth/register", c => handleRegister(c.req.raw, c.env));
all("/oauth/authorize", c => handleAuthorize(c.req.raw, c.env));
all("/oauth/token", c => handleToken(c.req.raw, c.env));
all("/oauth/revoke", c => handleRevoke(c.req.raw, c.env));
all("/api/me/daily", c => handleMeDaily(c.req.raw, c.env));
all("/api/me/sync", c => handleMeDaily(c.req.raw, c.env));
// Hono registers one path per call; the three health-record paths share a
// handler that keeps its own method split. The ExecutionContext arrives on
// the app (resolved once in dispatch): c.executionCtx throws when no context
// was passed, and the handler must keep its old "no ctx" behavior.
all("/api/me/health-records", c => handleHealthRecords(c.req.raw, c.env, c.get("executionCtx")));
all("/api/me/health-records/status", c => handleHealthRecords(c.req.raw, c.env, c.get("executionCtx")));
all("/api/me/health-records/automatic", c => handleHealthRecords(c.req.raw, c.env, c.get("executionCtx")));
all("/api/me/ai", c => handleMeAi(c.req.raw, c.env));
all("/api/me/insights/weekly", c => handleWeeklyInsights(c.req.raw, c.env));
all("/api/me/insights/compare", c => handleCompareInsights(c.req.raw, c.env));
all("/api/health", c => Response.json({
  ok: true,
  service: "codepi-health-api",
  allowDevLogin: allowDevLogin(c.req.raw, c.env),
  oauthConfigured: oauthConfigured(c.env),
  ssoEnabled: ssoEnabled(c.env),
  apiContract: API_CONTRACT,
  release: RELEASE,
  build: c.env.BUILD_SHA ?? "local",
}));

app.notFound(() => Response.json({ error: "not found" }, { status: 404 }));

// Uniform response post-processing, matching the previous dispatcher:
// no-store + request id everywhere, MCP endpoints additionally get a
// wildcard ACAO (Bearer-only, no cookies), then same-origin CORS headers
// fill whatever the route did not set itself.
export async function dispatch(request: Request, env: Env, ctx?: ExecutionContext): Promise<Response> {
  const requestId = crypto.randomUUID();
  const url = new URL(request.url);
  const origin = request.headers.get("Origin");
  // Early returns happen before any header post-processing, exactly as the
  // previous hand-written dispatcher: cross-origin rejects carry the JSON
  // requestId and no no-store/X-Request-ID headers, and OPTIONS responses
  // keep their original header set.
  if (!isMcpPath(url.pathname) && origin && origin !== url.origin && origin !== env.FRONTEND_ORIGIN) {
    return Response.json({ error: "origin_not_allowed", requestId }, { status: 403 });
  }
  if (request.method === "OPTIONS") {
    if (isMcpPath(url.pathname)) return handleMcp(request, env);
    return new Response(null, { status: 204, headers: cors(request, env) });
  }
  const res = await app.fetch(request, env, ctx);
  const headers = new Headers(res.headers);
  headers.set("Cache-Control", "no-store");
  headers.set("X-Request-ID", requestId);
  if (isMcpPath(url.pathname) && origin && !headers.has("Access-Control-Allow-Origin")) {
    headers.set("Access-Control-Allow-Origin", "*");
  }
  for (const [k, v] of Object.entries(cors(request, env))) {
    if (!headers.has(k)) headers.set(k, v);
  }
  return new Response(res.body, { status: res.status, headers });
}
