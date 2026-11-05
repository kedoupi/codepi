/**
 * @vitest-environment jsdom
 * @vitest-environment-options { "url": "https://rhythm.test/settings" }
 */
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/svelte";
import { afterEach, describe, expect, it, vi } from "vitest";
import App from "../src/App.svelte";

function response(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

function settings(overrides: Record<string, unknown> = {}) {
  return {
    pending_recompute_days: { days: 0, from: null, to: null },
    app_categories: { 示例编辑器: "AI 编程" },
    other_network_names: {},
    ...overrides,
  };
}

type Call = { path: string; method: string; body: unknown };

function stub(put: (body: Record<string, unknown>) => Response, initial = settings()) {
  const calls: Call[] = [];
  vi.stubGlobal("fetch", vi.fn(async (input: unknown, init?: RequestInit) => {
    const path = String(input);
    const method = init?.method ?? "GET";
    const body = typeof init?.body === "string" ? JSON.parse(init.body) : undefined;
    calls.push({ path, method, body });
    if (path === "/api/me") return response({ authenticated: true });
    if (path === "/api/settings" && method === "GET") return response(initial);
    if (path === "/api/settings" && method === "PUT") return put(body);
    if (path.startsWith("/api/admin/recompute")) return response({ days_recomputed: 7 });
    throw new Error(`unexpected request: ${method} ${path}`);
  }));
  return calls;
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("Rhythm 设置页", () => {
  it("添加 App 归类后只提交归类和网络设置", async () => {
    const calls = stub(body => response(settings({
      app_categories: body.app_categories,
      other_network_names: body.other_network_names,
      pending_recompute_days: { days: 3, from: "2026-11-01", to: "2026-11-03" },
    })), settings({ app_minutes_7d: { 示例编辑器: 77 } }));
    render(App);
    expect(await screen.findByText("近 7 天 1时17分")).toBeTruthy();
    expect(screen.queryByText("本人手机")).toBeNull();
    expect(screen.queryByText("和平时不一样的门槛")).toBeNull();
    await fireEvent.click(await screen.findByRole("button", { name: "添加 App" }));
    const names = screen.getAllByRole("textbox", { name: "App 名" });
    await fireEvent.input(names.at(-1)!, { target: { value: "示例对话" } });
    const categories = screen.getAllByRole("combobox", { name: "类别" });
    await fireEvent.change(categories.at(-1)!, { target: { value: "AI 对话" } });
    await fireEvent.click(screen.getByRole("button", { name: "保存设置" }));
    expect(await screen.findByText("已保存。")).toBeTruthy();
    const put = calls.find(call => call.method === "PUT")!;
    expect(put.body).toEqual({
      app_categories: { 示例编辑器: "AI 编程", 示例对话: "AI 对话" },
      other_network_names: {},
    });
    expect(screen.getByText("有 3 天需要重算")).toBeTruthy();
  });

  it("后端拒收时显示错误，不显示已保存", async () => {
    stub(() => response({ error: "invalid_settings" }, 400));
    render(App);
    await screen.findByRole("heading", { name: "App 归类" });
    await fireEvent.click(screen.getByRole("button", { name: "保存设置" }));
    expect(await screen.findByRole("alert")).toBeTruthy();
    expect(screen.getByRole("alert").textContent).toContain("设置没有保存");
    expect(screen.queryByText("已保存。")).toBeNull();
  });

  it("没填完整的行在页面上就拦下，不发请求", async () => {
    const calls = stub(() => response(settings()));
    render(App);
    await fireEvent.click(await screen.findByRole("button", { name: "添加网络" }));
    await fireEvent.input(screen.getByRole("textbox", { name: "网络标识" }), { target: { value: "net-x" } });
    await fireEvent.click(screen.getByRole("button", { name: "保存设置" }));
    expect((await screen.findByRole("alert")).textContent).toContain("网络改名有一行没填完整");
    expect(calls.some(call => call.method === "PUT")).toBe(false);
  });

  it("待重算日子按 7 天一段依次重算", async () => {
    const calls = stub(() => response(settings()), settings({ pending_recompute_days: { days: 10, from: "2026-10-20", to: "2026-10-29" } }));
    render(App);
    await fireEvent.click(await screen.findByRole("button", { name: "重算这些日子" }));
    await waitFor(() => expect(screen.getByText("已重算 14 天。")).toBeTruthy());
    expect(calls.filter(call => call.method === "POST").map(call => call.path)).toEqual([
      "/api/admin/recompute?from=2026-10-20&to=2026-10-26",
      "/api/admin/recompute?from=2026-10-27&to=2026-10-29",
    ]);
  });
});
