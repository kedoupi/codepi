import { handleDeskRequest, type DeskEnv } from "../server/desk";
import { getDraft, getPost, listPublished, listCategories, parseTags, parseSources, readingMinutes, postNeighbors, type BlogEnv, type Post } from "../server/blog";
import { getMedia, handleMediaRequest, mediaUrl } from "../server/media";
import { readSsoSession } from "@kedoupi/shared/auth/client";
import { BlogMcp, BlogMediaBackup } from "./blog";

interface Env extends DeskEnv, BlogEnv { ASSETS: Fetcher }
const PUBLIC_CACHE = "no-store";
const PAGE_SIZE = 12;
const escape = (value: string) => value.replace(/[&<>"']/g, character => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[character]!));
function responseHeaders(response: Response, cache = PUBLIC_CACHE) { const headers = new Headers(response.headers); headers.set("Cache-Control", cache); return headers; }
function notFound() { return new Response("Not Found", { status: 404, headers: { "Cache-Control": "no-store" } }); }
function redirectLogin(request: Request) { const target = new URL("/api/auth/login", request.url); target.searchParams.set("return", new URL(request.url).pathname); return new Response(null, { status: 302, headers: { Location: target.href, "Cache-Control": "no-store" } }); }
function dateMarkup(value: string, label: string) { return `<span>${label} <time datetime="${escape(value)}">${escape(value.slice(0, 10))}</time></span>`; }
type ListFilter = { category?: string; tag?: string; series?: string };
function tocMarkup(html: string) {
  const headings = [...html.matchAll(/<h([23]) id="(h-\d+)">([\s\S]*?)<\/h\1>/g)].map(match => ({ depth: Number(match[1]), id: match[2], text: match[3].replace(/<[^>]+>/g, "") }));
  if (headings.length < 2) return "";
  return `<nav class="blog-toc" aria-label="文章目录"><p class="blog-toc-title">目录</p><ul>${headings.map(heading => `<li class="blog-toc-h${heading.depth}"><a href="#${heading.id}">${escape(heading.text)}</a></li>`).join("")}</ul></nav>`;
}
function sourcesMarkup(post: { sources: string | null }) {
  const sources = parseSources(post.sources);
  if (!sources.length) return "";
  return `<section class="blog-article-sources"><h2>资料来源</h2><ul>${sources.map(source => `<li><a href="${escape(source.url)}" rel="noopener noreferrer">${escape(source.title)}</a></li>`).join("")}</ul></section>`;
}
async function blogPage(request: Request, env: Env, slug?: string, preview = false, pathFilter: ListFilter = {}) {
  if (preview) {
    const session = await readSsoSession(request, env);
    if (!session || session.subject !== "kdp-owner" || session.userId !== "desk-owner") return redirectLogin(request);
  }
  const post = slug ? (preview ? await getDraft(env.BLOG, slug) : await getPost(env.BLOG, slug)) : null;
  if (slug && !post) return notFound();
  const url = new URL(request.url);
  const filter: ListFilter = slug ? {} : { ...pathFilter };
  if (!slug && !pathFilter.tag && !pathFilter.series) {
    const category = url.searchParams.get("category");
    if (category) filter.category = category;
  }
  const rawPage = url.searchParams.get("page") ?? "1";
  const page = /^[1-9]\d{0,6}$/.test(rawPage) ? Number(rawPage) : 1;
  const listing = slug ? null : await listPublished(env.BLOG, (page - 1) * PAGE_SIZE, PAGE_SIZE, filter);
  if (listing && page > 1 && !listing.posts.length) return notFound();
  const categories = await listCategories(env.BLOG);
  const categoryName = (value: string | null) => value ? categories.find(item => item.slug === value)?.name ?? value : "";
  const coverImage = async (item: { cover_media_id: string | null }, className: string, eager = false) => {
    if (!item.cover_media_id) return "";
    const media = await getMedia(env, item.cover_media_id);
    if (!media) return "";
    return `<img class="${className}" src="${escape(mediaUrl(item.cover_media_id))}" alt="${escape(media.alt ?? "")}"${media.width && media.height ? ` width="${media.width}" height="${media.height}"` : ""} loading="${eager ? "eager" : "lazy"}" decoding="async"${eager ? ' fetchpriority="high"' : ""}>`;
  };
  const cover = post ? await coverImage(post, "blog-article-cover", true) : "";
  const cards = listing ? await Promise.all(listing.posts.map(async item => {
    const tags = parseTags(item.tags).slice(0, 3).map(tag => `<span class="blog-card-label">${escape(tag)}</span>`).join("");
    const minutes = readingMinutes(Number((item as { body_chars?: number }).body_chars ?? 0));
    return `<a href="/blog/${escape(item.slug)}/" class="blog-card">${await coverImage(item, "blog-card-cover")}<div class="blog-card-content"><div class="blog-card-meta">${item.category ? `<span class="blog-card-tag">${escape(categoryName(item.category))}</span>` : item.tag ? `<span class="blog-card-tag">${escape(item.tag)}</span>` : ""}<time datetime="${escape(item.published_at)}">${escape(item.published_at.slice(0, 10))}</time><span>约 ${minutes} 分钟</span></div><h2 class="blog-card-title">${escape(item.title)}</h2><p class="blog-card-summary">${escape(item.summary)}</p>${tags ? `<div class="blog-card-labels">${tags}</div>` : ""}<span class="blog-card-action">阅读全文</span></div></a>`;
  })) : [];
  const basePath = filter.tag ? `/blog/tag/${encodeURIComponent(filter.tag)}/` : filter.series ? `/blog/series/${encodeURIComponent(filter.series)}/` : "/blog/";
  const href = (target: number) => {
    const params = new URLSearchParams();
    if (target > 1) params.set("page", String(target));
    if (filter.category) params.set("category", filter.category);
    const query = params.toString();
    return `${basePath}${query ? `?${query}` : ""}`;
  };
  const pagination = listing && listing.total > PAGE_SIZE ? `<nav class="blog-pagination" aria-label="文章分页">${page > 1 ? `<a class="kdp-button kdp-button--secondary" rel="prev" href="${href(page - 1)}">上一页</a>` : "<span></span>"}<span>第 ${page} / ${Math.ceil(listing.total / PAGE_SIZE)} 页</span>${listing.next_offset !== null ? `<a class="kdp-button kdp-button--secondary" rel="next" href="${href(page + 1)}">下一页</a>` : "<span></span>"}</nav>` : "";
  const filterNav = listing ? `<nav class="blog-filter" aria-label="按分类筛选"><a href="/blog/"${!filter.category && !filter.tag && !filter.series ? ' aria-current="true"' : ""}>全部</a>${categories.map(item => `<a href="/blog/?category=${encodeURIComponent(item.slug)}"${filter.category === item.slug ? ' aria-current="true"' : ""}>${escape(item.name)}<span class="blog-filter-count">${item.published}</span></a>`).join("")}</nav>` : "";
  const filterTitle = filter.tag ? `标签：${filter.tag}` : filter.series ? `系列：${filter.series}` : filter.category ? `分类：${categoryName(filter.category) || filter.category}` : "";
  const neighbors = post && !preview ? await postNeighbors(env.BLOG, post as Post) : null;
  const shell = await env.ASSETS.fetch(new Request(new URL("/blog/", request.url), { method: "GET", headers: request.headers }));
  if (!shell.ok) return shell;
  const title = post ? `${post.title} · 博客` : filterTitle ? `${filterTitle} · 博客` : page > 1 ? `博客 · 第 ${page} 页` : "博客";
  const description = post?.summary ?? "整理完成的公开表达：围绕个人数字空间、健康、投资与内容工作的观察与记录。";
  const canonical = new URL(preview ? `/blog/preview/${slug}/` : slug ? `/blog/${slug}/` : href(page), request.url).href;
  const imageUrl = post?.cover_media_id && cover ? new URL(mediaUrl(post.cover_media_id), request.url).href : null;
  const html = new HTMLRewriter()
    .on("title", { element: el => { el.setInnerContent(title); } })
    .on('meta[name="description"], meta[property="og:description"], meta[name="twitter:description"]', { element: el => { el.setAttribute("content", description); } })
    .on('meta[property="og:title"], meta[name="twitter:title"]', { element: el => { el.setAttribute("content", title); } })
    .on('meta[property="og:url"]', { element: el => { el.setAttribute("content", canonical); } })
    .on('meta[property="og:type"]', { element: el => { el.setAttribute("content", post ? "article" : "website"); } })
    .on('meta[name="twitter:card"]', { element: el => { el.setAttribute("content", imageUrl && !preview ? "summary_large_image" : "summary"); } })
    .on('meta[name="robots"]', { element: el => { if (preview) el.remove(); } })
    .on('link[rel="canonical"]', { element: el => { el.setAttribute("href", canonical); } })
    .on('script[type="application/ld+json"]', { element: el => { el.remove(); } })
    .on("head", { element: el => {
      if (preview) el.append('<meta name="robots" content="noindex, nofollow">', { html: true });
      else el.append(`<link rel="alternate" type="application/rss+xml" title="kedoupi 博客 RSS" href="${new URL("/blog/rss.xml", request.url).href}">`, { html: true });
      if (post && !preview) el.append(`<meta property="article:published_time" content="${escape(post.published_at!)}"><meta property="article:modified_time" content="${escape(post.updated_at)}">${imageUrl ? `<meta property="og:image" content="${escape(imageUrl)}"><meta name="twitter:image" content="${escape(imageUrl)}">` : ""}`, { html: true });
    } })
    .on(".blog-header", { element: el => { if (post) el.remove(); } })
    .on(".blog-empty-pavilion", { element: el => { if (post || listing?.posts.length) el.remove(); } })
    .on("#blog-list-mount", { element: el => {
      if (post) {
        el.setAttribute("class", "blog-article-mount");
        el.setAttribute("aria-label", preview ? "草稿预览" : "文章");
        const articleTags = parseTags(post.tags).map(tag => `<a class="blog-card-label" href="/blog/tag/${encodeURIComponent(tag)}/">${escape(tag)}</a>`).join("");
        const articleMeta = `${post.category ? `<a class="blog-card-tag" href="/blog/?category=${encodeURIComponent(post.category)}">${escape(categoryName(post.category) || post.category)}</a>` : post.tag ? `<span class="blog-card-tag">${escape(post.tag)}</span>` : ""}${preview ? dateMarkup(post.updated_at, "草稿更新于") : dateMarkup(post.published_at!, "发布于")}${!preview && post.updated_at.slice(0, 10) !== post.published_at!.slice(0, 10) ? dateMarkup(post.updated_at, "更新于") : ""}<span>约 ${readingMinutes(post.body_markdown?.length ?? 0)} 分钟</span>`;
        const neighborNav = neighbors && (neighbors.previous || neighbors.next) ? `<nav class="blog-article-nav" aria-label="相邻文章">${neighbors.previous ? `<a rel="prev" href="/blog/${escape(neighbors.previous.slug)}/">上一篇：${escape(neighbors.previous.title)}</a>` : "<span></span>"}${neighbors.next ? `<a rel="next" href="/blog/${escape(neighbors.next.slug)}/">下一篇：${escape(neighbors.next.title)}</a>` : "<span></span>"}</nav>` : "";
        el.setInnerContent(`<article class="personal-article blog-article"><a class="blog-back" href="/blog/">返回博客</a>${preview ? '<aside class="blog-preview-notice" role="note">草稿预览，仅本人可见。发布更新前，公开文章保留当前版本。</aside>' : ""}<header class="blog-article-header"><div class="blog-article-meta">${articleMeta}</div><h1>${escape(post.title)}</h1>${post.summary ? `<p class="blog-article-summary">${escape(post.summary)}</p>` : ""}</header>${cover}${tocMarkup(post.body_html)}<div class="personal-article-content">${post.body_html}</div>${sourcesMarkup(post)}<footer class="blog-article-footer">${articleTags ? `<div class="blog-article-tags">${articleTags}</div>` : ""}${post.series ? `<p class="blog-article-series">系列：<a href="/blog/series/${encodeURIComponent(post.series)}/">${escape(post.series)}</a></p>` : ""}<p class="blog-ai-note">本文由 AI 协作撰写，经本人审核后发布。</p>${neighborNav}<a class="blog-back" href="/blog/">浏览更多文章</a></footer></article>`, { html: true });
      } else if (listing?.posts.length) {
        el.setAttribute("class", "blog-list-section");
        el.setInnerContent(`${filterNav}${filterTitle ? `<p class="blog-list-count">${escape(filterTitle)} · 共 ${listing.total} 篇</p>` : `<p class="blog-list-count">共 ${listing.total} 篇文章</p>`}<div class="blog-list">${cards.join("")}</div>${pagination}`, { html: true });
      } else return;
      el.removeAttribute("hidden");
    } })
    .transform(shell);
  const headers = responseHeaders(html, preview || !slug ? "no-store" : PUBLIC_CACHE);
  if (preview) { headers.set("X-Robots-Tag", "noindex, nofollow"); headers.set("Referrer-Policy", "no-referrer"); }
  return new Response(html.body, { status: html.status, headers });
}
async function rss(request: Request, env: Env) {
  const { posts } = await listPublished(env.BLOG, 0, 50);
  const origin = new URL(request.url).origin;
  const items = posts.map(post => `<item><title>${escape(post.title)}</title><link>${origin}/blog/${escape(post.slug)}/</link><guid isPermaLink="true">${origin}/blog/${escape(post.slug)}/</guid><pubDate>${new Date(post.published_at).toUTCString()}</pubDate>${post.category ? `<category>${escape(post.category)}</category>` : ""}<description>${escape(post.summary)}</description></item>`).join("");
  const body = `<?xml version="1.0" encoding="UTF-8"?><rss version="2.0"><channel><title>kedoupi 博客</title><link>${origin}/blog/</link><description>整理完成的公开表达：围绕个人数字空间、健康、投资与内容工作的观察与记录。</description><language>zh-CN</language>${items}</channel></rss>`;
  return new Response(body, { headers: { "Content-Type": "application/rss+xml; charset=utf-8", "Cache-Control": "no-store" } });
}
async function sitemap(request: Request, env: Env) {
  const { posts } = await listPublished(env.BLOG, 0, 1000);
  const origin = new URL(request.url).origin;
  const body = `<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${posts.map(post => `<url><loc>${origin}/blog/${post.slug}/</loc><lastmod>${post.updated_at}</lastmod></url>`).join("")}</urlset>`;
  return new Response(body, { headers: { "Content-Type": "application/xml; charset=utf-8", "Cache-Control": "no-store" } });
}
export { BlogMcp, BlogMediaBackup };
export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const media = await handleMediaRequest(request, env);
    if (media) return media;
    if (url.pathname.startsWith("/api/")) return handleDeskRequest(request, env);
    if (url.pathname === "/sitemap-blog.xml" && request.method === "GET") return sitemap(request, env);
    if (url.pathname === "/blog/rss.xml" && (request.method === "GET" || request.method === "HEAD")) {
      const response = await rss(request, env);
      return request.method === "HEAD" ? new Response(null, response) : response;
    }
    const taxonomy = url.pathname.match(/^\/blog\/(tag|series)\/([^/]+)\/$/);
    if ((request.method === "GET" || request.method === "HEAD") && taxonomy) {
      const value = decodeURIComponent(taxonomy[2]);
      if (value.length > 40) return notFound();
      const response = await blogPage(request, env, undefined, false, taxonomy[1] === "tag" ? { tag: value } : { series: value });
      return request.method === "HEAD" ? new Response(null, response) : response;
    }
    if ((request.method === "GET" || request.method === "HEAD") && (url.pathname === "/blog/" || /^\/blog\/[a-z0-9][a-z0-9-]{0,79}\/$/.test(url.pathname))) {
      const slug = url.pathname === "/blog/" ? undefined : url.pathname.slice(6, -1);
      if (!slug) { const response = await blogPage(request, env); return request.method === "HEAD" ? new Response(null, response) : response; }
      const cacheUrl = new URL(url);
      cacheUrl.search = "";
      const key = new Request(cacheUrl.toString(), { method: "GET" });
      const cached = await caches.default.match(key);
      if (cached) return request.method === "HEAD" ? new Response(null, cached) : cached;
      const response = await blogPage(request, env, slug);
      if (request.method === "GET" && response.ok) await caches.default.put(key, response.clone());
      return request.method === "HEAD" ? new Response(null, response) : response;
    }
    if ((request.method === "GET" || request.method === "HEAD") && /^\/blog\/preview\/[a-z0-9][a-z0-9-]{0,79}\/$/.test(url.pathname)) {
      const response = await blogPage(request, env, url.pathname.slice("/blog/preview/".length, -1), true);
      return request.method === "HEAD" ? new Response(null, response) : response;
    }
    const desk = url.pathname === "/desk" || url.pathname.startsWith("/desk/");
    let response: Response;
    if (desk && url.hostname === "www.codepi.app") { url.hostname = "codepi.app"; url.protocol = "https:"; url.port = ""; if (url.pathname === "/desk") url.pathname = "/desk/"; response = new Response(null, { status: 302, headers: { Location: url.href } }); }
    else response = await env.ASSETS.fetch(request);
    if (!desk) return response;
    const secured = new Response(response.body, response); secured.headers.set("Cache-Control", "no-store"); secured.headers.set("X-Robots-Tag", "noindex, nofollow"); secured.headers.set("Referrer-Policy", "no-referrer"); return secured;
  },
} satisfies ExportedHandler<Env>;
