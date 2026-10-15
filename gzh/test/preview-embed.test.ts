import { describe, expect, it } from "vitest";
import {
  canInlinePreview,
  collectPreviewStylesheets,
  extractArticleHtml,
  fetchSameOriginHtml,
  isLoginHtml,
  isSpaShellHtml,
  looksLikeHtml,
  prepareInlineArticle,
  previewBaseHref,
  rewriteRelativeUrls,
  safeStylesheetHref,
  sandboxedIframeMarkup,
  sanitizePreviewHtml,
} from "../web/src/preview-embed";

const ORIGIN = "https://gzh.codepi.app";

describe("preview inline eligibility", () => {
  it("inlines same-origin /previews paths and rejects /p/ plus cross-origin", () => {
    expect(canInlinePreview("/previews/kdp-0917-zao/", ORIGIN)).toBe(true);
    expect(canInlinePreview("/previews/zao/", ORIGIN)).toBe(true);
    expect(canInlinePreview(`${ORIGIN}/previews/wan/`, ORIGIN)).toBe(true);
    expect(canInlinePreview("/p/kdp-0917-zao/", ORIGIN)).toBe(false);
    expect(canInlinePreview("https://gzh-preview.kdp.cool/p/harnesstax/", ORIGIN)).toBe(false);
    expect(canInlinePreview("https://example.com/real-zao", ORIGIN)).toBe(false);
    expect(canInlinePreview("", ORIGIN)).toBe(false);
  });
});

describe("sanitize + extract", () => {
  it("keeps article copy and strips script, handlers, and javascript URLs", () => {
    const dirty = `
      <article>
        <h1>开箱一件小事</h1>
        <p onclick="alert(1)">桌上那枚回形针</p>
        <script>alert(1)</script>
        <iframe src="https://evil.example/"></iframe>
        <a href="javascript:alert(1)">坏链</a>
        <img src="cover.png" onerror="alert(1)" />
      </article>
    `;
    const clean = sanitizePreviewHtml(extractArticleHtml(dirty));
    expect(clean).toContain("开箱一件小事");
    expect(clean).toContain("桌上那枚回形针");
    expect(clean.toLowerCase()).not.toContain("<script");
    expect(clean.toLowerCase()).not.toContain("<iframe");
    expect(clean.toLowerCase()).not.toContain("onclick");
    expect(clean.toLowerCase()).not.toContain("onerror");
    expect(clean.toLowerCase()).not.toContain("javascript:");
  });

  it("rewrites relative media URLs against the preview directory", () => {
    const html = `<article><img src="cover.png"><a href="./more.html">下</a></article>`;
    const out = rewriteRelativeUrls(html, previewBaseHref("/previews/zao/", ORIGIN));
    expect(out).toContain(`${ORIGIN}/previews/zao/cover.png`);
    expect(out).toContain(`${ORIGIN}/previews/zao/more.html`);
  });

  it("only allows same-origin /previews CSS", () => {
    expect(safeStylesheetHref("/previews/article.css", "/previews/zao/", ORIGIN)).toBe(
      `${ORIGIN}/previews/article.css`,
    );
    expect(safeStylesheetHref("https://evil.example/x.css", "/previews/zao/", ORIGIN)).toBeNull();
    expect(safeStylesheetHref("/assets/app.css", "/previews/zao/", ORIGIN)).toBeNull();

    const sheets = collectPreviewStylesheets(
      `<link rel="stylesheet" href="/previews/article.css">`,
      "/previews/zao/",
      ORIGIN,
    );
    expect(sheets).toEqual([`${ORIGIN}/previews/article.css`]);
  });

  it("prepares inline article HTML without scripts", () => {
    const prepared = prepareInlineArticle(
      `<!doctype html><html><head><link rel="stylesheet" href="/previews/article.css"></head>
       <body><article><p>正文<script>alert(1)</script></p></article></body></html>`,
      "/previews/zao/",
      ORIGIN,
    );
    expect(prepared).not.toBeNull();
    expect(prepared!.articleHtml).toContain("正文");
    expect(prepared!.articleHtml.toLowerCase()).not.toContain("<script");
    expect(prepared!.stylesheets).toContain(`${ORIGIN}/previews/article.css`);
  });
});

describe("html sniffing", () => {
  it("detects html vs spa shell vs login form", () => {
    expect(looksLikeHtml("<!doctype html><article></article>")).toBe(true);
    expect(looksLikeHtml('{"ok":true}')).toBe(false);
    expect(isSpaShellHtml(`<div id="app"></div><script type="module" src="/src/main.ts"></script>`)).toBe(true);
    expect(isLoginHtml(`<form id="otp-form"><button>发送验证码</button></form>`)).toBe(true);
  });
});

describe("iframe fallback", () => {
  it("sandboxes same-origin without scripts and cross-origin without same-origin", () => {
    const same = sandboxedIframeMarkup("/previews/zao/", true);
    expect(same).toContain('sandbox="allow-same-origin"');
    expect(same).not.toContain("allow-scripts");
    expect(same).toContain('src="/previews/zao/"');

    const cross = sandboxedIframeMarkup("https://gzh-preview.kdp.cool/p/harnesstax/", false);
    expect(cross).toContain("allow-scripts");
    expect(cross).not.toContain("allow-same-origin");
  });
});

describe("fetchSameOriginHtml", () => {
  it("maps login redirects and non-html to structured failures", async () => {
    const login = await fetchSameOriginHtml("/previews/zao/", (async () =>
      new Response(null, { status: 302, headers: { Location: "/login?next=/previews/zao/" } })) as typeof fetch);
    expect(login).toEqual({ ok: false, reason: "login" });

    const missing = await fetchSameOriginHtml("/previews/zao/", (async () =>
      new Response("not found", { status: 404 })) as typeof fetch);
    expect(missing).toEqual({ ok: false, reason: "unavailable" });

    const ok = await fetchSameOriginHtml("/previews/zao/", (async () =>
      new Response("<!doctype html><article><p>早档</p></article>", {
        status: 200,
        headers: { "content-type": "text/html" },
      })) as typeof fetch);
    expect(ok.ok).toBe(true);
    if (ok.ok) expect(ok.html).toContain("早档");

    const followedLogin = await fetchSameOriginHtml("/previews/zao/", (async () =>
      new Response(`<form id="otp-form"><button>发送验证码</button></form>`, {
        status: 200,
        headers: { "content-type": "text/html" },
      })) as typeof fetch);
    expect(followedLogin).toEqual({ ok: false, reason: "login" });
  });
});
