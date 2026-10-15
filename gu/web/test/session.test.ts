import { afterEach, describe, expect, it, vi, type Mock } from "vitest";

// Minimal DOM boundary: exercise the real entry point, fetch handling and route handlers.
async function mount(initial = "#overview", firstStatus = 200, sso = false, legacyHide: string | null = null) {
  vi.resetModules();
  // Track chrome separately so we can rebuild app.innerHTML on demand:
  // session.test.ts 假设整个页面都在 #app 下，所以必须把 chrome + content + notice
  // 拼回同一个 innerHTML 才能继续断言正文里的关键字。
  let chrome = "";
  // 真实的属性 map，让 setAttribute / getAttribute 一致；默认 aria-busy="false"。
  const contentAttrs: Record<string, string> = { "aria-busy": "false" };
  const contentEl = {
    innerHTML: "",
    setAttribute: vi.fn((name: string, value: string) => { contentAttrs[name] = value; }),
    getAttribute: vi.fn((name: string) => contentAttrs[name] ?? null),
  };
  const refreshEl = { disabled: false, textContent: "刷新数据", setAttribute: vi.fn(), onclick: null };
  const noticeEl = { hidden: true, textContent: "", className: "", setAttribute: vi.fn() };
  const navLinks = new Map<string, { setAttribute: Mock; removeAttribute: Mock; getAttribute: Mock }>();
  const app = {
    set innerHTML(value: string) { chrome = value; },
    get innerHTML() {
      // Replace placeholders with current content + notice + 刷新按钮文本。
      const noticeTag = noticeEl.hidden ? "" :
        `<p id="notice" class="${noticeEl.className}" role="status" aria-live="polite">${noticeEl.textContent}</p>`;
      const refreshTag = refreshEl.disabled ? `<button id="refresh" title="重新读取网站已同步批次，不采集新行情" disabled>${refreshEl.textContent}</button>` : `<button id="refresh" title="重新读取网站已同步批次，不采集新行情">${refreshEl.textContent}</button>`;
      return chrome
        .replace(/<p id="notice"[^>]*>[\s\S]*?<\/p>/, noticeTag)
        .replace(/<button id="refresh"[^>]*>[\s\S]*?<\/button>/, refreshTag)
        .replace(/<main id="content"[^>]*>[\s\S]*?<\/main>/, `<main id="content" tabindex="-1" aria-busy="${contentEl.getAttribute("aria-busy")}">${contentEl.innerHTML}</main>`);
    },
    querySelectorAll: () => [],
  };
  const controls = new Map<string, any>();
  controls.set("#refresh", refreshEl);
  const listeners: Record<string, () => void> = {};
  vi.stubGlobal("document", {
    addEventListener: (event: string, fn: () => void) => { listeners[event] = fn; },
    visibilityState: "visible",
    querySelectorAll: (selector: string) => {
      if (selector === "[data-nav]") return [...navLinks.values()];
      return [];
    },
    querySelector: (selector: string) => {
      if (selector === "#app") return app;
      if (selector === "#content") return contentEl;
      if (selector === "#notice") return noticeEl;
      if (selector === "#refresh") return refreshEl;
      if (selector === "[data-nav]") return navLinks.values().next().value ?? null;
      if (["#history-date", "#search", "#kind", "#back-top"].includes(selector)) return null;
      if (selector.startsWith("#") && selector.includes("[data-nav=")) return null;
      if (!controls.has(selector)) controls.set(selector, { focus: vi.fn(), value: "123456" });
      return controls.get(selector);
    },
  });
  vi.stubGlobal("window", { addEventListener: (event: string, fn: () => void) => { listeners[event] = fn; }, scrollTo: vi.fn(), scrollY: 300 });
  const storage = new Map(legacyHide === null ? [] : [["gu-hide", legacyHide]]);
  vi.stubGlobal("sessionStorage", {
    getItem: vi.fn((key: string) => storage.get(key) ?? null),
    removeItem: vi.fn((key: string) => storage.delete(key)),
  });
  vi.stubGlobal("location", { hash: initial, search: "" });
  vi.stubGlobal("history", { replaceState: vi.fn((_a, _b, url: string) => { location.hash = url.includes("#") ? url.slice(url.indexOf("#")) : ""; }) });
  const data = { account: [{ total_usd: 123456, warnings: "⚠️ 情绪疲劳锁：48 小时禁止卖出/调仓" }], positions: [], risk: [], market: [], reports: [] };
  const fetch = vi.fn(async (path: string) => path === "/api/health" ? Response.json({ sso_enabled: sso })
    : path === "/api/me" ? Response.json({ authenticated: true }) : firstStatus !== 200 ? Response.json({ error: "尚未同步数据" }, { status: firstStatus }) : Response.json({ batch_id: "one", data }));
  vi.stubGlobal("fetch", fetch);
  await import("../src/main");
  const ready = firstStatus !== 200 ? "等待第一批投资数据"
    : initial.startsWith("#reports/") ? "未找到这份报告" : initial === "#positions" ? "当前持仓" : "估算总资产";
  await vi.waitFor(() => expect(app.innerHTML).toContain(ready));
  return { app, controls, listeners, fetch, data, storage };
}

