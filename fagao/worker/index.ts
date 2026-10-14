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

export const FAGAO_ORIGIN = "https://fagao.kdp.cool";
const LEGACY_HOSTS = new Set(["gzh-preview.kdp.cool"]);

/** 旧 gzh-preview 主机：页面链接 301 到 fagao；/api/* 不跳（POST 不能安全重定向），由同一 Worker 兼容处理。 */
export function legacyRedirect(url: URL): string | null {
  if (!LEGACY_HOSTS.has(url.hostname)) return null;
  if (url.pathname.startsWith("/api/")) return null;
  if (url.pathname.startsWith("/p/")) return `${FAGAO_ORIGIN}${url.pathname}`;
  const m = /^\/([a-z0-9][a-z0-9-]{0,63})(?:\/.*)?$/.exec(url.pathname);
  if (!m || ["index.html", "article.html", "app.js", "styles.css", "board.json"].includes(m[1]!)) {
    return `${FAGAO_ORIGIN}/`;
  }
  return `${FAGAO_ORIGIN}/p/${m[1]}/`;
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    const { pathname } = url;

    const legacy = legacyRedirect(url);
    if (legacy) return Response.redirect(legacy, 301);

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
