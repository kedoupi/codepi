import { env, SELF } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { EDITOR, authed, loginAs } from "./helpers";

describe("EDITORS 名单", () => {
  it("名单里的邮箱可以登录，首次登录即 editor，能交稿但不能审", async () => {
    const cookie = await loginAs(EDITOR);
    const me = (await (await authed(cookie, "/api/me")).json()) as { account: { role: string } };
    expect(me.account.role).toBe("editor");

    const created = await authed(cookie, "/api/posts", {
      method: "POST",
      body: JSON.stringify({ slug: "ed-1", title: "编辑交稿", slot: "早", publish_date: "2026-11-01", preview_path: "/previews/zao/", submit: true }),
    });
    expect(created.status).toBe(200);

    const review = await authed(cookie, "/api/review", {
      method: "POST",
      body: JSON.stringify({ slug: "ed-1", action: "过" }),
    });
    expect(review.status).toBe(403);
  });

  it("已存在的 reviewer 账号在名单里，登录时升为 editor", async () => {
    await env.DB.prepare(
      `INSERT INTO accounts (id, email, display_name, role, active) VALUES ('acc_old_ed', ?, '旧', 'reviewer', 1)
       ON CONFLICT(email) DO UPDATE SET role = 'reviewer'`,
    ).bind(EDITOR).run();
    const cookie = await loginAs(EDITOR);
    const me = (await (await authed(cookie, "/api/me")).json()) as { account: { role: string } };
    expect(me.account.role).toBe("editor");
  });

  it("不在任何名单里的邮箱仍然拿不到验证码", async () => {
    const res = await SELF.fetch("https://fagao.kdp.cool/api/auth/request-otp", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: "nobody@example.com" }),
    });
    const body = (await res.json()) as { dev_otp?: string };
    expect(body.dev_otp).toBeUndefined();
  });
});
