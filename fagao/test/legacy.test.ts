import { SELF } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { legacyRedirect } from "../worker/index";
import { authed, bot, loginAsAllowlisted, reviewCall } from "./helpers";

describe("读完回执（服务端）", () => {
  it("没读到底不能审；读完当前版本后可以审；新版本要重新读", async () => {
    await bot("/api/posts", {
      method: "POST",
      body: JSON.stringify({ slug: "rd-1", title: "读", slot: "早", publish_date: "2026-12-01", html: "<p>1</p>", submit: true }),
    });
    const cookie = await loginAsAllowlisted();
    const early = await authed(cookie, "/api/review", {
      method: "POST",
      body: JSON.stringify({ slug: "rd-1", action: "要改", note: "改" }),
    });
    expect(early.status).toBe(409);
    expect(((await early.json()) as { code: string }).code).toBe("read_required");

    const read = await authed(cookie, "/api/posts/rd-1/read", { method: "POST" });
    expect(((await read.json()) as { version: number }).version).toBe(1);
    const ok = await authed(cookie, "/api/review", {
      method: "POST",
      body: JSON.stringify({ slug: "rd-1", action: "要改", note: "改" }),
    });
    expect(ok.status).toBe(200);

    await bot("/api/posts", {
      method: "POST",
      body: JSON.stringify({ slug: "rd-1", title: "读", slot: "早", publish_date: "2026-12-01", html: "<p>2</p>", submit: true }),
    });
    const stale = await authed(cookie, "/api/review", { method: "POST", body: JSON.stringify({ slug: "rd-1", action: "过" }) });
    expect(stale.status).toBe(409);
  });

  it("交稿 token 不能记读完回执", async () => {
    await bot("/api/posts", {
      method: "POST",
      body: JSON.stringify({ slug: "rd-1", title: "读", slot: "早", publish_date: "2026-12-01", html: "<p>1</p>", submit: true }),
    });
    const res = await bot("/api/posts/rd-1/read", { method: "POST" });
    expect(res.status).toBe(403);
  });
});

describe("旧 gzh-preview 接口兼容", () => {
  it("PUT /api/articles/:id 交稿（日期取自 id 前缀），返回旧形状 article", async () => {
    const res = await bot("/api/articles/2026-12-02-xiaotaozi", {
      method: "PUT",
      body: JSON.stringify({ slot: "中", title: "旧接口稿", html: "<p>旧</p>", digest: "摘要" }),
    });
    const body = (await res.json()) as { article: { id: string; status: string; url: string; slot: string } };
    expect(res.status).toBe(200);
    expect(body.article).toMatchObject({ id: "2026-12-02-xiaotaozi", status: "待审", slot: "中" });
    expect(body.article.url).toBe("https://fagao.kdp.cool/p/2026-12-02-xiaotaozi/");
  });

  it("POST /api/review 旧 body：action=pass 审过；status=已进箱 标进箱", async () => {
    await bot("/api/articles/2026-12-02-xiaotaozi", {
      method: "PUT",
      body: JSON.stringify({ slot: "中", title: "旧接口稿", html: "<p>旧</p>" }),
    });
    const cookie = await loginAsAllowlisted();
    await authed(cookie, "/api/posts/2026-12-02-xiaotaozi/read", { method: "POST" });
    const passed = await authed(cookie, "/api/review", {
      method: "POST",
      body: JSON.stringify({ id: "2026-12-02-xiaotaozi", action: "pass" }),
    });
    expect(((await passed.json()) as { article: { status: string } }).article.status).toBe("可推箱");

    const boxed = await bot("/api/review", {
      method: "POST",
      body: JSON.stringify({ id: "2026-12-02-xiaotaozi", status: "已进箱" }),
    });
    expect(((await boxed.json()) as { article: { status: string } }).article.status).toBe("已进箱");
  });

  it("旧 body 的非法 action 报错；新 body 不受影响", async () => {
    const cookie = await loginAsAllowlisted();
    const bad = await authed(cookie, "/api/review", { method: "POST", body: JSON.stringify({ id: "x", action: "nope" }) });
    expect(bad.status).toBe(400);
    const missing = await reviewCall(cookie, { method: "POST", body: JSON.stringify({ slug: "no-such", action: "过" }) });
    expect(missing.status).toBe(404);
  });
});

describe("旧 gzh-preview 链接跳转", () => {
  it("文章链接 301 到 fagao /p/<id>/，首页到 fagao 首页，/api 不跳", async () => {
    expect(legacyRedirect(new URL("https://gzh-preview.kdp.cool/2026-09-16-xiaotaozi/"))).toBe(
      "https://fagao.kdp.cool/p/2026-09-16-xiaotaozi/",
    );
    expect(legacyRedirect(new URL("https://gzh-preview.kdp.cool/"))).toBe("https://fagao.kdp.cool/");
    expect(legacyRedirect(new URL("https://gzh-preview.kdp.cool/api/board"))).toBeNull();
    expect(legacyRedirect(new URL("https://fagao.kdp.cool/p/x/"))).toBeNull();
    expect(legacyRedirect(new URL("https://gzh-preview.kdp.cool/p/abc/"))).toBe("https://fagao.kdp.cool/p/abc/");

    const res = await SELF.fetch("https://gzh-preview.kdp.cool/2026-09-16-xiaotaozi/", { redirect: "manual" });
    expect(res.status).toBe(301);
    expect(res.headers.get("Location")).toBe("https://fagao.kdp.cool/p/2026-09-16-xiaotaozi/");
  });
});
