import { describe, expect, it } from "vitest";
import { authed, bot, loginAsAllowlisted } from "./helpers";

function submit(slug: string, extra: Record<string, unknown> = {}) {
  return bot("/api/posts", {
    method: "POST",
    body: JSON.stringify({ slug, title: "稿", slot: "早", publish_date: "2026-11-20", html: "<p>x</p>", submit: true, ...extra }),
  });
}

describe("弃用 + 测试稿", () => {
  it("弃用释放档位，同档可交新稿；弃用后不能再改、不能审、不能进箱", async () => {
    await submit("dis-1");
    const discard = await bot("/api/posts/dis-1/discard", { method: "POST", body: JSON.stringify({ note: "选题撞车" }) });
    const body = (await discard.json()) as { post: { status: string; slot: string | null; discarded_slot: string } };
    expect(discard.status).toBe(200);
    expect(body.post.status).toBe("弃用");
    expect(body.post.slot).toBeNull();
    expect(body.post.discarded_slot).toBe("早");

    const again = await submit("dis-2");
    expect(again.status).toBe(200);

    expect((await submit("dis-1")).status).toBe(409);
    expect((await bot("/api/posts/dis-1/boxed", { method: "POST" })).status).toBe(409);
    expect((await bot("/api/posts/dis-1/discard", { method: "POST" })).status).toBe(409);
    const cookie = await loginAsAllowlisted();
    const review = await authed(cookie, "/api/review", { method: "POST", body: JSON.stringify({ slug: "dis-1", action: "过" }) });
    expect(review.status).toBe(409);
  });

  it("已进箱的稿不能弃用", async () => {
    await submit("dis-3", { publish_date: "2026-11-21" });
    const cookie = await loginAsAllowlisted();
    await authed(cookie, "/api/review", { method: "POST", body: JSON.stringify({ slug: "dis-3", action: "过" }) });
    await bot("/api/posts/dis-3/boxed", { method: "POST" });
    expect((await bot("/api/posts/dis-3/discard", { method: "POST" })).status).toBe(409);
  });

  it("测试稿不占正式档位、不进正式看板和待审队列；?test=1 单独看", async () => {
    const t = (await (await submit("tst-1", { publish_date: "2026-11-22", is_test: true })).json()) as { post: { is_test: boolean } };
    expect(t.post.is_test).toBe(true);
    expect((await submit("real-1", { publish_date: "2026-11-22" })).status).toBe(200);

    const board = (await (await bot("/api/board?date=2026-11-22")).json()) as {
      slots: { slot: string; post: { slug: string } | null }[];
      queue: { slug: string }[];
    };
    expect(board.slots[0]!.post?.slug).toBe("real-1");
    expect(board.queue.some((p) => p.slug === "tst-1")).toBe(false);

    const testBoard = (await (await bot("/api/board?date=2026-11-22&test=1")).json()) as {
      slots: { post: { slug: string } | null }[];
    };
    expect(testBoard.slots[0]!.post?.slug).toBe("tst-1");
  });
});