afterEach(async () => {
  // Let independent calendar reads settle before removing the browser globals.
  await new Promise(done => setTimeout(done, 0));
  vi.unstubAllGlobals(); vi.restoreAllMocks();
});

describe("expired browser sessions", () => {
  it.each(["focus", "visibilitychange"])("clears a revoked SSO session on %s and keeps the report return link", async event => {
    const { app, listeners, fetch } = await mount("#reports/private", 200, true);
    fetch.mockResolvedValue(Response.json({ authenticated: false, authMode: "sso" }));
    listeners[event]();
    await vi.waitFor(() => expect(app.innerHTML).toContain("统一登录"));
    expect(app.innerHTML).toContain("/api/auth/login?return=%2F%23reports%2Fprivate");
    expect(app.innerHTML).not.toContain("发送验证码");
    expect(app.innerHTML).not.toContain("估算总资产");
  });
  it("retains the SSO login after a non-JSON 401 and does not call a legacy OTP route", async () => {
    const { app, controls, fetch } = await mount("#positions", 200, true);
    fetch.mockResolvedValue(new Response("expired", { status: 401 }));
    controls.get("#refresh")!.onclick!();
    await vi.waitFor(() => expect(app.innerHTML).toContain("统一登录"));
    expect(app.innerHTML).toContain("/api/auth/login?return=%2F%23positions");
    expect(fetch.mock.calls.some(([url]) => url.includes("request-otp"))).toBe(false);
  });
  it("preserves cached assets during an SSO service outage and retries successfully", async () => {
    const { app, controls, fetch, data } = await mount("#overview", 200, true);
    fetch.mockResolvedValue(Response.json({ error: "auth_unavailable" }, { status: 503 }));
    controls.get("#refresh")!.onclick!();
    await vi.waitFor(() => expect(app.innerHTML).toContain("刷新失败，仍展示上一批数据"));
    expect(app.innerHTML).toContain("估算总资产");
    expect(app.innerHTML).not.toContain("登录投资工作台");
    fetch.mockImplementation(async path => Response.json(path === "/api/me" ? { authenticated: true } : { batch_id: "two", data }));
    controls.get("#refresh")!.onclick!();
    await vi.waitFor(() => expect(app.innerHTML).toContain("已载入新同步批次"));
  });
  it.each(["/api/me", "/api/dashboard"])("clears cached assets after %s returns even a non-JSON 401", async path => {
    const { app, controls, listeners, fetch } = await mount();
    fetch.mockImplementation(async url => url === path
      ? new Response("Unauthorized", { status: 401 }) : Response.json({}));
    controls.get("#refresh")!.onclick!();
    await vi.waitFor(() => expect(app.innerHTML).toContain("登录投资工作台"));
    for (const hash of ["#overview", "#positions", "#reports", "#status"]) {
      location.hash = hash;
      listeners.hashchange();
      expect(app.innerHTML).toContain("登录投资工作台");
      expect(app.innerHTML).not.toContain("估算总资产");
      expect(app.innerHTML).not.toContain("情绪疲劳锁");
    }
  });

  it("deduplicates refreshes and discards a pending dashboard response after logout", async () => {
    const { app, controls, listeners, fetch, data } = await mount();
    let resolve!: (value: Response) => void;
    fetch.mockImplementation(async path => ["/api/me", "/api/auth/logout"].includes(path) ? Response.json({})
      : new Promise<Response>(done => { resolve = done; }));
    controls.get("#refresh")!.onclick!();
    await vi.waitFor(() => expect(resolve).toBeTypeOf("function"));
    const count = fetch.mock.calls.length;
    controls.get("#refresh")!.onclick!();
    expect(fetch.mock.calls.length).toBe(count);
    await controls.get("#logout")!.onclick!();
    await vi.waitFor(() => expect(app.innerHTML).toContain("登录投资工作台"));
    resolve(Response.json({ data }));
    await new Promise(done => setTimeout(done, 0));
    listeners.hashchange();
    expect(app.innerHTML).toContain("登录投资工作台");
    expect(app.innerHTML).not.toContain("估算总资产");
  });
});

