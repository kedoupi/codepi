import { Hono, type Handler } from "hono";
import { ssoEnabled, ssoErrorResponse } from "@kedoupi/shared/auth/client";
import { authenticated, callbackSso, loginSso, logout, requestOtp, verifyOtp } from "./auth";
import { calendar, syncCalendar } from "./calendar";
import { dashboard, upload } from "./data";
import { handleDeskSummary } from "./desk-summary";
import { json, localDev, ValidationError } from "./lib";
import type { Env } from "./types";
import { exportWorkspace, previewLegacy, previewWorkspace, readWorkspace, saveWorkspace, workspaceHistory, workspaceVersion } from "./workspace";
import { downloadMaterial, listMaterials, uploadMaterial } from "./materials";

type AppEnv = {
  Bindings: Env;
  Variables: { authMode: "sso" | "otp" };
};

// Preserve URL.pathname matching rather than decoding encoded route names.
export const app = new Hono<AppEnv>({ getPath: request => new URL(request.url).pathname });

export function errorResponse(error: unknown): Response {
  if (error instanceof SyntaxError) return json({ error: "JSON 格式无效" }, 400);
  if (error instanceof ValidationError) return json({ error: error.message }, 400);
  return ssoErrorResponse(error);
}

app.onError(errorResponse);
app.notFound(() => new Response("Not found", { status: 404 }));

// Hono dispatches HEAD through GET routes; API HEAD must still reach the
// session gate and API 404 without running GET handlers such as SSO login.
function getApi(path: string, handler: Handler<AppEnv>) {
  app.get(path, (c, next) => c.req.method === "GET" ? handler(c, next) : next());
}

app.all("/api/internal/desk-summary", c => handleDeskSummary(c.req.raw, c.env));

app.use("*", async (c, next) => {
  if (new URL(c.req.url).protocol !== "https:" && !localDev(c.req.raw, c.env)) {
    return json({ error: "需要 HTTPS" }, 403);
  }
  await next();
});

getApi("/api/health", c => json({ ok: true, sso_enabled: ssoEnabled(c.env) }));
getApi("/api/auth/login", c => loginSso(c.req.raw, c.env));
getApi("/api/auth/callback", c => callbackSso(c.req.raw, c.env));

// Ingestion uses its own bearer credential, independently of browser Origin
// and session checks. Only these two PUT routes bypass the browser gate.
app.put("/api/sync", c => upload(c.req.raw, c.env));
app.put("/api/calendar/sync", c => syncCalendar(c.req.raw, c.env));

app.use("*", async (c, next) => {
  if (["POST", "PUT", "PATCH", "DELETE"].includes(c.req.method) &&
    c.req.header("Origin") !== new URL(c.req.url).origin) {
    return json({ error: "请求来源无效" }, 403);
  }
  await next();
});

app.post("/api/auth/request-otp", c => requestOtp(c.req.raw, c.env));
app.post("/api/auth/verify-otp", c => verifyOtp(c.req.raw, c.env));
app.post("/api/auth/logout", c => logout(c.req.raw, c.env));

app.use("*", async (c, next) => {
  // The bare /api path is not part of the existing private API namespace.
  if (c.req.path.startsWith("/api/")) {
    const authMode = ssoEnabled(c.env) ? "sso" : "otp";
    if (!await authenticated(c.req.raw, c.env)) {
      return json({ error: "请先登录", authenticated: false, authMode }, 401);
    }
    c.set("authMode", authMode);
  }
  await next();
});

getApi("/api/me", c => json({ ok: true, authenticated: true, authMode: c.get("authMode") }));
getApi("/api/dashboard", c => dashboard(c.env, c.req.raw));
getApi("/api/calendar", c => calendar(c.env));
getApi("/api/workspace", async c => json(await readWorkspace(c.env)));
getApi("/api/workspace/export", c => exportWorkspace(c.env));
getApi("/api/workspace/history", c => workspaceHistory(c.env));
getApi("/api/workspace/versions/:revision", c => workspaceVersion(c.env, c.req.param("revision") || ""));
app.post("/api/workspace/preview", c => previewWorkspace(c.req.raw));
app.post("/api/workspace/import-legacy", c => previewLegacy(c.env));
app.put("/api/workspace", c => saveWorkspace(c.req.raw, c.env));
getApi("/api/materials", c => listMaterials(c.env));
app.post("/api/materials", c => uploadMaterial(c.req.raw, c.env));
getApi("/api/materials/:id", c => downloadMaterial(c.env, c.req.param("id") || ""));

app.use("*", async (c, next) => {
  if (c.req.path.startsWith("/api/")) return json({ error: "接口不存在" }, 404);
  if (!["GET", "HEAD"].includes(c.req.method)) return new Response("Method not allowed", { status: 405 });
  await next();
});

app.get("/robots.txt", () => new Response("User-agent: *\nDisallow: /\n"));
app.on(["GET", "HEAD"], ["/", "/login"], async c => {
  const origin = new URL(c.req.url).origin;
  if (c.req.path === "/" && !await authenticated(c.req.raw, c.env)) {
    return Response.redirect(`${origin}/login`, 302);
  }
  if (!c.env.ASSETS) return new Response("Assets unavailable", { status: 503 });
  return c.env.ASSETS.fetch(new Request(`${origin}/`, { method: c.req.method }));
});

const PUBLIC_BRAND_ASSETS = new Set([
  "/favicon.ico",
  "/favicon-16.png",
  "/favicon-32.png",
  "/apple-touch-icon.png",
  "/brand/codepi-symbol.png",
  "/brand/codepi-symbol.webp",
  "/brand/codepi-symbol-dark.png",
]);

app.get("*", c => {
  // Only compiled public assets are reachable. Investment data never enters dist/.
  if (/^\/assets\/[a-zA-Z0-9_.-]+\.(?:js|css|svg|woff2)$/.test(c.req.path) || PUBLIC_BRAND_ASSETS.has(c.req.path)) {
    return c.env.ASSETS ? c.env.ASSETS.fetch(c.req.raw) : c.notFound();
  }
  return c.notFound();
});
