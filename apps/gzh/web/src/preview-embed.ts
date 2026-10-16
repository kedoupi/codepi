function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

const DANGEROUS_TAGS =
  "script|iframe|object|embed|form|base|meta|link|svg|math|video|audio|source|template|noscript|style";

export type FetchPreviewResult =
  | { ok: true; html: string }
  | { ok: false; reason: "login" | "unavailable" };

/** Same-origin `/previews/…` (and other non-`/p/` paths) can be fetched and inlined. */
export function canInlinePreview(path: string, pageOrigin: string): boolean {
  const trimmed = path.trim();
  if (!trimmed) return false;
  if (trimmed.startsWith("/p/")) return false;
  try {
    const url = new URL(trimmed, pageOrigin);
    if (url.origin !== pageOrigin) return false;
    if (url.pathname === "/p" || url.pathname.startsWith("/p/")) return false;
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

export function looksLikeHtml(text: string): boolean {
  const slice = text.slice(0, 4096);
  return /<!doctype html|<html[\s>]|<article[\s>]|<body[\s>]/i.test(slice);
}

export function isSpaShellHtml(html: string): boolean {
  return /id=["']app["']/.test(html) && /src\/main\.ts|\/assets\/index-/.test(html);
}

export function isLoginHtml(html: string): boolean {
  return /id=["']otp-form["']/.test(html) || /发送验证码/.test(html);
}

export function previewBaseHref(src: string, pageOrigin: string): string {
  const url = new URL(src, pageOrigin);
  if (/\.html?$/i.test(url.pathname)) {
    url.pathname = url.pathname.replace(/[^/]+$/, "");
  } else if (!url.pathname.endsWith("/") && !/\.[a-z0-9]+$/i.test(url.pathname)) {
    url.pathname += "/";
  }
  url.hash = "";
  url.search = "";
  return url.href;
}

export function extractStylesheetHrefs(html: string): string[] {
  const hrefs: string[] = [];
  const re = /<link\b[^>]*>/gi;
  let match: RegExpExecArray | null;
  while ((match = re.exec(html))) {
    const tag = match[0];
    if (!/\brel\s*=\s*(['"]?)stylesheet\1/i.test(tag)) continue;
    const href =
      tag.match(/\bhref\s*=\s*(['"])([^'"]+)\1/i)?.[2] ??
      tag.match(/\bhref\s*=\s*([^\s>]+)/i)?.[1];
    if (href) hrefs.push(href.replace(/^['"]|['"]$/g, ""));
  }
  return hrefs;
}

export function extractArticleHtml(html: string): string {
  const article = html.match(/<article\b[^>]*>[\s\S]*?<\/article>/i);
  if (article) return article[0];
  const body = html.match(/<body\b[^>]*>([\s\S]*)<\/body>/i);
  if (body?.[1]) return `<div class="preview-fallback">${body[1]}</div>`;
  return html;
}

export function sanitizePreviewHtml(html: string): string {
  let out = html.replace(/<!--[\s\S]*?-->/g, "");
  out = out.replace(new RegExp(`<(${DANGEROUS_TAGS})\\b[^>]*>[\\s\\S]*?</\\1>`, "gi"), "");
  out = out.replace(new RegExp(`<(${DANGEROUS_TAGS})\\b[^>]*\\/?>`, "gi"), "");
  out = out.replace(/\son[a-z0-9_-]+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, "");
  out = out.replace(
    /\s(href|src|xlink:href|action|formaction)\s*=\s*(['"])\s*(javascript:|vbscript:|data:\s*text\/html)[\s\S]*?\2/gi,
    ' $1="#"',
  );
  out = out.replace(
    /\s(href|src|xlink:href|action|formaction)\s*=\s*(javascript:|vbscript:)[^\s>]*/gi,
    ' $1="#"',
  );
  out = out.replace(/\ssrcdoc\s*=\s*("[^"]*"|'[^']*')/gi, "");
  return out;
}

export function rewriteRelativeUrls(html: string, baseHref: string): string {
  return html.replace(/\s(src|href)\s*=\s*(['"])([^'"]*)\2/gi, (full, attr: string, quote: string, value: string) => {
    const raw = value.trim();
    if (!raw) return full;
    if (/^(https?:|data:|mailto:|tel:|#|javascript:|vbscript:)/i.test(raw)) return full;
    if (raw.startsWith("//")) return full;
    try {
      const abs = new URL(raw, baseHref).href;
      return ` ${attr}=${quote}${escapeHtml(abs)}${quote}`;
    } catch {
      return full;
    }
  });
}

export function safeStylesheetHref(href: string, previewSrc: string, pageOrigin: string): string | null {
  try {
    const url = new URL(href, new URL(previewSrc, pageOrigin));
    if (url.origin !== pageOrigin) return null;
    if (!url.pathname.startsWith("/previews/")) return null;
    if (!url.pathname.endsWith(".css")) return null;
    url.hash = "";
    return url.href;
  } catch {
    return null;
  }
}

export function collectPreviewStylesheets(
  html: string,
  previewSrc: string,
  pageOrigin: string,
): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  const push = (href: string | null) => {
    if (!href || seen.has(href)) return;
    seen.add(href);
    out.push(href);
  };

  try {
    const srcUrl = new URL(previewSrc, pageOrigin);
    if (srcUrl.origin === pageOrigin && srcUrl.pathname.startsWith("/previews/")) {
      push(new URL("/previews/article.css", pageOrigin).href);
    }
  } catch {
    /* ignore */
  }

  for (const href of extractStylesheetHrefs(html)) {
    push(safeStylesheetHref(href, previewSrc, pageOrigin));
  }
  return out;
}

export function sandboxedIframeMarkup(src: string, sameOrigin: boolean): string {
  const sandbox = sameOrigin
    ? "allow-same-origin"
    : "allow-scripts allow-popups allow-popups-to-escape-sandbox";
  return `<iframe class="preview-frame" title="稿件预览" src="${escapeHtml(src)}" sandbox="${sandbox}" referrerpolicy="no-referrer"></iframe>`;
}

type PreviewFetch = (
  input: string,
  init?: { credentials?: "same-origin" | "include" | "omit"; redirect?: "manual" | "follow" | "error" },
) => Promise<Response>;

export async function fetchSameOriginHtml(
  src: string,
  fetchImpl: PreviewFetch = fetch as PreviewFetch,
): Promise<FetchPreviewResult> {
  try {
    const res = await fetchImpl(src, { credentials: "same-origin", redirect: "follow" });
    if (res.status === 401) return { ok: false, reason: "login" };
    if (res.status >= 300 && res.status < 400) {
      const location = res.headers.get("Location") || "";
      if (location.includes("/login")) return { ok: false, reason: "login" };
      return { ok: false, reason: "unavailable" };
    }
    if (!res.ok) return { ok: false, reason: "unavailable" };

    const finalUrl = res.url;
    if (finalUrl) {
      try {
        if (/\/login\/?$/i.test(new URL(finalUrl).pathname)) return { ok: false, reason: "login" };
      } catch {
        /* ignore */
      }
    }

    const text = await res.text();
    if (isLoginHtml(text)) return { ok: false, reason: "login" };
    if (!looksLikeHtml(text) || isSpaShellHtml(text)) return { ok: false, reason: "unavailable" };
    return { ok: true, html: text };
  } catch {
    return { ok: false, reason: "unavailable" };
  }
}

export function prepareInlineArticle(
  html: string,
  previewSrc: string,
  pageOrigin: string,
): { articleHtml: string; stylesheets: string[] } | null {
  const stylesheets = collectPreviewStylesheets(html, previewSrc, pageOrigin);
  const extracted = extractArticleHtml(html);
  const rewritten = rewriteRelativeUrls(extracted, previewBaseHref(previewSrc, pageOrigin));
  const articleHtml = sanitizePreviewHtml(rewritten).trim();
  if (!articleHtml) return null;
  return { articleHtml, stylesheets };
}
