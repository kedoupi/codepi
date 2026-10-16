import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * 图表 → 持仓联动。移动端在 <=900px 隐藏表格、显示 position-card，所以两个视图
 * 都必须能被同一套 [data-position] 选择器命中，否则高亮落在隐藏节点上等于无效。
 */
async function mountPositions() {
  vi.resetModules();
  let chrome = "";
  const contentEl = { focus: vi.fn(), innerHTML: "", setAttribute: vi.fn(), getAttribute: vi.fn(() => "false") };
  const app = {
    set innerHTML(value: string) { chrome = value; },
    get innerHTML() {
      return chrome.replace(
        /<main id="content"[^>]*>[\s\S]*?<\/main>/,
        `<main id="content" tabindex="-1" aria-busy="false">${contentEl.innerHTML}</main>`,
      );
    },
    querySelectorAll: () => [],
  };
  const controls = new Map<string, any>();
  const listeners: Record<string, () => void> = {};
  vi.stubGlobal("document", {
    addEventListener: (event: string, fn: () => void) => { listeners[event] = fn; },
    visibilityState: "visible",
    querySelectorAll: () => [],
    querySelector: (selector: string) => {
      if (selector === "#app") return app;
      if (selector === "#content") return contentEl;
      if (["#history-date", "#search", "#kind", "#back-top"].includes(selector)) return null;
      if (!controls.has(selector)) controls.set(selector, { focus: vi.fn(), value: "123456" });
      return controls.get(selector);
    },
  });
  vi.stubGlobal("window", {
    addEventListener: (event: string, fn: () => void) => { listeners[event] = fn; },
    scrollTo: vi.fn(), scrollY: 0,
  });
  vi.stubGlobal("sessionStorage", { getItem: vi.fn(() => null), removeItem: vi.fn(), setItem: vi.fn() });
  vi.stubGlobal("location", { hash: "#positions", search: "" });
  vi.stubGlobal("history", { replaceState: vi.fn() });
  const data = {
    account: [{ framework: "v4.2", holdings_as_of: "2026-09-16", cash_as_of: "2026-09-16", total_usd: 572300, cash_usd: 400200, stocks_usd: 172100, hk_usd: 0, cash_age_days: 29, generated_at: "2026-10-15T02:21:00Z", dca_amount_usd: 20000, cash_after_dca_raw: 0.664, cash_weight_raw: 0.699, warnings: "", quote_date: "2026-10-14" }],
    positions: [
      { ticker: "GOOGL", name: "Alphabet Class A", shares: 214.6206, avg_cost: 302.86, price: 347.64, value_usd: 74600, pnl_pct: 0.148, weight_raw: 0.13, target: 0.135 },
      { ticker: "现金", name: "现金 / 货币基金", shares: null, avg_cost: null, price: null, value_usd: 400200, pnl_pct: null, weight_raw: 0.699, target: 0.14 },
    ],
    risk: [], market: [], reports: [],
  };
  const fetch = vi.fn(async (path: string) =>
    path === "/api/health" ? Response.json({ sso_enabled: true })
    : path === "/api/me" ? Response.json({ authenticated: true })
    : Response.json({ batch_id: "one", data }));
  vi.stubGlobal("fetch", fetch);
  await import("../src/main");
  await vi.waitFor(() => expect(contentEl.innerHTML).toContain("当前持仓"));
  return { contentEl, listeners, app };
}

afterEach(async () => {
  await new Promise(done => setTimeout(done, 0));
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("chart to position linkage targets", () => {
  it("marks both the desktop row and the mobile card with the same anchor and data-position", async () => {
    const { contentEl } = await mountPositions();
    const html = contentEl.innerHTML;
    // 桌面表格行
    expect(html).toMatch(/<tr[^>]*id="position-anchor-GOOGL"[^>]*class="position-row"[^>]*data-position="GOOGL"/);
    // 移动端卡片（<=900px 才显示）必须能被同一个选择器命中
    expect(html).toMatch(/<article[^>]*id="position-anchor-GOOGL"[^>]*class="position-card"[^>]*data-position="GOOGL"/);
    expect(html).toMatch(/<article[^>]*data-position="现金"/);
  });

  it("does not attach the jump handler to the position rows themselves", async () => {
    const { contentEl } = await mountPositions();
    // 持仓页自身不应有可点击跳转的 data-position 图表节点
    expect(contentEl.innerHTML).not.toContain("composition-legend-item");
    expect(contentEl.innerHTML).not.toContain("composition-segment");
  });
});
