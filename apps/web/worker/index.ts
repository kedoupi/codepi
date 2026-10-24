import { handleDeskRequest, type DeskEnv } from "../server/desk";
import { getDraft, getPost, listPublished, type BlogEnv } from "../server/blog";
import { readSsoSession } from "@kedoupi/shared/auth/client";
import { BlogMcp } from "./blog";

interface Env extends DeskEnv, BlogEnv { ASSETS: Fetcher }
const PUBLIC_CACHE = "public, max-age=60, s-maxage=300";
function responseHeaders(response: Response, cache = PUBLIC_CACHE) { const headers = new Headers(response.headers); headers.set("Cache-Control", cache); return headers; }
function notFound() { return new Response("Not Found", { status: 404, headers: { "Cache-Control": "no-store" } }); }
function redirectLogin(request: Request) { const target = new URL("/api/auth/login", request.url); target.searchParams.set("return", new URL(request.url).pathname); return new Response(null, { status: 302, headers: { Location: target.href, "Cache-Control": "no-store" } }); }
async function blogPage(request: Request, env: Env, slug?: string, preview = false) {
  if (preview) {
    const session = await readSsoSession(request, env);
    if (!session || session.subject !== "kdp-owner" || session.userId !== "desk-owner") return redirectLogin(request);
  }
  const post = slug ? (preview ? await getDraft(env.BLOG, slug) : await getPost(env.BLOG, slug)) : null;
  if (slug && !post) return notFound();
  const listing = slug ? null : await listPublished(env.BLOG, 0, 100);
  const shell = await env.ASSETS.fetch(new Request(new URL("/blog/", request.url), { method: "GET", headers: request.headers }));
  if (!shell.ok) return shell;
  const title = post ? `${post.title} · 博客` : "博客";
  const description = post?.summary ?? "整理完成的公开表达：围绕个人数字空间、健康、投资与内容工作的观察与记录。";
  const escape = (value: string) => value.replace(/[&<>"']/g, character => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[character]!));
  const canonical = new URL(slug ? `/blog/${slug}/` : "/blog/", request.url).href;
  const html = new HTMLRewriter()
    .on("title", { element: el => { el.setInnerContent(title); } })
    .on('meta[name="description"]', { element: el => { el.setAttribute("content", description); } })
    .on('link[rel="canonical"]', { element: el => { el.setAttribute("href", canonical); } })
    .on(".blog-header", { element: el => { if (slug && post) el.remove(); } })
    .on(".blog-empty-pavilion", { element: el => { if ((slug && post) || (listing && listing.posts.length)) el.remove(); } })
    .on("#blog-list-mount", { element: el => {
      if (slug && post) {
        el.setAttribute("class", "blog-article-mount");
        el.setInnerContent(`<article class="personal-article blog-article"><p class="blog-article-meta">${escape(post.tag ?? "思考")}</p><h1>${escape(post.title)}</h1><p class="blog-article-summary">${escape(post.summary)}</p><div class="personal-article-content">${post.body_html}</div></article>`, { html: true });
      } else if (listing && listing.posts.length) {
        el.setInnerContent(listing.posts.map(item => `<a href="/blog/${escape(item.slug)}/" class="blog-card"><div class="blog-card-meta">${item.tag ? `<span class="blog-card-tag">${escape(item.tag)}</span>` : ""}<time>${escape(item.published_at.slice(0,10))}</time></div><h2 class="blog-card-title">${escape(item.title)}</h2><p class="blog-card-summary">${escape(item.summary)}</p><span class="blog-card-action">阅读全文 <span class="arrow">→</span></span></a>`).join(""), { html: true });
      } else return;
      el.removeAttribute("hidden");
    } })
    .transform(shell);
  const headers = responseHeaders(html, preview ? "no-store" : PUBLIC_CACHE);
  if (preview) headers.set("X-Robots-Tag", "noindex, nofollow");
  return new Response(html.body, { status: html.status, headers });
}
async function sitemap(request: Request, env: Env) {
  const { posts } = await listPublished(env.BLOG, 0, 1000);
  const origin = new URL(request.url).origin;
  const body = `<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${posts.map(post => `<url><loc>${origin}/blog/${post.slug}/</loc><lastmod>${post.updated_at}</lastmod></url>`).join("")}</urlset>`;
  return new Response(body, { headers: { "Content-Type": "application/xml; charset=utf-8", "Cache-Control": "no-store" } });
}
export { BlogMcp };
export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname.startsWith("/api/")) return handleDeskRequest(request, env);
    if (url.pathname === "/sitemap-blog.xml" && request.method === "GET") return sitemap(request, env);
    if ((request.method === "GET" || request.method === "HEAD") && (url.pathname === "/blog/" || /^\/blog\/[a-z0-9][a-z0-9-]{0,79}\/$/.test(url.pathname))) {
      const slug = url.pathname === "/blog/" ? undefined : url.pathname.slice(6, -1);
      const cacheUrl = new URL(url);
      cacheUrl.search = "";
      const key = request.method === "GET" ? new Request(cacheUrl.toString(), request) : new Request(cacheUrl.toString(), { method: "GET" });
      const cached = await caches.default.match(key);
      if (cached) return request.method === "HEAD" ? new Response(null, cached) : cached;
      const response = await blogPage(request, env, slug);
      if (request.method === "GET" && response.ok) await caches.default.put(key, response.clone());
      return request.method === "HEAD" ? new Response(null, response) : response;
    }
    if (request.method === "GET" && /^\/blog\/preview\/[a-z0-9][a-z0-9-]{0,79}\/$/.test(url.pathname)) return blogPage(request, env, url.pathname.slice("/blog/preview/".length, -1), true);
    const desk = url.pathname === "/desk" || url.pathname.startsWith("/desk/");
    let response: Response;
    if (desk && url.hostname === "www.codepi.app") { url.hostname = "codepi.app"; url.protocol = "https:"; url.port = ""; if (url.pathname === "/desk") url.pathname = "/desk/"; response = new Response(null, { status: 302, headers: { Location: url.href } }); }
    else response = await env.ASSETS.fetch(request);
    if (!desk) return response;
    const secured = new Response(response.body, response); secured.headers.set("Cache-Control", "no-store"); secured.headers.set("X-Robots-Tag", "noindex, nofollow"); secured.headers.set("Referrer-Policy", "no-referrer"); return secured;
  },
} satisfies ExportedHandler<Env>;
