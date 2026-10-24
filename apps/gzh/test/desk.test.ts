import { describe, expect, it, vi } from "vitest";
import { env } from "cloudflare:test";
import { authed, loginAsAllowlisted } from "./helpers";

describe("board + review", () => {
  it("returns today's three slots and the 2026-09-17 seed posts", async () => {
    const cookie = await loginAsAllowlisted();
    const today = await authed(cookie, "/api/board");
    const todayBody = (await today.json()) as {
      slots: { slot: string; post: unknown }[];
    };
    expect(today.status).toBe(200);
    expect(todayBody.slots.map((s) => s.slot)).toEqual(["早", "中", "晚"]);

    const demo = await authed(cookie, "/api/board?date=2026-09-17");
    const demoBody = (await demo.json()) as {
      brand: string;
      slots: { slot: string; post: { slug: string; status: string } | null }[];
      queue: { slug: string; status: string }[];
    };
    expect(demoBody.brand).toBe("珂抖屁");
    expect(demoBody.slots[0]?.post?.slug).toBe("kdp-0917-zao");
    expect(demoBody.slots[0]?.post?.status).toBe("待审");
    expect(demoBody.slots[1]?.post?.status).toBe("需改");
    expect(demoBody.slots[2]?.post?.status).toBe("可推箱");
    expect(demoBody.queue?.some((p) => p.slug === "kdp-0917-zao" && p.status === "待审")).toBe(true);
    expect(demoBody.queue?.some((p) => p.status === "可推箱")).toBe(false);
  });

  it("does not invent posts for an empty date that is not today", async () => {
    const cookie = await loginAsAllowlisted();
    const res = await authed(cookie, "/api/board?date=2099-01-01");
    const body = (await res.json()) as {
      slots: { slot: string; post: unknown }[];
      queue: unknown[];
    };
    expect(res.status).toBe(200);
    expect(body.slots.every((row) => row.post === null)).toBe(true);
  });

  it("walks 待审 → 过 → 可推箱 → 已进箱", async () => {
    const cookie = await loginAsAllowlisted();
    await authed(cookie, "/api/posts", {
      method: "POST",
      body: JSON.stringify({
        slug: "flow-pass",
        title: "过审流",
        slot: "早",
        publish_date: "2026-09-18",
        preview_path: "/previews/kdp-0917-zao/",
        submit: true,
      }),
    });

    const passed = await authed(cookie, "/api/review", {
      method: "POST",
      body: JSON.stringify({ slug: "flow-pass", action: "过" }),
    });
    const passedBody = (await passed.json()) as { post: { status: string } };
    expect(passed.status).toBe(200);
    expect(passedBody.post.status).toBe("可推箱");

    const boxed = await authed(cookie, "/api/posts/flow-pass/boxed", { method: "POST" });
    const boxedBody = (await boxed.json()) as { post: { status: string } };
    expect(boxed.status).toBe(200);
    expect(boxedBody.post.status).toBe("已进箱");
  });

  it("maps 要改 and 拒 to 需改, then allows resubmit", async () => {
    const cookie = await loginAsAllowlisted();
    await authed(cookie, "/api/posts", {
      method: "POST",
      body: JSON.stringify({
        slug: "flow-change",
        title: "要改流",
        slot: "中",
        publish_date: "2026-09-18",
        preview_path: "/previews/kdp-0917-zhong/",
        submit: true,
      }),
    });

    const needNote = await authed(cookie, "/api/review", {
      method: "POST",
      body: JSON.stringify({ slug: "flow-change", action: "要改" }),
    });
    expect(needNote.status).toBe(400);

    const changed = await authed(cookie, "/api/review", {
      method: "POST",
      body: JSON.stringify({ slug: "flow-change", action: "要改", note: "标题再短" }),
    });
    const changedBody = (await changed.json()) as { post: { status: string; note: string } };
    expect(changedBody.post.status).toBe("需改");
    expect(changedBody.post.note).toBe("标题再短");

    const resubmit = await authed(cookie, "/api/posts", {
      method: "POST",
      body: JSON.stringify({
        slug: "flow-change",
        title: "要改流·改完",
        slot: "中",
        publish_date: "2026-09-18",
        preview_path: "/previews/kdp-0917-zhong/",
        submit: true,
      }),
    });
    const resubmitBody = (await resubmit.json()) as { post: { status: string } };
    expect(resubmit.status).toBe(200);
    expect(resubmitBody.post.status).toBe("待审");

    await authed(cookie, "/api/posts", {
      method: "POST",
      body: JSON.stringify({
        slug: "flow-reject",
        title: "拒稿流",
        slot: "晚",
        publish_date: "2026-09-18",
        preview_path: "/previews/kdp-0917-wan/",
        submit: true,
      }),
    });
    const rejected = await authed(cookie, "/api/review", {
      method: "POST",
      body: JSON.stringify({ slug: "flow-reject", action: "拒", note: "不做了" }),
    });
    const rejectedBody = (await rejected.json()) as { post: { status: string } };
    expect(rejectedBody.post.status).toBe("需改");
  });

  it("rejects a second post on the same date+slot", async () => {
    const cookie = await loginAsAllowlisted();
    const first = await authed(cookie, "/api/posts", {
      method: "POST",
      body: JSON.stringify({
        slug: "slot-a",
        title: "A",
        slot: "早",
        publish_date: "2026-09-19",
        preview_path: "/previews/kdp-0917-zao/",
        submit: true,
      }),
    });
    expect(first.status).toBe(200);

    const clash = await authed(cookie, "/api/posts", {
      method: "POST",
      body: JSON.stringify({
        slug: "slot-b",
        title: "B",
        slot: "早",
        publish_date: "2026-09-19",
        preview_path: "/previews/kdp-0917-zao/",
        submit: true,
      }),
    });
    expect(clash.status).toBe(409);
  });

  it("withdraws 可推箱 / 已进箱 / 需改 back to 待审 and allows 过 again", async () => {
    const cookie = await loginAsAllowlisted();

    await authed(cookie, "/api/posts", {
      method: "POST",
      body: JSON.stringify({
        slug: "flow-withdraw",
        title: "撤回流",
        slot: "早",
        publish_date: "2026-09-20",
        preview_path: "/previews/kdp-0917-zao/",
        submit: true,
      }),
    });

    await authed(cookie, "/api/review", {
      method: "POST",
      body: JSON.stringify({ slug: "flow-withdraw", action: "过" }),
    });

    const fromReady = await authed(cookie, "/api/posts/flow-withdraw/withdraw", { method: "POST" });
    const fromReadyBody = (await fromReady.json()) as { post: { status: string; can_withdraw: boolean } };
    expect(fromReady.status).toBe(200);
    expect(fromReadyBody.post.status).toBe("待审");
    expect(fromReadyBody.post.can_withdraw).toBe(false);

    await authed(cookie, "/api/review", {
      method: "POST",
      body: JSON.stringify({ slug: "flow-withdraw", action: "过" }),
    });
    await authed(cookie, "/api/posts/flow-withdraw/boxed", { method: "POST" });

    const fromBoxed = await authed(cookie, "/api/posts/flow-withdraw/withdraw", { method: "POST" });
    const fromBoxedBody = (await fromBoxed.json()) as { post: { status: string } };
    expect(fromBoxed.status).toBe(200);
    expect(fromBoxedBody.post.status).toBe("待审");

    const passedAgain = await authed(cookie, "/api/review", {
      method: "POST",
      body: JSON.stringify({ slug: "flow-withdraw", action: "过" }),
    });
    expect(((await passedAgain.json()) as { post: { status: string } }).post.status).toBe("可推箱");

    await authed(cookie, "/api/posts", {
      method: "POST",
      body: JSON.stringify({
        slug: "flow-withdraw-need",
        title: "需改撤回",
        slot: "中",
        publish_date: "2026-09-20",
        preview_path: "/previews/kdp-0917-zhong/",
        submit: true,
      }),
    });
    await authed(cookie, "/api/review", {
      method: "POST",
      body: JSON.stringify({ slug: "flow-withdraw-need", action: "要改", note: "再短" }),
    });
    const fromNeed = await authed(cookie, "/api/posts/flow-withdraw-need/withdraw", { method: "POST" });
    expect(((await fromNeed.json()) as { post: { status: string } }).post.status).toBe("待审");
  });

  it("rejects withdraw from 待审 and marks 0917 seeds as demos", async () => {
    const cookie = await loginAsAllowlisted();
    const pending = await authed(cookie, "/api/posts/kdp-0917-zao/withdraw", { method: "POST" });
    expect(pending.status).toBe(409);

    const board = await authed(cookie, "/api/board?date=2026-09-17");
    const body = (await board.json()) as {
      slots: { post: { slug: string; is_demo: boolean; can_withdraw: boolean; status: string } | null }[];
    };
    expect(body.slots[0]?.post?.is_demo).toBe(true);
    expect(body.slots[0]?.post?.can_withdraw).toBe(false);
    expect(body.slots[1]?.post?.can_withdraw).toBe(true);
    expect(body.slots[2]?.post?.status).toBe("可推箱");
    expect(body.slots[2]?.post?.can_withdraw).toBe(true);
    expect(body.slots[2]?.post?.is_demo).toBe(true);
  });

  it("lets a real post replace a demo occupant on the same slot", async () => {
    const cookie = await loginAsAllowlisted();
    const replaced = await authed(cookie, "/api/posts", {
      method: "POST",
      body: JSON.stringify({
        slug: "real-wan",
        title: "真·晚档",
        slot: "晚",
        publish_date: "2026-09-17",
        preview_path: "/previews/wan/",
        submit: true,
      }),
    });
    const replacedBody = (await replaced.json()) as { post: { slug: string; status: string; is_demo: boolean } };
    expect(replaced.status).toBe(200);
    expect(replacedBody.post.slug).toBe("real-wan");
    expect(replacedBody.post.status).toBe("待审");
    expect(replacedBody.post.is_demo).toBe(false);

    const board = await authed(cookie, "/api/board?date=2026-09-17");
    const body = (await board.json()) as {
      slots: { slot: string; post: { slug: string } | null }[];
    };
    expect(body.slots[2]?.post?.slug).toBe("real-wan");
  });

  it("releases a demo slot and refuses to release a real post", async () => {
    const cookie = await loginAsAllowlisted();
    const released = await authed(cookie, "/api/posts/kdp-0917-zao/release-demo", { method: "POST" });
    expect(released.status).toBe(200);

    const board = await authed(cookie, "/api/board?date=2026-09-17");
    const body = (await board.json()) as {
      slots: { slot: string; post: { slug: string } | null }[];
    };
    expect(body.slots[0]?.post).toBeNull();

    await authed(cookie, "/api/posts", {
      method: "POST",
      body: JSON.stringify({
        slug: "real-wan",
        title: "真·晚档",
        slot: "晚",
        publish_date: "2026-09-23",
        preview_path: "/previews/wan/",
        submit: true,
      }),
    });
    const refused = await authed(cookie, "/api/posts/real-wan/release-demo", { method: "POST" });
    expect(refused.status).toBe(409);
  });

  it("clears the evening demo flag after withdraw + real HarnessTax preview", async () => {
    const cookie = await loginAsAllowlisted();
    const withdrawn = await authed(cookie, "/api/posts/kdp-0917-wan/withdraw", { method: "POST" });
    expect(withdrawn.status).toBe(200);
    expect(((await withdrawn.json()) as { post: { is_demo: boolean; status: string } }).post.is_demo).toBe(
      true,
    );

    const patched = await authed(cookie, "/api/posts/kdp-0917-wan", {
      method: "PATCH",
      body: JSON.stringify({
        title: "HarnessTax",
        preview_path: "https://gzh-preview.kdp.cool/p/harnesstax/",
      }),
    });
    const patchedBody = (await patched.json()) as {
      post: { slug: string; title: string; is_demo: boolean; status: string };
    };
    expect(patched.status).toBe(200);
    expect(patchedBody.post.slug).toBe("kdp-0917-wan");
    expect(patchedBody.post.title).toBe("HarnessTax");
    expect(patchedBody.post.status).toBe("待审");
    expect(patchedBody.post.is_demo).toBe(false);

    const board = await authed(cookie, "/api/board?date=2026-09-17");
    const body = (await board.json()) as {
      slots: { post: { slug: string; is_demo: boolean } | null }[];
    };
    expect(body.slots[2]?.post?.slug).toBe("kdp-0917-wan");
    expect(body.slots[2]?.post?.is_demo).toBe(false);
  });

  it("clears is_demo when a withdrawn demo slot is patched with a real gzh-preview", async () => {
    const cookie = await loginAsAllowlisted();
    const withdrawn = await authed(cookie, "/api/posts/kdp-0917-zhong/withdraw", { method: "POST" });
    expect(withdrawn.status).toBe(200);

    const patched = await authed(cookie, "/api/posts/kdp-0917-zhong", {
      method: "PATCH",
      body: JSON.stringify({
        title: "HarnessTax",
        preview_path: "https://gzh-preview.kdp.cool/p/harnesstax/",
      }),
    });
    const patchedBody = (await patched.json()) as {
      post: { slug: string; title: string; is_demo: boolean; preview_path: string };
    };
    expect(patched.status).toBe(200);
    expect(patchedBody.post.slug).toBe("kdp-0917-zhong");
    expect(patchedBody.post.title).toBe("HarnessTax");
    expect(patchedBody.post.preview_path).toBe("https://gzh-preview.kdp.cool/p/harnesstax/");
    expect(patchedBody.post.is_demo).toBe(false);

    const board = await authed(cookie, "/api/board?date=2026-09-17");
    const body = (await board.json()) as {
      slots: { post: { slug: string; is_demo: boolean } | null }[];
    };
    expect(body.slots[1]?.post?.slug).toBe("kdp-0917-zhong");
    expect(body.slots[1]?.post?.is_demo).toBe(false);

    const refused = await authed(cookie, "/api/posts/kdp-0917-zhong/release-demo", { method: "POST" });
    expect(refused.status).toBe(409);

    const clash = await authed(cookie, "/api/posts", {
      method: "POST",
      body: JSON.stringify({
        slug: "another-zhong",
        title: "另一篇中档",
        slot: "中",
        publish_date: "2026-09-17",
        preview_path: "/previews/zhong/",
        submit: true,
      }),
    });
    expect(clash.status).toBe(409);
  });

  it("keeps is_demo when PATCH still points at a demo preview, and clears on 标为正式稿 + slug rename", async () => {
    const cookie = await loginAsAllowlisted();
    await authed(cookie, "/api/posts", {
      method: "POST",
      body: JSON.stringify({
        slug: "kdp-0921-wan",
        title: "占位",
        slot: "晚",
        publish_date: "2026-09-21",
        preview_path: "/previews/wan/",
        submit: true,
      }),
    });
    const { env } = await import("cloudflare:test");
    await env.DB.prepare(`UPDATE posts SET is_demo = 1, title = ? WHERE id = ?`)
      .bind("晚档：今日收束", "kdp-0921-wan")
      .run();

    const stillDemo = await authed(cookie, "/api/posts/kdp-0921-wan", {
      method: "PATCH",
      body: JSON.stringify({
        title: "晚档：今日收束",
        preview_path: "/previews/kdp-0917-wan/",
      }),
    });
    expect(((await stillDemo.json()) as { post: { is_demo: boolean } }).post.is_demo).toBe(true);

    const official = await authed(cookie, "/api/posts/kdp-0921-wan", {
      method: "PATCH",
      body: JSON.stringify({ mark_official: true, new_slug: "20260921-wan" }),
    });
    const officialBody = (await official.json()) as {
      post: { slug: string; is_demo: boolean };
    };
    expect(official.status).toBe(200);
    expect(officialBody.post.slug).toBe("20260921-wan");
    expect(officialBody.post.is_demo).toBe(false);

    const old = await authed(cookie, "/api/posts/kdp-0921-wan");
    expect(old.status).toBe(404);
  });

  it("clears is_demo when POST upsert updates the same demo slug with a real preview", async () => {
    const cookie = await loginAsAllowlisted();
    await authed(cookie, "/api/posts", {
      method: "POST",
      body: JSON.stringify({
        slug: "kdp-0922-zao",
        title: "占位早",
        slot: "早",
        publish_date: "2026-09-22",
        preview_path: "/previews/zao/",
        submit: true,
      }),
    });
    const { env } = await import("cloudflare:test");
    await env.DB.prepare(`UPDATE posts SET is_demo = 1, title = ? WHERE id = ?`)
      .bind("早档：开箱一件小事", "kdp-0922-zao")
      .run();

    const updated = await authed(cookie, "/api/posts", {
      method: "POST",
      body: JSON.stringify({
        slug: "kdp-0922-zao",
        title: "早档真稿",
        slot: "早",
        publish_date: "2026-09-22",
        preview_path: "https://example.com/real-zao",
        submit: true,
      }),
    });
    const updatedBody = (await updated.json()) as { post: { slug: string; is_demo: boolean; title: string } };
    expect(updated.status).toBe(200);
    expect(updatedBody.post.slug).toBe("kdp-0922-zao");
    expect(updatedBody.post.title).toBe("早档真稿");
    expect(updatedBody.post.is_demo).toBe(false);
  });
  it("loads all board reviews with one query and keeps each post's latest review", async () => {
    const cookie = await loginAsAllowlisted();
    for (const [slug, slot, publishDate] of [
      ["board-bulk-zao", "早", "2026-12-01"],
      ["board-bulk-zhong", "中", "2026-12-01"],
      ["board-bulk-wan", "晚", "2026-12-01"],
      ["board-bulk-queue", "早", "2026-12-02"],
    ] as const) {
      const created = await authed(cookie, "/api/posts", {
        method: "POST",
        body: JSON.stringify({
          slug,
          title: slug,
          slot,
          publish_date: publishDate,
          preview_path: `/previews/${slug}/`,
          submit: true,
        }),
      });
      expect(created.status).toBe(200);
    }

    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO reviews (id, post_id, actor_account_id, action, from_status, to_status, note, created_at)
         VALUES (?, ?, 'acc_owner_kdp', ?, '待审', '需改', ?, ?)`,
      ).bind("review-bulk-zao-old", "board-bulk-zao", "要改", "旧意见", "2026-01-01T00:00:00.000Z"),
      env.DB.prepare(
        `INSERT INTO reviews (id, post_id, actor_account_id, action, from_status, to_status, note, created_at)
         VALUES (?, ?, 'acc_owner_kdp', ?, '待审', '可推箱', ?, ?)`,
      ).bind("review-bulk-zao-new", "board-bulk-zao", "过", null, "2026-02-01T00:00:00.000Z"),
      env.DB.prepare(
        `INSERT INTO reviews (id, post_id, actor_account_id, action, from_status, to_status, note, created_at)
         VALUES (?, ?, 'acc_owner_kdp', ?, '待审', '需改', ?, ?)`,
      ).bind("review-bulk-queue", "board-bulk-queue", "要改", "队列意见", "2026-03-01T00:00:00.000Z"),
    ]);

    const prepare = vi.spyOn(env.DB, "prepare");
    const response = await authed(cookie, "/api/board?date=2026-12-01");
    const body = (await response.json()) as {
      slots: { slot: string; post: { slug: string; last_review: unknown } | null }[];
      queue: { slug: string; last_review: unknown }[];
    };
    const reviewQueries = prepare.mock.calls.filter(([query]) => /\bFROM reviews\b/i.test(query.toString()));
    expect(reviewQueries).toHaveLength(1);
    expect(body.slots.find((slot) => slot.slot === "早")?.post?.last_review).toEqual({
      action: "过",
      note: null,
      created_at: "2026-02-01T00:00:00.000Z",
    });
    expect(body.slots.find((slot) => slot.slot === "中")?.post?.last_review).toBeNull();
    expect(body.slots.find((slot) => slot.slot === "晚")?.post?.last_review).toBeNull();
    expect(body.queue.find((post) => post.slug === "board-bulk-queue")?.last_review).toEqual({
      action: "要改",
      note: "队列意见",
      created_at: "2026-03-01T00:00:00.000Z",
    });
  });
});
