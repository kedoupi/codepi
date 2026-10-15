import { afterEach, describe, expect, it, vi } from "vitest";

type Fake = {
  tag: string; dataPosition: string; classes: Set<string>;
  classList: { add(c: string): void; remove(c: string): void; contains(c: string): boolean };
  dataset: Record<string, string>;
  onclick: null | (() => void);
  visible: boolean; scrolled: number;
  getClientRects(): unknown[];
  scrollIntoView(): void;
};

function makeFake(tag: string, dataPosition: string, visible: boolean): Fake {
  const classes = new Set<string>([
    tag === "tr" ? "position-row" : "position-card",
    tag === "button" ? "composition-legend-item" : "",
  ].filter(Boolean));
  const el: Fake = {
    tag, dataPosition, classes, visible, scrolled: 0,
    classList: {
      add: (c: string) => { classes.add(c); },
      remove: (c: string) => { classes.delete(c); },
      contains: (c: string) => classes.has(c),
    },
    dataset: { position: dataPosition },
    onclick: null,
    getClientRects: () => (el.visible ? [{}] : []),
    scrollIntoView: () => { el.scrolled++; },
  };
  return el;
}

/**
 * 走真实路径：点总览图例 → 改 hash → hashchange 重绘持仓页 → 打标高亮。
 * registry 随 innerHTML 重建，模拟真实 DOM 重绘；requestAnimationFrame 故意
 * 不同步执行，用来证明实现不依赖 rAF 与 hashchange 的先后顺序。
 */
async function mountOverview(visible: "desktop" | "mobile") {
  vi.resetModules();
  let chrome = "";
  let registry: Fake[] = [];
  const rafQueue: (() => void)[] = [];
  const html_ = { value: "" };
  const contentEl = {
    focus: vi.fn(),
    set innerHTML(value: string) {
      html_.value = value;
      // 重绘 = 全新节点。只有当前可见视图的 scrollIntoView 才算数。
      const rows = [...value.matchAll(/data-position="([^"]+)"/g)].map((m, i) => {
        const isDesktopRow = i % 2 === 0;
        return makeFake(isDesktopRow ? "tr" : "article", m[1],
          visible === "desktop" ? isDesktopRow : !isDesktopRow);
      });
      const legend = [...value.matchAll(/class="composition-legend-item" data-position="([^"]+)"/g)]
        .map((m) => makeFake("button", m[1], true));
      registry = [...rows, ...legend];
    },
    get innerHTML() { return html_.value; },
    setAttribute: vi.fn(), getAttribute: vi.fn(() => "false"),
  };
  const app = {
    set innerHTML(v: string) { chrome = v; },
    get innerHTML() {
      return chrome.replace(/<main id="content"[^>]*>[\s\S]*?<\/main>/,
        `<main id="content" tabindex="-1" aria-busy="false">${contentEl.innerHTML}</main>`);
    },
    querySelectorAll: () => [],
  };
  const controls = new Map<string, unknown>();
  const listeners: Record<string, () => void> = {};
  // 故意异步：模拟浏览器里 rAF 在 hashchange 任务之后才跑。
  vi.stubGlobal("requestAnimationFrame", (fn: () => void) => { rafQueue.push(fn); return rafQueue.length; });
  vi.stubGlobal("document", {
    addEventListener: (e: string, fn: () => void) => { listeners[e] = fn; },
    visibilityState: "visible",
    querySelectorAll: (selector: string) => {
      if (selector.includes("composition-segment") || selector.includes("composition-legend-item"))
        return registry.filter(el => el.classes.has("composition-legend-item") || el.classes.has("composition-segment"));
      if (selector === ".is-active") return registry.filter(el => el.classes.has("is-active"));
      if (selector.startsWith("[data-position=")) {
        const want = selector.match(/data-position="([^"]+)"/)![1];
        return registry.filter(el => el.dataPosition === want);
      }
      return [];
    },
    querySelector: (selector: string) => {
      if (selector === "#app") return app;
      if (selector === "#content") return contentEl;
      if (["#history-date", "#search", "#kind", "#back-top"].includes(selector)) return null;
      if (!controls.has(selector)) controls.set(selector, { focus: vi.fn(), value: "" });
      return controls.get(selector);
    },
  });
  vi.stubGlobal("window", {
    addEventListener: (e: string, fn: () => void) => { listeners[e] = fn; },
    scrollTo: vi.fn(), scrollY: 0,
  });
  vi.stubGlobal("sessionStorage", { getItem: vi.fn(() => null), removeItem: vi.fn(), setItem: vi.fn() });
  vi.stubGlobal("location", { hash: "#overview", search: "" });
  vi.stubGlobal("history", { replaceState: vi.fn() });
  const data = {
    account: [{ framework: "v4.2", holdings_as_of: "2026-09-16", cash_as_of: "2026-09-16",
      total_usd: 572300, cash_usd: 400200, stocks_usd: 172100, hk_usd: 0, cash_age_days: 29,
      generated_at: "2026-10-15T02:21:00Z", dca_amount_usd: 20000, cash_after_dca_raw: 0.664,
      cash_weight_raw: 0.699, warnings: "", quote_date: "2026-10-14" }],
    positions: [{ ticker: "GOOGL", name: "Alphabet", shares: 214.6206, avg_cost: 302.86, price: 347.64,
      value_usd: 74600, pnl_pct: 0.148, weight_raw: 0.13, target: 0.135 }],
    risk: [], market: [], reports: [],
  };
  vi.stubGlobal("fetch", vi.fn(async (path: string) =>
    path === "/api/health" ? Response.json({ sso_enabled: true })
    : path === "/api/me" ? Response.json({ authenticated: true })
    : path === "/api/calendar" ? Response.json({ state: "not_connected" })
    : Response.json({ batch_id: "one", data })));
  await import("../src/main");
  await vi.waitFor(() => expect(contentEl.innerHTML).toContain("资产构成"));
  return {
    getRegistry: () => registry,
    listeners,
    flushRaf: () => { while (rafQueue.length) rafQueue.shift()!(); },
    clickLegend: () => {
      const btn = registry.find(el => el.classes.has("composition-legend-item"))!;
      btn.onclick!();
    },
  };
}

