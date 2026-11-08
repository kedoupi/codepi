/**
 * @vitest-environment jsdom
 * @vitest-environment-options { "url": "https://rhythm.test/work" }
 */
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/svelte";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import App from "../src/App.svelte";

type Json = Record<string, unknown>;

function response(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

const categories = Object.fromEntries(["AI 编程", "AI 对话", "工作沟通", "会议", "文档", "浏览", "私人", "其他"].map(category => [category, {
  minutes: category === "AI 编程" ? 120 : 0, share: category === "AI 编程" ? 0.8 : 0, delta_minutes: null, delta_share: null,
}])) as Json;

function workPayload(overrides: Json = {}): Json {
  return {
    date: "2026-11-06", range: "day", from: "2026-11-06", to: "2026-11-06", missing: false,
    office_minutes: 150, categories, away: { minutes: 30, share: 0.2, delta_minutes: 10, delta_share: 0.1 },
    top_apps: [{ name: "示例编辑器", category: "AI 编程", minutes: 120, share: 0.8 }],
    focus: { total_minutes: 90, longest_minutes: 60, segment_count: 2, communication_interruptions: 1, segments: [{ startMinute: 540, endMinute: 600, minutes: 60, primaryCategory: "AI 编程", interruptedAt: [] }] },
    heatmap: { from: "2026-10-10", to: "2026-11-05", days_available: 1, hours: Array.from({ length: 12 }, (_, i) => ({ hour: String(i + 8).padStart(2, "0"), minutes: 30 })) },
    hourly: Array.from({ length: 12 }, (_, i) => ({ hour: String(i + 8).padStart(2, "0"), active_minutes: 30, switch_count: i === 6 ? 10 : 1, above_average: i === 6 })),
    communication_interruptions: 1,
    ...overrides,
  };
}
const heatmapDays = (value: number | null) => ["周一", "周二", "周三", "周四", "周五"].map(day => ({
  day, days_available: value === null ? 0 : 1,
  hours: Array.from({ length: 12 }, (_, i) => ({ hour: String(i + 8).padStart(2, "0"), minutes: value })),
}));

function stub(payload: Json = workPayload()) {
  const calls: string[] = [];
  vi.stubGlobal("fetch", vi.fn(async (input: unknown) => {
    const path = String(input);
    calls.push(path);
    if (path === "/api/me") return response({ authenticated: true });
    return response(payload);
  }));
  return calls;
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-11-06T12:00:00+08:00"));
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  history.replaceState(null, "", "/work");
  vi.useRealTimers();
});

describe("Rhythm 工作页", () => {
  it("渲染时间去向、专注、热力图和被打断，并可切换本周", async () => {
    const calls = stub();
    render(App);
    expect(await screen.findByRole("heading", { name: "工作时间花在哪" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "专注" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "哪些钟头最出活" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "被打断" })).toBeTruthy();
    expect(screen.getByText("示例编辑器")).toBeTruthy();
    await fireEvent.click(screen.getByRole("button", { name: "本周" }));
    await waitFor(() => expect(calls).toContain("/api/work?date=2026-11-06&range=week"));
  });

  it("带按工作日数据时渲染周一至周五五行", async () => {
    stub(workPayload({ heatmap: { from: "2026-10-10", to: "2026-11-05", days_available: 5, hours: Array.from({ length: 12 }, (_, i) => ({ hour: String(i + 8).padStart(2, "0"), minutes: 15 })), days: heatmapDays(15) } }));
    render(App);
    await screen.findByRole("heading", { name: "哪些钟头最出活" });
    expect(screen.getAllByText(/周[一二三四五]/).map(item => item.textContent)).toEqual(["周一", "周二", "周三", "周四", "周五"]);
    expect(document.querySelectorAll(".work-heatmap .heatmap-grid:not(.heatmap-head)")).toHaveLength(5);
  });

  it("热力图所有格子未知时显示暂无数据", async () => {
    stub(workPayload({ heatmap: { from: "2026-10-10", to: "2026-11-05", days_available: 0, hours: Array.from({ length: 12 }, (_, i) => ({ hour: String(i + 8).padStart(2, "0"), minutes: null })), days: heatmapDays(null) } }));
    render(App);
    await screen.findByRole("heading", { name: "哪些钟头最出活" });
    expect(screen.getAllByText("暂无数据").length).toBeGreaterThan(0);
    expect(document.querySelector(".work-heatmap")).toBeNull();
  });

  it("缺少工作汇总时显示暂无数据，不绘制零值图表", async () => {
    stub(workPayload({ missing: true, office_minutes: null, categories: null, top_apps: null, focus: { total_minutes: null, longest_minutes: null, segment_count: null, communication_interruptions: null, segments: null }, heatmap: { from: "x", to: "y", days_available: 0, hours: [] }, hourly: null, communication_interruptions: null }));
    render(App);
    expect((await screen.findAllByText("暂无数据")).length).toBeGreaterThan(0);
    expect(screen.queryByText("示例编辑器")).toBeNull();
    expect(screen.getByRole("heading", { name: "口径" })).toBeTruthy();
  });
});
