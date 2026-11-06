// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/svelte";
import { afterEach, describe, expect, it, vi } from "vitest";
import Today from "../src/components/Today.svelte";

const tasks = [
  { project: "alpha", key: "a", title: "选择示例方案", status: "decide", category: "流程", need_kind: "decide", due: "2026-11-06", done_at: null },
  { project: "alpha", key: "b", title: "修复示例缺陷", status: "bug", category: "网关", need_kind: "none", due: "2026-11-14", done_at: null },
  { project: "alpha", key: "c", title: "确认示例设置", status: "verify", category: "流程", need_kind: "confirm", due: "2026-11-10", done_at: null },
  { project: "alpha", key: "d", title: "逾期示例", status: "doing", category: "流程", need_kind: "none", due: "2026-11-04", done_at: null },
  { project: "alpha", key: "e", title: "恰好七天到期", status: "doing", category: "流程", need_kind: "none", due: "2026-11-12", done_at: null },
];

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("Today pool filters", () => {
  it("combines search, need and due filters and updates counts", async () => {
    vi.stubGlobal("matchMedia", () => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() }));
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      if (String(input) === "/api/today") return Response.json({ today: [], pool: tasks, done: [], counts: { today: 0, pool: 5, done: 0, deleted: 0, checked: 0 }, date: "2026-11-05" });
      return Response.json({ error: "not_found" }, { status: 404 });
    }));
    render(Today);
    expect(await screen.findByText("选择示例方案")).toBeTruthy();
    await fireEvent.click(screen.getByRole("button", { name: /只看需要你/ }));
    expect(screen.queryByText("修复示例缺陷")).toBeNull();
    await fireEvent.click(screen.getByRole("button", { name: /7 天内到期/ }));
    expect(screen.getByText("确认示例设置")).toBeTruthy();
    const search = screen.getByRole("searchbox", { name: "搜索标题或分类" });
    await fireEvent.input(search, { target: { value: "确认" } });
    await waitFor(() => expect(screen.queryByText("选择示例方案")).toBeNull());
    expect(screen.getByText("确认示例设置")).toBeTruthy();
    expect(screen.getByRole("button", { name: "只看需要你 · 1" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "7 天内到期 · 1" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "清除筛选" })).toBeTruthy();
  });
  it("keeps overdue tasks and excludes tasks beyond seven days when only due filter is on", async () => {
    vi.stubGlobal("matchMedia", () => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() }));
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ today: [], pool: tasks, done: [], counts: { today: 0, pool: 5, done: 0, deleted: 0, checked: 0 }, date: "2026-11-05" })));
    render(Today);
    expect(await screen.findByText("修复示例缺陷")).toBeTruthy();
    await fireEvent.click(screen.getByRole("button", { name: /7 天内到期/ }));
    expect(screen.getByText("逾期示例")).toBeTruthy();
    expect(screen.getByText("恰好七天到期")).toBeTruthy();
    expect(screen.queryByText("修复示例缺陷")).toBeNull();
    expect(screen.getByRole("button", { name: "7 天内到期 · 4" })).toBeTruthy();
  });
});
