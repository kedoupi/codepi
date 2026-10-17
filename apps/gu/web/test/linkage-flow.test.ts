import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, screen } from "@testing-library/svelte";
import { mountApp, resetClientState, stubFetch } from "./helpers";

beforeEach(() => {
  resetClientState();
  // jsdom 未实现的布局 API：联动高亮依赖这两个边界。
  Element.prototype.scrollIntoView = vi.fn();
  (Element.prototype as unknown as { getClientRects: () => DOMRectList }).getClientRects = () =>
    ({ length: 1 }) as unknown as DOMRectList;
});

afterEach(async () => {
  cleanup();
  await new Promise((done) => setTimeout(done, 0));
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("chart to position linkage", () => {
  it("highlights the matching position row and card after switching to positions", async () => {
    stubFetch({ sso: true });
    mountApp("#overview");
    await screen.findByText("资产构成 · 估算总资产");
    const legend = document.querySelector<HTMLElement>(
      ".composition-legend-item[data-position='GOOGL']",
    )!;
    legend.click();
    await screen.findByText("当前持仓");
    expect(location.hash).toBe("#positions");
    await vi.waitFor(() => {
      const row = document.querySelector("tr.position-row[data-position='GOOGL']")!;
      const card = document.querySelector("article.position-card[data-position='GOOGL']")!;
      expect(row.classList.contains("is-active")).toBe(true);
      expect(card.classList.contains("is-active")).toBe(true);
    });
    expect(
      (Element.prototype.scrollIntoView as ReturnType<typeof vi.fn>).mock.calls.length,
    ).toBeGreaterThan(0);
  });

  it("highlights directly when already on the positions page (no hashchange)", async () => {
    stubFetch({ sso: true });
    mountApp("#positions");
    await screen.findByText("当前持仓");
    // 通过全局状态直接打标，等价于总览图表点击后已在持仓页的路径。
    const { session } = await import("../src/lib/state.svelte");
    const { consumePendingPositionFocus } = await import("../src/lib/focus");
    session.pendingPositionFocus = "GOOGL";
    consumePendingPositionFocus();
    const row = document.querySelector("tr.position-row[data-position='GOOGL']")!;
    expect(row.classList.contains("is-active")).toBe(true);
    expect(session.pendingPositionFocus).toBeNull();
  });

  it("keeps the highlight for a few seconds, then fades it out", async () => {
    const { focusPositionRow } = await import("../src/lib/focus");
    stubFetch({ sso: true });
    mountApp("#positions");
    await screen.findByText("当前持仓");
    // 挂载走真实时钟，接管时钟后再触发高亮，保证那枚计时器完全受控。
    vi.useFakeTimers();
    try {
      focusPositionRow("GOOGL");
      const row = () => document.querySelector("tr.position-row[data-position='GOOGL']")!;
      expect(row().classList.contains("is-active")).toBe(true);
      vi.advanceTimersByTime(6000 - 1);
      expect(row().classList.contains("is-active")).toBe(true);
      expect(row().classList.contains("is-fading")).toBe(false);
      vi.advanceTimersByTime(1); // 6 秒整：开始淡出
      expect(row().classList.contains("is-fading")).toBe(true);
      expect(row().classList.contains("is-active")).toBe(true);
      vi.advanceTimersByTime(600); // 淡出结束：两个 class 一起摘掉
      expect(row().classList.contains("is-active")).toBe(false);
      expect(row().classList.contains("is-fading")).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });
});
