import type { Env } from "./types";
import { authenticated, logout, requestOtp, verifyOtp } from "./auth";
import { dashboard, upload } from "./data";
import { calendar, syncCalendar } from "./calendar";
import { json, localDev, secureResponse, ValidationError } from "./lib";

async function route(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const path = url.pathname;
  if (url.protocol !== "https:" && !localDev(request, env)) return json({ error: "需要 HTTPS" }, 403);
  if (path === "/api/health" && request.method === "GET") return json({ ok: true });
  if (path === "/api/sync" && request.method === "PUT") return upload(request, env);
  if (path === "/api/calendar/sync" && request.method === "PUT") return syncCalendar(request, env);
  if (["POST", "PUT", "PATCH", "DELETE"].includes(request.method) &&
    request.headers.get("Origin") !== url.origin) return json({ error: "请求来源无效" }, 403);
  if (path === "/api/auth/request-otp" && request.method === "POST") return requestOtp(request, env);
  if (path === "/api/auth/verify-otp" && request.method === "POST") return verifyOtp(request, env);
  if (path === "/api/auth/logout" && request.method === "POST") return logout(request, env);
  if (path.startsWith("/api/")) {
    if (!await authenticated(request, env)) return json({ error: "请先登录" }, 401);
    if (request.method === "GET" && path === "/api/me") return json({ ok: true });
    if (request.method === "GET" && path === "/api/dashboard") return dashboard(env);
    if (request.method === "GET" && path === "/api/calendar") return calendar(env);
    return json({ error: "接口不存在" }, 404);
  }
  if (!["GET", "HEAD"].includes(request.method)) return new Response("Method not allowed", { status: 405 });
  if (path === "/robots.txt") return new Response("User-agent: *\nDisallow: /\n");
  if (path === "/" || path === "/login") {
    if (path === "/" && !await authenticated(request, env)) return Response.redirect(`${url.origin}/login`, 302);
    if (!env.ASSETS) return new Response("Assets unavailable", { status: 503 });
    return env.ASSETS.fetch(new Request(`${url.origin}/`, { method: request.method }));
  }
  // Only compiled public assets are reachable. Investment data never enters dist/.
  if (/^\/assets\/[a-zA-Z0-9_.-]+\.(?:js|css|svg|woff2)$/.test(path) || path === "/favicon.svg") {
    return env.ASSETS ? env.ASSETS.fetch(request) : new Response("Not found", { status: 404 });
  }
  return new Response("Not found", { status: 404 });
}

export default {
  async fetch(request: Request, env: Env) {
    try {
      return secureResponse(await route(request, env));
    } catch (error) {
      if (error instanceof SyntaxError) return secureResponse(json({ error: "JSON 格式无效" }, 400));
      // Validation errors are safe to return; infrastructure errors reveal no internals.
      if (error instanceof ValidationError) return secureResponse(json({ error: error.message }, 400));
      return secureResponse(json({ error: "服务暂时不可用，请稍后重试" }, 503));
    }
  },
} satisfies ExportedHandler<Env>;