describe("empty and failed data", () => {
  it("renders refresh progress and unchanged-batch feedback without concurrent requests", async () => {
    const { app, controls, fetch, data } = await mount();
    let complete!: (value: Response) => void;
    fetch.mockImplementation(async path => path === "/api/me" ? Response.json({})
      : new Promise<Response>(resolve => { complete = resolve; }));
    controls.get("#refresh")!.onclick!();
    expect(app.innerHTML).toContain("刷新中…");
    expect(app.innerHTML).toContain('aria-busy="true"');
    await vi.waitFor(() => expect(complete).toBeTypeOf("function"));
    complete(Response.json({ batch_id: "one", data }));
    await vi.waitFor(() => expect(app.innerHTML).toContain("当前已是最新同步批次"));
    expect(app.innerHTML).toContain('aria-busy="false"');
  });
  it.each([null, "1"])("always displays complete data across routes with legacy hide preference %s", async legacyHide => {
    const { app, controls, listeners, data, storage } = await mount("#overview", 200, true, legacyHide);
    expect(storage.has("gu-hide")).toBe(false);
    expect(sessionStorage.getItem).not.toHaveBeenCalled();
    data.account[0].warnings += " / 月投后 12345 美元触发硬刹车";
    (data.positions as any[]).push({ ticker: "NVDA", shares: 214.6206, price: 170.25, avg_cost: 160, value_usd: 36539.156, weight_raw: .065, target: .065 });
    (data.risk as any[]).push({ item: "NVDA", kind: "价格", current_value: 170.25, current_unit: "USD", threshold: "< 160 美元", action: "不得新开定投", triggered: false, proximity: "near", distance: .064 });
    (data.reports as any[]).push({ id: "private", kind: "盘后复盘", date: "2026-10-15",
      headline: "组合当日约 +350 美元", action: "只观察", body: "# 账户 123456 美元\n## 持仓 214.6206 股\n[来源](https://example.com/123456)\n## 记录", path: "reports/2026-10/private.md" });
    controls.get("#refresh")!.onclick!();
    await vi.waitFor(() => expect(app.innerHTML).toContain("12345 美元"));
    for (const hash of ["#overview", "#positions", "#reports", "#reports/private", "#status"]) {
      location.hash = hash; listeners.hashchange();
      expect(app.innerHTML).not.toMatch(/id="hide"|显示金额|隐藏金额|隐私模式|摘要已隐藏|原始记录路径已隐藏/);
      expect(app.innerHTML).toContain('id="refresh"');
      expect(app.innerHTML).toContain('id="logout"');
      if (hash === "#overview") {
        expect(app.innerHTML).toContain("12.35 万");
        expect(app.innerHTML).toContain("+350 美元");
        expect(app.innerHTML).toContain("12345 美元");
      } else if (hash === "#positions") {
        expect(app.innerHTML).toContain("214.6206");
        expect(app.innerHTML).toContain("170.25");
        expect(app.innerHTML).toContain("160 美元");
        expect(app.innerHTML).toContain("3.65 万");
      } else if (hash === "#reports") {
        expect(app.innerHTML).toContain("+350 美元");
      } else if (hash === "#reports/private") {
        expect(app.innerHTML).toContain("123456 美元");
        expect(app.innerHTML).toContain("214.6206 股");
        expect(app.innerHTML).toContain('href="https://example.com/123456"');
        expect(app.innerHTML).toContain("reports/2026-10/private.md");
        expect(app.innerHTML).toContain("章节目录 · 3 节");
      } else {
        expect(app.innerHTML).toContain("12345 美元");
      }
    }
  });
  it("keeps valid sessions in the empty state during navigation", async () => {
    const { app, listeners } = await mount("#reports", 404);
    location.hash = "#positions"; listeners.hashchange();
    expect(app.innerHTML).toContain("等待第一批投资数据");
    expect(app.innerHTML).not.toContain("登录投资工作台");
  });
  it.each(["offline", "html", "server"])("persists %s failure with cached batch across routes, then recovers", async mode => {
    const { app, controls, listeners, fetch, data } = await mount();
    fetch.mockImplementation(async () => {
      if (mode === "offline") throw new TypeError("Failed to fetch");
      return mode === "html" ? new Response("<html>bad gateway</html>", { status: 502 }) : Response.json({ error: "server" }, { status: 500 });
    });
    controls.get("#refresh")!.onclick!();
    await vi.waitFor(() => expect(app.innerHTML).toContain("刷新失败，仍展示上一批数据"));
    location.hash = "#status"; listeners.hashchange();
    expect(app.innerHTML).toContain("刷新失败，仍展示上一批数据");
    fetch.mockImplementation(async path => Response.json(path === "/api/me" ? {} : { batch_id: "one", data }));
    controls.get("#refresh")!.onclick!();
    await vi.waitFor(() => expect(app.innerHTML).toContain("当前已是最新同步批次"));
    expect(app.innerHTML).not.toContain("刷新失败");
  });
  it("restores a report deep link after reauthentication", async () => {
    const { app, controls, fetch } = await mount();
    location.hash = "#reports/test";
    fetch.mockResolvedValue(new Response("expired", { status: 401 }));
    controls.get("#refresh")!.onclick!();
    await vi.waitFor(() => expect(app.innerHTML).toContain("登录投资工作台"));
    fetch.mockImplementation(async path => Response.json(path === "/api/dashboard" ? { data: { account: [{}], positions: [], risk: [], market: [], reports: [{ id: "test", kind: "盘后复盘", body: "# 测试正文", date: "2026-10-15" }] } } : {}));
    await controls.get("#verify")!.onsubmit({ preventDefault() {} });
    expect(location.hash).toBe("#reports/test");
    expect(app.innerHTML).toContain("测试正文");
  });
});
