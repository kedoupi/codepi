import { api } from "./app";
import { handleDeskSummary } from "./desk-summary";
import { handleSsoCallback, handleSsoLogin, requireAccount } from "./auth";
import { ssoErrorResponse } from "../../shared/auth/client";
import { isSpaPath, needsSession } from "./gate";

async function fetchStatic(env: Env, url: URL): Promise<Response> {
  let res = await env.ASSETS!.fetch(new Request(url, { method: "GET" }));
  // Pages pretty-URL 会把 /index.html 308 到 /，ASSETS 再取一次即可拿到 HTML
  if (res.status >= 300 && res.status < 400) {
    const location = res.headers.get("Location");
    if (location) {
      res = await env.ASSETS!.fetch(new Request(new URL(location, url), { method: "GET" }));
    }
  }
  return res;
}

async function serveAsset(request: Request, env: Env, pathname: string): Promise<Response> {
  if (!env.ASSETS) {
    return new Response("not found", { status: 404 });
  }
  if (isSpaPath(pathname)) {
    return fetchStatic(env, new URL("/", request.url));
  }
  return fetchStatic(env, new URL(request.url));
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    try {
      const response = await route(request, env, ctx);
      const pathname = new URL(request.url).pathname;
      if (pathname.startsWith("/api/") || pathname.startsWith("/login") || needsSession(pathname)) {
        const secured = new Response(response.body, response);
        secured.headers.set("Cache-Control", "no-store");
        secured.headers.set("Referrer-Policy", "no-referrer");
        return secured;
      }
      return response;
    } catch (error) {
      return ssoErrorResponse(error);
    }
  },
} satisfies ExportedHandler<Env>;

async function route(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  const url = new URL(request.url);
  const { pathname } = url;
  if (pathname === "/api/internal/desk-summary") return handleDeskSummary(request, env);

  if (request.method === "GET" && pathname === "/api/auth/login") return handleSsoLogin(request, env);
  if (request.method === "GET" && pathname === "/api/auth/callback") return handleSsoCallback(request, env);
  if (pathname.startsWith("/api/")) {
    const apiPath = pathname.slice("/api".length) || "/";
    const rewritten = new URL(request.url);
    rewritten.pathname = apiPath;
    return api.fetch(new Request(rewritten, request), env, ctx);
  }

  if (needsSession(pathname)) {
    const account = await requireAccount(env, request);
    if (!account) {
      const login = new URL("/login", request.url);
      login.searchParams.set("next", pathname + url.search);
      return Response.redirect(login.toString(), 302);
    }
  }

  const response = await serveAsset(request, env, pathname);
  if (pathname.startsWith("/previews/") && needsSession(pathname) && response.ok
    && response.headers.get("Content-Type")?.split(";")[0].trim().toLowerCase() === "text/html") {
    return new HTMLRewriter().on("head", {
      element(head) {
        head.append('<script src="/assets/preview-session.js" defer></script>', { html: true });
      },
    }).transform(response);
  }
  return response;
}
