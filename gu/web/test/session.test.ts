import { afterEach, describe, expect, it, vi } from "vitest";

// Minimal DOM boundary: exercise the real entry point, fetch handling and route handlers.
async function mount(initial = "#overview", firstStatus = 200) {
  vi.resetModules();
  const app = { innerHTML: "", querySelectorAll: () => [] };
  const controls = new Map<string, any>();
  const listeners: Record<string, () => void> = {};
  vi.stubGlobal("document", {
    querySelectorAll: () => [],
    querySelector: (selector: string) => {
      if (selector === "#app") return app;
      if (["#history-date", "#search", "#kind", "#back-top"].includes(selector)) return null;
      if (!controls.has(selector)) controls.set(selector, { focus: vi.fn(), value: "123456" });
      return controls.get(selector);
    },
  });
  vi.stubGlobal("window", { addEventListener: (event: string, fn: () => void) => { listeners[event] = fn; }, scrollTo: vi.fn(), scrollY: 300 });
  vi.stubGlobal("sessionStorage", { getItem: () => null, setItem: vi.fn() });
  vi.stubGlobal("location", { hash: initial });
  vi.stubGlobal("history", { replaceState: vi.fn((_a, _b, url: string) => { location.hash = url.includes("#") ? url.slice(url.indexOf("#")) : ""; }) });
  const data = { account: [{ total_usd: 123456, warnings: "⚠️ 情绪疲劳锁：48 小时禁止卖出/调仓" }], positions: [], risk: [], market: [], reports: [] };
  const fetch = vi.fn(async (path: string) => path === "/api/me" ? Response.json({}) : firstStatus !== 200 ? Response.json({ error: "尚未同步数据" }, { status: firstStatus }) : Response.json({ batch_id: "one", data }));
  vi.stubGlobal("fetch", fetch);
  await import("../src/main");
  await vi.waitFor(() => expect(app.innerHTML).toContain(firstStatus === 200 ? "估算总资产" : "等待第一批投资数据"));
  return { app, controls, listeners, fetch, data };
}

afterEach(async () => {
  // Let independent calendar reads settle before removing the browser globals.
  await new Promise(done => setTimeout(done, 0));
  vi.unstubAllGlobals(); vi.restoreAllMocks();
});

describe("expired browser sessions", () => {
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
  it("keeps private report and warning amounts hidden across all routes", async () => {
    const { app, controls, listeners, data } = await mount();
    data.account[0].warnings += " / 月投后 12345 美元触发硬刹车";
    (data.reports as any[]).push({ id: "private", kind: "盘后复盘", date: "2026-10-15",
      headline: "组合当日约 +350 美元", action: "只观察", body: "# 账户 123456 美元", path: "reports/2026-10/private.md" });
    controls.get("#refresh")!.onclick!();
    await vi.waitFor(() => expect(app.innerHTML).toContain("12345 美元"));
    controls.get("#hide")!.onclick!();
    for (const hash of ["#overview", "#reports", "#reports/private", "#status"]) {
      location.hash = hash; listeners.hashchange();
      expect(app.innerHTML).not.toContain("+350 美元");
      expect(app.innerHTML).not.toContain("123456 美元");
      expect(app.innerHTML).not.toContain("12345 美元");
    }
    location.hash = "#overview"; listeners.hashchange();
    expect(app.innerHTML).toContain("48 小时");
    expect(app.innerHTML).toContain("暂停原定金额月投");
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