afterEach(async () => {
  await new Promise(done => setTimeout(done, 0));
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe.each(["desktop", "mobile"] as const)("chart to position linkage on %s", viewport => {
  it("highlights the matching position after the positions page re-renders", async () => {
    const { clickLegend, listeners, getRegistry, flushRaf } = await mountOverview(viewport);
    clickLegend();
    // 跨页：hashchange 触发重绘。重绘内部就会打标，不等 rAF。
    listeners.hashchange();
    flushRaf();

    const rows = getRegistry().filter(el => el.classes.has("position-row") || el.classes.has("position-card"));
    expect(rows.length).toBe(2); // 桌面行 + 移动卡片都带 data-position
    expect(rows.every(el => el.classes.has("is-active"))).toBe(true);
    const visible = rows.filter(el => el.visible);
    const hidden = rows.filter(el => !el.visible);
    expect(visible.some(el => el.scrolled === 1)).toBe(true);
    expect(hidden.every(el => el.scrolled === 0)).toBe(true);
  });

  it("keeps the highlight instead of clearing it on a timer", async () => {
    const { clickLegend, listeners, getRegistry, flushRaf } = await mountOverview(viewport);
    clickLegend();
    listeners.hashchange();
    flushRaf();
    expect(getRegistry().some(el => el.classes.has("is-active"))).toBe(true);

    await new Promise(done => setTimeout(done, 60)); // 远超旧的 2.4s 语义窗口的量级
    expect(getRegistry().some(el => el.classes.has("is-active"))).toBe(true);
  });
});

describe("clicking a position row on the positions page does not re-trigger the jump", () => {
  it("never binds the jump handler to rows or cards", async () => {
    const { clickLegend, listeners, getRegistry, flushRaf } = await mountOverview("desktop");
    clickLegend();
    listeners.hashchange();
    flushRaf();
    const rows = getRegistry().filter(el => el.classes.has("position-row") || el.classes.has("position-card"));
    expect(rows.every(el => el.onclick === null)).toBe(true);
  });
});
