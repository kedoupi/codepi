import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import {
  demoPreviewPath,
  demoSlug,
  DEMO_SPECS,
  ensureTodayDemo,
  isDemoPreviewPath,
  isDemoSlug,
  isDemoTitle,
  isRealPreviewPath,
  shouldClearDemo,
} from "../worker/seed";

describe("today demo seed", () => {
  it("builds stable slugs and preview paths", () => {
    expect(demoSlug("2026-09-18", "早")).toBe("kdp-0918-zao");
    expect(demoSlug("2026-09-18", "中")).toBe("kdp-0918-zhong");
    expect(demoSlug("2026-09-18", "晚")).toBe("kdp-0918-wan");
    expect(demoPreviewPath("早")).toBe("/previews/zao/");
    expect(isDemoSlug("kdp-0917-wan")).toBe(true);
    expect(isDemoSlug("real-wan")).toBe(false);
    expect(isDemoTitle("晚档：今日收束")).toBe(true);
    expect(isDemoTitle("HarnessTax")).toBe(false);
    expect(isDemoPreviewPath("/previews/wan/")).toBe(true);
    expect(isDemoPreviewPath("/previews/kdp-0917-wan/index.html")).toBe(true);
    expect(isDemoPreviewPath("/previews/custom/")).toBe(false);
    expect(isRealPreviewPath("")).toBe(false);
    expect(isRealPreviewPath("/previews/wan/")).toBe(false);
    expect(isRealPreviewPath("https://gzh.codepi.app/previews/wan/")).toBe(false);
    expect(isRealPreviewPath("/previews/custom-article/")).toBe(true);
    expect(isRealPreviewPath("https://gzh-preview.kdp.cool/p/harnesstax/")).toBe(true);
    expect(isRealPreviewPath("https://example.com/article")).toBe(true);
    expect(
      shouldClearDemo({
        isDemo: true,
        title: "晚档：今日收束",
        previewPath: "/previews/wan/",
      }),
    ).toBe(false);
    expect(
      shouldClearDemo({
        isDemo: true,
        title: "HarnessTax",
        previewPath: "https://gzh-preview.kdp.cool/p/harnesstax/",
      }),
    ).toBe(true);
    expect(shouldClearDemo({ isDemo: true, markOfficial: true, previewPath: "/previews/wan/" })).toBe(true);
    expect(shouldClearDemo({ isDemo: true, nextSlug: "20260917-wan", previewPath: "/previews/wan/" })).toBe(
      true,
    );
    expect(DEMO_SPECS[0]?.status).toBe("待审");
    expect(DEMO_SPECS[2]?.status).toBe("可推箱");
  });

  it("inserts three slots only when that Shanghai day is empty", async () => {
    const now = new Date("2099-06-01T04:00:00.000Z");
    const date = "2099-06-01";

    const first = await ensureTodayDemo(env, date, now);
    expect(first).toBe(true);

    const rows = (
      await env.DB.prepare(
        `SELECT id, slot, status, preview_path, is_demo FROM posts WHERE publish_date = ?`,
      )
        .bind(date)
        .all<{ id: string; slot: string; status: string; preview_path: string; is_demo: number }>()
    ).results;

    expect(rows).toHaveLength(3);
    const bySlot = Object.fromEntries(rows.map((row) => [row.slot, row]));
    expect(bySlot["早"]?.id).toBe("kdp-0601-zao");
    expect(bySlot["早"]?.status).toBe("待审");
    expect(bySlot["早"]?.preview_path).toBe("/previews/zao/");
    expect(bySlot["早"]?.is_demo).toBe(1);
    expect(bySlot["晚"]?.is_demo).toBe(1);
    expect(bySlot["中"]?.status).toBe("需改");
    expect(bySlot["晚"]?.status).toBe("可推箱");

    const second = await ensureTodayDemo(env, date, now);
    expect(second).toBe(false);

    const skipped = await ensureTodayDemo(env, date, new Date("2099-06-02T04:00:00.000Z"));
    expect(skipped).toBe(false);
  });

  it("does not re-seed after demos are released", async () => {
    const now = new Date("2099-07-01T04:00:00.000Z");
    const date = "2099-07-01";
    expect(await ensureTodayDemo(env, date, now)).toBe(true);

    await env.DB.prepare(`DELETE FROM posts WHERE publish_date = ?`).bind(date).run();
    expect(await ensureTodayDemo(env, date, now)).toBe(false);

    const rows = (
      await env.DB.prepare(`SELECT id FROM posts WHERE publish_date = ?`).bind(date).all<{ id: string }>()
    ).results;
    expect(rows).toHaveLength(0);
  });
});
