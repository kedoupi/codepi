import { describe, expect, it } from "vitest";
import { authed, bot, loginAsAllowlisted } from "./helpers";

const PNG_1PX =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=";

async function submit(slug: string, extra: Record<string, unknown> = {}) {
  return bot("/api/posts", {
    method: "POST",
    body: JSON.stringify({
      slug,
      title: "脚本交稿",
      slot: "早",
      publish_date: "2026-11-02",
      html: "<article><h1>正文</h1><p>内容</p></article>",
      cover: PNG_1PX,
      submit: true,
      ...extra,
    }),
  });
}

describe("交稿 token + 正文直传", () => {
  it("token 交稿：存正文封面、进待审、返回手机审稿链接", async () => {
    const res = await submit("tok-1");
    const body = (await res.json()) as {
      ok: boolean;
      review_url: string;
      post: { status: string; preview_path: string; has_html: boolean; has_cover: boolean };
    };
    expect(res.status).toBe(200);
    expect(body.post.status).toBe("待审");
    expect(body.post.preview_path).toBe("/api/posts/tok-1/content/");
    expect(body.post.has_html).toBe(true);
    expect(body.post.has_cover).toBe(true);
    expect(body.review_url).toBe("https://fagao.kdp.cool/p/tok-1/");

    const cookie = await loginAsAllowlisted();
    const html = await authed(cookie, "/api/posts/tok-1/content/");
    expect(html.status).toBe(200);
    expect(html.headers.get("content-type")).toContain("text/html");
    expect(html.headers.get("content-security-policy")).toContain("sandbox");
    expect(await html.text()).toContain("<h1>正文</h1>");

    const cover = await authed(cookie, "/api/posts/tok-1/content/cover.png");
    expect(cover.status).toBe(200);
    expect(cover.headers.get("content-type")).toBe("image/png");
  });

  it("没登录也没 token 时看不到正文", async () => {
    await submit("tok-2", { slot: "中" });
    const res = await bot("/api/posts/tok-2/content/", {}, "");
    expect(res.status).toBe(401);
  });

  it("错 token 401；token 不能审稿", async () => {
    const wrong = await bot("/api/board", {}, "wrong-token-wrong-token-wrong");
    expect(wrong.status).toBe(401);
    await submit("tok-3", { slot: "晚" });
    const review = await bot("/api/review", { method: "POST", body: JSON.stringify({ slug: "tok-3", action: "过" }) });
    expect(review.status).toBe(403);
  });

  it("token 可以查状态和标已进箱（只能从可推箱）", async () => {
    await submit("tok-4", { publish_date: "2026-11-03" });
    const early = await bot("/api/posts/tok-4/boxed", { method: "POST" });
    expect(early.status).toBe(409);

    const cookie = await loginAsAllowlisted();
    await authed(cookie, "/api/review", { method: "POST", body: JSON.stringify({ slug: "tok-4", action: "过" }) });
    const boxed = await bot("/api/posts/tok-4/boxed", { method: "POST" });
    expect(boxed.status).toBe(200);
    const got = (await (await bot("/api/posts/tok-4")).json()) as { post: { status: string } };
    expect(got.post.status).toBe("已进箱");
  });

  it("拒绝非法封面与超大正文", async () => {
    const badCover = await submit("tok-5", { publish_date: "2026-11-04", cover: "javascript:alert(1)" });
    expect(badCover.status).toBe(400);
    const huge = await submit("tok-6", { publish_date: "2026-11-05", html: "x".repeat(1_000_001) });
    expect(huge.status).toBe(413);
  });

  it("跨域 Cookie 请求仍被同源检查拦住", async () => {
    const cookie = await loginAsAllowlisted();
    const res = await authed(cookie, "/api/posts", {
      method: "POST",
      headers: { Origin: "https://evil.example" },
      body: JSON.stringify({ slug: "x" }),
    });
    expect(res.status).toBe(403);
  });
});
