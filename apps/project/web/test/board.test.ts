// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/svelte";
import { afterEach, describe, expect, it, vi } from "vitest";
import Board from "../src/components/Board.svelte";
import Countdown from "../src/components/Countdown.svelte";
import type { ProjectSummary, TaskBrief } from "../src/lib/types";

const projects: ProjectSummary[] = [
  { id: "alpha", name: "Alpha", repo: null, status: "active", last_push_at: "2026-11-04T06:00:00Z", open: 3, need_you: 2, branches: 0, url: "" },
  { id: "beta", name: "Beta", repo: "synthetic/beta", status: "active", last_push_at: null, open: 1, need_you: 0, branches: 0, url: "" },
];
const task = (overrides: Partial<TaskBrief>): TaskBrief => ({
  project: "alpha", key: "k", title: "示例", status: "doing", category: "流程", due: null, need_kind: "none", done_at: null, ...overrides,
});
const tasks: TaskBrief[] = [
  task({ key: "a", title: "选择示例方案", status: "decide", need_kind: "decide", due: "2026-11-05" }),
  task({ key: "b", title: "续费示例", status: "doing", need_kind: "attend", due: "2026-11-02", category: "基础设施" }),
  task({ key: "c", title: "示例想法", status: "idea" }),
  task({ project: "beta", key: "d", title: "Beta 缺陷", status: "bug", category: "网关" }),
  task({ key: "e", title: "刚做完", status: "doing", done_at: new Date().toISOString() }),
];

function mockFetch() {
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
    const path = String(input);
    if (path.startsWith("/api/tasks")) return Response.json({ as_of: "", tasks });
    if (path === "/api/overview") return Response.json({ today: "2026-11-04" });
    return Response.json({ error: "not_found" }, { status: 404 });
  }));
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  history.replaceState(null, "", "/");
});

describe("Board", () => {
  it("groups tasks into status columns plus recently done and filters by need", async () => {
    mockFetch();
    const onOpen = vi.fn();
    render(Board, { projects, onOpen });
    await screen.findByText("选择示例方案");
    const column = (label: string) => screen.getByRole("region", { name: label });
    expect(column("待决定").textContent).toContain("选择示例方案");
    expect(column("执行").textContent).toContain("续费示例");
    expect(column("缺陷").textContent).toContain("Beta 缺陷");
    expect(column("最近完成").textContent).toContain("刚做完");
    await fireEvent.click(screen.getByRole("button", { name: "只看需要你" }));
    await waitFor(() => expect(column("想法").textContent).not.toContain("示例想法"));
    expect(column("最近完成").textContent).not.toContain("刚做完");
    await fireEvent.click(screen.getByText("续费示例"));
    expect(onOpen).toHaveBeenCalledWith("alpha", "b");
  });

  it("filters from a heat-map cell and clears it again", async () => {
    mockFetch();
    render(Board, { projects, onOpen: vi.fn() });
    await screen.findByText("选择示例方案");
    await fireEvent.click(screen.getByRole("button", { name: "网关 缺陷 1 条" }));
    await waitFor(() => expect(screen.queryByText("选择示例方案")).toBeNull());
    expect(screen.getByText("Beta 缺陷")).toBeTruthy();
    await fireEvent.click(screen.getByRole("button", { name: "清除筛选" }));
    await screen.findByText("选择示例方案");
  });

  it("reads the due filter from the address", async () => {
    history.replaceState(null, "", "/board?due=late");
    mockFetch();
    render(Board, { projects, onOpen: vi.fn() });
    await screen.findByText("续费示例");
    expect(screen.queryByText("选择示例方案")).toBeNull();
  });
});

describe("Countdown", () => {
  it("draws one bar per dated task and labels overdue days", () => {
    render(Countdown, { tasks, today: "2026-11-04", onOpen: vi.fn() });
    const rows = screen.getAllByRole("button");
    expect(rows).toHaveLength(2);
    expect(rows[1].getAttribute("aria-label")).toContain("逾期 2 天");
    expect(rows[0].getAttribute("aria-label")).toContain("需要你决定");
  });
});
