import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

/**
 * 最小 DOM 桩：让 render() 能在 vi 里跑起来并触发 mountChrome + renderContent。
 * 重点是 contentEl.innerHTML 被替换的次数，用来断言「同批次不重绘正文」。
 */
async function mount(initial = "#overview", batchId = "one") {
  vi.resetModules();
  let chrome = "";
  let contentInner = "";
  let renderContentCalls = 0;
  const contentEl = {
    focus: vi.fn(),
    get innerHTML() {
      return contentInner;
    },
    set innerHTML(v: string) {
      renderContentCalls++;
      contentInner = v;
    },
    setAttribute: vi.fn(),
    getAttribute: vi.fn(() => "false"),
  };
  const noticeEl = {
    hidden: true,
    textContent: "",
    className: "",
    setAttribute: vi.fn(),
  };
  const refreshEl = { disabled: false, textContent: "刷新数据", onclick: null };
  const logoutEl = { onclick: null };
  const app = {
    set innerHTML(v: string) {
      chrome = v;
    },
    get innerHTML() {
      return chrome;
    },
    querySelectorAll: () => [],
  };
  const listeners: Record<string, () => void> = {};
  vi.stubGlobal("document", {
    addEventListener: (e: string, fn: () => void) => {
      listeners[e] = fn;
    },
    visibilityState: "visible",
    querySelectorAll: () => [],
    querySelector: (sel: string) => {
      if (sel === "#app") return app;
      if (sel === "#content") return contentEl;
      if (sel === "#notice") return noticeEl;
      if (sel === "#refresh") return refreshEl;
      if (sel === "#logout") return logoutEl;
      return null;
    },
  });
  vi.stubGlobal("window", {
    addEventListener: (e: string, fn: () => void) => {
      listeners[e] = fn;
    },
    scrollTo: vi.fn(),
  });
  vi.stubGlobal("sessionStorage", { removeItem: vi.fn() });
  vi.stubGlobal("location", { hash: initial, search: "" });
  vi.stubGlobal("history", { replaceState: vi.fn() });
  const data = {
    account: [{ total_usd: 1, warnings: "", holdings_as_of: "2026-10-15" }],
    positions: [],
    risk: [],
    market: [],
    reports: [],
  };
  const fetch = vi.fn(async (path: string) =>
    path === "/api/health"
      ? Response.json({ sso_enabled: false })
      : path === "/api/me"
        ? Response.json({ authenticated: true })
        : Response.json({ batch_id: batchId, data }),
  );
  vi.stubGlobal("fetch", fetch);
  await import("../src/main");
  await vi.waitFor(() => expect(contentInner).toContain("估算总资产"));
  return {
    app,
    listeners,
    fetch,
    data,
    getContent: () => contentEl,
    getContentCalls: () => renderContentCalls,
  };
}

describe("stable render shell", () => {
  it("does not redraw the body when the hashchange points to the same page", async () => {
    const { listeners, getContentCalls } = await mount("#overview");
    const baseline = getContentCalls();
    listeners.hashchange();
    listeners.hashchange();
    expect(getContentCalls()).toBe(baseline);
  });

  it("redraws the body when the hashchange switches pages", async () => {
    const { listeners, getContentCalls } = await mount("#overview");
    const baseline = getContentCalls();
    location.hash = "#status";
    listeners.hashchange();
    expect(getContentCalls()).toBeGreaterThan(baseline);
  });

  it("mounts the chrome exactly once across many render calls", async () => {
    const { app, listeners, getContentCalls } = await mount("#overview");
    const beforeChrome = app.innerHTML;
    location.hash = "#positions";
    listeners.hashchange();
    location.hash = "#overview";
    listeners.hashchange();
    location.hash = "#status";
    listeners.hashchange();
    // chrome 模板不变；只有 #content 替换
    expect(app.innerHTML).toBe(beforeChrome);
    // contentInner 被多次重写是因为页面切换，符合预期
    expect(getContentCalls()).toBeGreaterThan(0);
  });

  it("keeps the notice as a persistent node, not part of #content", async () => {
    const { getContent, listeners } = await mount("#overview");
    const content = getContent();
    expect(content.innerHTML).not.toContain("data-status");
    // 直接触发 hashchange 不应改 content innerHTML（只有页面切换才会改）
    const before = content.innerHTML.length;
    listeners.hashchange();
    expect(content.innerHTML.length).toBe(before);
  });
});
