/**
 * @vitest-environment jsdom
 * @vitest-environment-options { "url": "https://rhythm.test/trend" }
 */
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/svelte";
import { afterEach, describe, expect, it, vi } from "vitest";
import App from "../src/App.svelte";
import {
  anomalyReasonText, clockText, deltaText, durationText, hourlyCategoryAverage, momentStats, statusGroups, topApps,
  type DailyMetrics, type TrendDay,
} from "../src/lib/trends";

type Json = Record<string, unknown>;

function response(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

function metrics(overrides: Partial<DailyMetrics> = {}): DailyMetrics {
  return {
    commuteToWorkMinutes: 60, commuteHomeMinutes: 70, officeActiveMinutes: 480, homeMinutes: 720,
    statusMinutes: { bedroom: 0, living_room: 0, home: 720, office_active: 480, office_away: 60, commute: 130, other_network: 0, unknown: 50 },
    wakeMinute: null, leaveHomeMinute: 480, startWorkMinute: 540, leaveComputerMinute: 1080, arriveHomeMinute: 1150, returnBedroomMinute: null,
    officeSpanMinutes: 540,
    focus: { segmentCount: 3, totalMinutes: 150, longestMinutes: 70, communicationInterruptions: 2 },
    afterWorkWorkMachineMinutes: 30, weekendWorkMachineMinutes: null,
    appCategoryMinutes: { 开发: 300, 沟通: 120, 文档: 30, 浏览: 20, 其他: 10 },
    hourlyAppCategoryMinutes: { "09": { 开发: 40, 沟通: 20, 文档: 0, 浏览: 0, 其他: 0 } },
    topAppName: "示例编辑器", topAppMinutes: 280,
    otherNetworkMinutes: { 示例咖啡店: 25 },
    coverage: { ratio: 0.97, gapReasonMinutes: { home_scan_missing: 30, phone_scan_missing: 10, work_machine_missing: 3 } },
    dayType: "workday",
    ...overrides,
  };
}

function day(date: string, value: DailyMetrics | null, extra: Partial<TrendDay> = {}): TrendDay {
  return { date, dayType: value?.dayType ?? null, missing: value === null, metrics: value, ...extra };
}

const average = {
  days: 2, dayType: "workday", commuteToWorkMinutes: 60, commuteHomeMinutes: 70, officeActiveMinutes: 480, homeMinutes: 720,
  officeSpanMinutes: 540, afterWorkWorkMachineMinutes: 30, weekendWorkMachineMinutes: null, topAppMinutes: 280,
  statusMinutes: metrics().statusMinutes, appCategoryMinutes: metrics().appCategoryMinutes,
  focus: { segmentCount: 3, totalMinutes: 150, longestMinutes: 70, communicationInterruptions: 2 },
};

function trendsPayload(range: 7 | 30): Json {
  const days = [
    day("2026-11-02", metrics()),
    day("2026-11-03", null),
    day("2026-11-04", metrics({ officeActiveMinutes: 300 })),
  ];
  return {
    range, from: "2026-11-02", to: "2026-11-04", days_available: 2, days,
    averages: { workday: average, restday: { ...average, days: 0, dayType: "restday" } },
    week_comparison: {
      current: average, previous: { ...average, officeActiveMinutes: 420 },
      current_from: "2026-11-02", previous_from: "2026-10-26", previous_to: "2026-10-28",
    },
  };
}

function stub(range: { value: 7 | 30 } = { value: 7 }) {
  const calls: string[] = [];
  vi.stubGlobal("fetch", vi.fn(async (input: unknown) => {
    const path = String(input);
    calls.push(path);
    if (path === "/api/me") return response({ authenticated: true });
    if (path.startsWith("/api/trends")) return response(trendsPayload(path.includes("range=30") ? 30 : range.value));
    if (path.startsWith("/api/anomalies")) {
      return response({
        range: 7, from: "2026-11-02", to: "2026-11-04", baseline: "该日之前近 30 天的同类日平均", days_available: 2,
        anomalies: [{ date: "2026-11-04", dayType: "workday", sampleDays: 6, reasons: [{ metric: "离家", actual: 540, average: 480, delta: 60 }] }],
        insufficient_sample: [{ date: "2026-11-02", dayType: "workday", sampleDays: 2, reason: "同类日样本不足 5 天" }],
      });
    }
    if (path.startsWith("/api/quality")) {
      return response({
        range: 7, from: "2026-11-02", to: "2026-11-04", days_available: 2,
        days: [
          { date: "2026-11-02", missing: false, coverage: 0.97, tier: "medium", gapReasonMinutes: { home_scan_missing: 30, phone_scan_missing: 10, work_machine_missing: 3 } },
          { date: "2026-11-03", missing: true, coverage: null, tier: "unknown", gapReasonMinutes: { home_scan_missing: null, phone_scan_missing: null, work_machine_missing: null } },
        ],
      });
    }
    throw new Error(`unexpected request: ${path}`);
  }));
  return calls;
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("趋势换算", () => {
  it("缺失是未知，不当成 0", () => {
    expect(clockText(null)).toBe("未知");
    expect(durationText(null)).toBe("未知");
    expect(statusGroups(null)).toBeNull();
    expect(statusGroups({})).toBeNull();
    expect(deltaText(null, "duration")).toBe("无法比较");
  });

  it("卧室、客厅与在家合并成「在家」，合计仍是 24 小时", () => {
    const groups = statusGroups({ bedroom: 100, living_room: 50, home: 20, office_active: 600, unknown: 670 })!;
    expect(groups.find(group => group.key === "home")?.value).toBe(170);
    expect(groups.reduce((sum, group) => sum + group.value, 0)).toBe(1440);
  });

  it("时刻范围与 Top App 只统计已汇总且已过完的日子", () => {
    const days = [
      day("2026-11-02", metrics({ leaveHomeMinute: 470 })),
      day("2026-11-03", null),
      day("2026-11-04", metrics({ leaveHomeMinute: 500, topAppName: "示例浏览器", topAppMinutes: 90 }), { partial: true }),
    ];
    const leave = momentStats(days).find(item => item.label === "离家")!;
    expect(leave).toMatchObject({ min: 470, max: 470, avg: 470, days: 1 });
    expect(topApps(days)).toEqual([{ name: "示例编辑器", days: 1, minutes: 280 }]);
    expect(hourlyCategoryAverage(days).find(hour => hour.hour === "09")?.segments.find(item => item.key === "开发")?.value).toBe(40);
  });

  it("异常原因写成大白话", () => {
    expect(anomalyReasonText({ metric: "离家", actual: 540, average: 480, delta: 60 })).toBe("离家 09:00，比平时（08:00）晚 1 小时");
    expect(anomalyReasonText({ metric: "上班通勤", actual: 90, average: 60, delta: 30 })).toBe("上班通勤 1 小时 30 分钟，比平时（1 小时）长 30 分钟（+50%）");
  });
});

describe("Rhythm 趋势页", () => {
  it("渲染 8 个模块、未知日、不足天数提示和按周对比", async () => {
    stub();
    render(App);
    expect(await screen.findByRole("heading", { name: "每天各状态各占几小时" })).toBeTruthy();
    for (const name of ["作息叠图", "通勤、几点、在电脑前", "在公司用电脑", "工作节奏", "在家", "和平时不一样的日子", "数据可信度", "本周和上周"]) {
      expect(screen.getByRole("heading", { name })).toBeTruthy();
    }
    expect(screen.getByText("不足 7 天")).toBeTruthy();
    expect(screen.getAllByRole("button", { name: /11\/3 周二 · 未知：没有数据（未知）/ }).length).toBeGreaterThan(0);
    expect(screen.getByText("离家 09:00，比平时（08:00）晚 1 小时")).toBeTruthy();
    expect(screen.getByText(/样本不足 5 天，没有判断/)).toBeTruthy();
    const table = screen.getByRole("table");
    expect(within(table).getByText("多 1时00分")).toBeTruthy();
    expect(screen.getByText(/暂不区分卧室和客厅/)).toBeTruthy();
    expect(document.querySelector("[data-injected], iframe, script:not([src])")).toBeNull();
  });

  it("点按柱子显示明细，切换 30 天会重新读取", async () => {
    const calls = stub();
    render(App);
    const bars = await screen.findAllByRole("button", { name: /11\/2 周一 · 工作日：在家/ });
    await fireEvent.click(bars[0]);
    expect(document.querySelector(".chart-detail")?.textContent).toContain("在电脑前 8.0 小时");
    await fireEvent.click(screen.getByRole("button", { name: "近 30 天" }));
    await waitFor(() => expect(calls).toContain("/api/trends?range=30"));
    expect(calls).toContain("/api/quality?range=30");
    expect(location.search).toBe("?range=30");
  });

  it("手机标签在作息与工作之间切换", async () => {
    stub();
    render(App);
    await screen.findByRole("heading", { name: "工作节奏" });
    const container = document.querySelector(".trend-sections")!;
    expect(container.getAttribute("data-tab")).toBe("rhythm");
    await fireEvent.click(screen.getByRole("tab", { name: "工作" }));
    expect(container.getAttribute("data-tab")).toBe("work");
    expect(screen.getByRole("tab", { name: "工作" }).getAttribute("aria-selected")).toBe("true");
  });

  it("接口失败时只显示错误，不画假数据", async () => {
    vi.stubGlobal("fetch", vi.fn(async (input: unknown) => {
      const path = String(input);
      if (path === "/api/me") return response({ authenticated: true });
      return response({ error: "upstream_unavailable" }, 502);
    }));
    render(App);
    expect(await screen.findByText("数据暂不可用，请稍后重试。")).toBeTruthy();
    expect(screen.queryByRole("heading", { name: "每天各状态各占几小时" })).toBeNull();
  });
});
