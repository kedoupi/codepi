import { describe, expect, it } from "vitest";
import { authed, bot, loginAsAllowlisted, reviewCall } from "./helpers";

function post(slug: string, html: string, extra: Record<string, unknown> = {}) {
  return bot("/api/posts", {
    method: "POST",
    body: JSON.stringify({ slug, title: "版本稿", slot: "早", publish_date: "2026-11-10", html, submit: true, ...extra }),
  });
}

describe("版本", () => {
  it("首次交审 v1；在审时同 id 再交 409 不覆盖；要改后再交 v2，审核记录按版本归档", async () => {
    const first = (await (await post("ver-1", "<p>v1</p>")).json()) as { post: { version: number } };
    expect(first.post.version).toBe(1);

    const blocked = await post("ver-1", "<p>偷偷改</p>");
    expect(blocked.status).toBe(409);
    const patchBlocked = await bot("/api/posts/ver-1", { method: "PATCH", body: JSON.stringify({ title: "改标题" }) });
    expect(patchBlocked.status).toBe(409);

    const cookie = await loginAsAllowlisted();
    const html1 = await authed(cookie, "/api/posts/ver-1/content/");
    expect(await html1.text()).toBe("<p>v1</p>");

    await reviewCall(cookie, {
      method: "POST",
      body: JSON.stringify({ slug: "ver-1", action: "要改", note: "标题太长" }),
    });

    const status = (await (await bot("/api/posts/ver-1")).json()) as {
      post: { status: string; version: number; last_review: { action: string; note: string } };
    };
    expect(status.post.status).toBe("需改");
    expect(status.post.last_review.note).toBe("标题太长");

    const second = (await (await post("ver-1", "<p>v2</p>")).json()) as { post: { version: number; status: string } };
    expect(second.post.version).toBe(2);
    expect(second.post.status).toBe("待审");

    await reviewCall(cookie, { method: "POST", body: JSON.stringify({ slug: "ver-1", action: "过" }) });

    const full = (await (await bot("/api/posts/ver-1")).json()) as {
      versions: { version: number; reviews: { action: string; note: string | null }[] }[];
    };
    expect(full.versions.map((v) => v.version)).toEqual([2, 1]);
    expect(full.versions[1]!.reviews.map((r) => r.action)).toEqual(["要改"]);
    expect(full.versions[0]!.reviews.map((r) => r.action)).toEqual(["过"]);
  });

  it("草稿保存不产生版本", async () => {
    const res = (await (await post("ver-2", "<p>d</p>", { submit: false, slot: "中" })).json()) as {
      post: { version: number; status: string };
    };
    expect(res.post.status).toBe("draft");
    expect(res.post.version).toBe(0);
  });
});
