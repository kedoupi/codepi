/**
 * @vitest-environment jsdom
 * @vitest-environment-options { "url": "https://rhythm.test/?date=2026-10-26" }
 */
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/svelte";
import { afterEach, describe, expect, it, vi } from "vitest";
import App from "../src/App.svelte";

type Json = Record<string, unknown>;

function response(body: Json, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function dayPayload(overrides: Json = {}): Json {
  return {
    date: "2026-10-26",
    generatedAt: "2026-10-26T12:00:00.000Z",
    phoneConfigured: true,
    current: { status: "office_active", label: "公司 · 在电脑前", evidence: "seen", minute: 540, time: "09:00", asOf: "09:00", live: true },
    segments: [
      { status: "bedroom", label: "卧室", evidence: "seen", detail: "", startMinute: 0, endMinute: 440, startLabel: "00:00", endLabel: "07:20", minutes: 441 },
      { status: "other_network", label: "其他网络", evidence: "seen", detail: "示例网络", startMinute: 441, endMinute: 455, startLabel: "07:21", endLabel: "07:35", minutes: 15 },
      { status: "unknown", label: "未知", evidence: "no_data", detail: "", startMinute: 720, endMinute: 720, startLabel: "12:00", endLabel: "12:00", minutes: 1 },
    ],
    moments: [
      { kind: "start_work", label: "开始办公", detail: "09:00 公司网络出现键鼠活动", evidence: "seen", minute: 540, time: "09:00" },
    ],
    metrics: {
      commuteToWorkMinutes: 84, commuteHomeMinutes: 79, officeActiveMinutes: 551, homeMinutes: 726,
      bedroomMinutes: 441, livingRoomMinutes: 270, homeUnknownMinutes: 15,
    },
    appBreakdown: [{ category: "开发", minutes: 180, share: 1, apps: [{ name: "示例编辑器", minutes: 180 }] }],
    keyboardMouseMinutes: { keyboard: 551, pointer: 551, both: 551 },
    freshness: {
      home: { latestAt: null, ageMinutes: null, status: "missing" },
      work: { latestAt: null, ageMinutes: null, status: "missing" },
    },
    ...overrides,
  };
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("Rhythm 今天页", () => {
  it("渲染状态卡、时间线、关键时刻和四个数字", async () => {
    vi.stubGlobal("fetch", vi.fn(async (input: unknown) => {
      const path = String(input);
      if (path === "/api/me") return response({ authenticated: true });
      if (path.startsWith("/api/day")) return response(dayPayload());
      throw new Error(`unexpected request: ${path}`);
    }));
    render(App);
    expect(await screen.findByRole("heading", { name: "公司 · 在电脑前" })).toBeTruthy();
    expect(screen.getByText(/截至 09:00 · 工作机每 15 分钟上传一次/)).toBeTruthy();
    expect(screen.getByText("上班通勤（上限）")).toBeTruthy();
    expect(screen.getByText("下班通勤（上限）")).toBeTruthy();
    expect(screen.getByText("在电脑前")).toBeTruthy();
    expect(screen.getByText("在家", { selector: ".metric-card span" })).toBeTruthy();
    expect(screen.getByText("开始办公")).toBeTruthy();
    const legend = screen.getByLabelText("时间线图例");
    expect(legend).toBeTruthy();
    expect(legend.textContent).toContain("卧室");
    expect(legend.textContent).toContain("其他网络");
    expect(screen.getByText(/键盘 551/)).toBeTruthy();
    const segmentButtons = [...document.querySelectorAll<HTMLButtonElement>(".timeline-segment")];
    expect(segmentButtons).toHaveLength(3);
    for (const [index, button] of segmentButtons.entries()) {
      const segment = (dayPayload().segments as Json[])[index] as Json;
      expect(Number(button.style.getPropertyValue("--segment-start"))).toBe(segment.startMinute);
      expect(Number(button.style.getPropertyValue("--segment-minutes"))).toBe(segment.minutes);
    }
  });

  it("点按时间段显示该段明细", async () => {
    vi.stubGlobal("fetch", vi.fn(async (input: unknown) => {
      const path = String(input);
      if (path === "/api/me") return response({ authenticated: true });
      if (path.startsWith("/api/day")) return response(dayPayload());
      throw new Error(`unexpected request: ${path}`);
    }));
    render(App);
    const segment = await screen.findByRole("button", { name: /其他网络/ });
    await fireEvent.click(segment);
    await waitFor(() => expect(screen.getByText("07:21–07:35 其他网络")).toBeTruthy());
    expect(screen.getByText("示例网络")).toBeTruthy();
  });

  it("没有指定手机时明确提示", async () => {
    vi.stubGlobal("fetch", vi.fn(async (input: unknown) => {
      const path = String(input);
      if (path === "/api/me") return response({ authenticated: true });
      if (path.startsWith("/api/day")) return response(dayPayload({ phoneConfigured: false }));
      throw new Error(`unexpected request: ${path}`);
    }));
    render(App);
    expect(await screen.findByText("未指定手机")).toBeTruthy();
  });

  it("上游失败时显示数据暂不可用，不显示假数据", async () => {
    vi.stubGlobal("fetch", vi.fn(async (input: unknown) => {
      const path = String(input);
      if (path === "/api/me") return response({ authenticated: true });
      if (path.startsWith("/api/day")) return response({ error: "upstream_unavailable" }, 502);
      throw new Error(`unexpected request: ${path}`);
    }));
    render(App);
    expect(await screen.findByText("数据暂不可用")).toBeTruthy();
    expect(screen.queryByText("上班通勤（上限）")).toBeNull();
  });

  it("可以切换到前一天", async () => {
    const calls: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (input: unknown) => {
      const path = String(input);
      if (path === "/api/me") return response({ authenticated: true });
      if (path.startsWith("/api/day")) {
        calls.push(path);
        return response(dayPayload());
      }
      throw new Error(`unexpected request: ${path}`);
    }));
    render(App);
    await screen.findByText("上班通勤（上限）");
    await fireEvent.click(screen.getByRole("button", { name: "前一天" }));
    await waitFor(() => expect(calls.some(call => call.includes("2026-10-25"))).toBe(true));
  });

  it("只按文本节点渲染上游内容", async () => {
    vi.stubGlobal("fetch", vi.fn(async (input: unknown) => {
      const path = String(input);
      if (path === "/api/me") return response({ authenticated: true });
      if (path.startsWith("/api/day")) {
        const payload = dayPayload();
        (payload.segments as Json[])[0].label = "<script>window.__rhythmXss = 1</script>";
        return response(payload);
      }
      throw new Error(`unexpected request: ${path}`);
    }));
    render(App);
    expect(await screen.findByText("<script>window.__rhythmXss = 1</script>")).toBeTruthy();
    expect(document.querySelector("script")).toBeNull();
    expect(Object.prototype.hasOwnProperty.call(window, "__rhythmXss")).toBe(false);
  });

  it("登录过期时回到登录页", async () => {
    vi.stubGlobal("fetch", vi.fn(async (input: unknown) => {
      const path = String(input);
      if (path === "/api/me") return response({ error: "unauthorized" }, 401);
      throw new Error(`unexpected request: ${path}`);
    }));
    render(App);
    expect(await screen.findByRole("link", { name: "统一登录" })).toBeTruthy();
  });
});
