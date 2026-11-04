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
    subject_device_ids: [],
    device_candidates: [
      { device_id: "dev-a", vendor: "示例厂商", name: "示例手机", room: "示例位置" },
      { device_id: "dev-b", vendor: null, name: null, room: null },
    ],
    app_categories: { 示例编辑器: "开发" },
    other_network_names: {},
    anomaly_thresholds: { early_late_minutes: 40, commute_percent: 50 },
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
  it("选择手机、加 App 归类、改阈值后保存成功", async () => {
    const calls = stub(body => response(settings({
      subject_device_ids: body.subject_device_ids,
      app_categories: body.app_categories,
      anomaly_thresholds: body.anomaly_thresholds,
      pending_recompute_days: { days: 3, from: "2026-11-01", to: "2026-11-03" },
    })));
    render(App);
    await fireEvent.click(await screen.findByRole("checkbox", { name: /示例手机/ }));
    expect(screen.getByText("未命名设备")).toBeTruthy();
    await fireEvent.click(screen.getByRole("button", { name: "添加 App" }));
    const names = screen.getAllByRole("textbox", { name: "App 名" });
    await fireEvent.input(names.at(-1)!, { target: { value: "示例沟通" } });
    const categories = screen.getAllByRole("combobox", { name: "类别" });
    await fireEvent.change(categories.at(-1)!, { target: { value: "沟通" } });
    await fireEvent.input(screen.getByRole("spinbutton", { name: /早或晚至少/ }), { target: { value: "45" } });
    await fireEvent.click(screen.getByRole("button", { name: "保存设置" }));
    expect(await screen.findByText("已保存。")).toBeTruthy();
    const put = calls.find(call => call.method === "PUT")!;
    expect(put.body).toEqual({
      subject_device_ids: ["dev-a"],
      app_categories: { 示例编辑器: "开发", 示例沟通: "沟通" },
      other_network_names: {},
      anomaly_thresholds: { early_late_minutes: 45, commute_percent: 50 },
    });
    expect(screen.getByText("有 3 天需要重算")).toBeTruthy();
  });

  it("后端拒收时显示错误，不显示已保存", async () => {
    stub(() => response({ error: "invalid_settings" }, 400));
    render(App);
    await screen.findByRole("heading", { name: "本人手机" });
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
