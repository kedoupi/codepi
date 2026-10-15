import { afterEach, describe, expect, it, vi } from "vitest";

// Minimal DOM boundary: exercise the real entry point, fetch handling and route handlers.
async function mount() {
  vi.resetModules();
  const app = { innerHTML: "", querySelectorAll: () => [] };
  const controls = new Map<string, { onclick?: () => unknown }>();
  const listeners: Record<string, () => void> = {};
  vi.stubGlobal("document", {
    querySelector: (selector: string) => {
      if (selector === "#app") return app;
      if (["#history-date", "#search", "#kind"].includes(selector)) return null;
      if (!controls.has(selector)) controls.set(selector, {});
      return controls.get(selector);
    },
  });
  vi.stubGlobal("window", { addEventListener: (event: string, fn: () => void) => { listeners[event] = fn; }, scrollTo: () => {} });
  vi.stubGlobal("sessionStorage", { getItem: () => null });
  vi.stubGlobal("location", { hash: "#overview" });
  vi.stubGlobal("history", { replaceState: () => {} });
  const data = { account: [{ total_usd: 123456, warnings: "⚠️ 情绪疲劳锁：48 小时禁止卖出/调仓" }], positions: [], risk: [], market: [], reports: [] };
  const fetch = vi.fn(async (path: string) => Response.json(path === "/api/me" ? {} : { data }));
  vi.stubGlobal("fetch", fetch);
  await import("../src/main");
  await vi.waitFor(() => expect(app.innerHTML).toContain("估算总资产"));
  expect(app.innerHTML).toContain("情绪疲劳锁");
  return { app, controls, listeners, fetch, data };
}

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

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

  it("discards a pending dashboard response after another refresh expires", async () => {
    const { app, controls, listeners, fetch, data } = await mount();
    let resolve!: (value: Response) => void;
    fetch.mockImplementation(async path => path === "/api/me" ? Response.json({})
      : new Promise<Response>(done => { resolve = done; }));
    controls.get("#refresh")!.onclick!();
    await vi.waitFor(() => expect(resolve).toBeTypeOf("function"));
    fetch.mockResolvedValue(new Response("", { status: 401 }));
    controls.get("#refresh")!.onclick!();
    await vi.waitFor(() => expect(app.innerHTML).toContain("登录投资工作台"));
    resolve(Response.json({ data }));
    await new Promise(done => setTimeout(done, 0));
    listeners.hashchange();
    expect(app.innerHTML).toContain("登录投资工作台");
    expect(app.innerHTML).not.toContain("估算总资产");
  });
});
