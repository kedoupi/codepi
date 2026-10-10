import { api } from "./app";
import { requireAccount } from "./auth";
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
    const url = new URL(request.url);
    const { pathname } = url;

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
        login.searchParams.set("next", pathname);
        return Response.redirect(login.toString(), 302);
      }
    }

    return serveAsset(request, env, pathname);
  },
} satisfies ExportedHandler<Env>;
