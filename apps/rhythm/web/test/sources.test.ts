/**
 * @vitest-environment jsdom
 * @vitest-environment-options { "url": "https://rhythm.test/sources" }
 */
import { cleanup, render, screen } from "@testing-library/svelte";
import { afterEach, describe, expect, it, vi } from "vitest";
import App from "../src/App.svelte";
import { displayShanghaiTime } from "../src/lib/api";

function response(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

const sourcesPayload = () => ({
  generatedAt: "2026-10-26T12:00:00.000Z",
  sources: {
    home: { name: "家中设备扫描", latestAt: null, ageMinutes: null, status: "missing", method: "家中扫描器定期采集设备心跳。" },
    work: { name: "工作机采样", latestAt: null, ageMinutes: null, status: "missing", method: "工作机每分钟上报一次网络与键鼠空闲情况。" },
  },
  states: [
    { status: "bedroom", label: "卧室", method: "本人手机在线，房间标签是卧室。", evidence: "seen" },
    { status: "commute", label: "通勤", method: "手机最后一次在家到工作机第一次在电脑前之间。", evidence: "inferred" },
    { status: "outside", label: "在外", method: "离开公司后到回家前，没有设备看到你；家中扫描正常、超过 2 小时。", evidence: "inferred" },
  ],
  caveats: ["设备在线不等于人在。", "通勤是推断值。", "早期在家时段由手机上线 / 离线事件区间推断。"],
  collection: ["不采集键盘内容、鼠标轨迹、屏幕画面、窗口标题、网址。", "不上云完整硬件地址、IP、网关与 BSSID。"],
  settings: { subjectDeviceCount: 0, appCategoryCount: 0 },
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("Rhythm 来源页", () => {
  it("显示每个状态的判断方法、口径与不采集清单", async () => {
    vi.stubGlobal("fetch", vi.fn(async (input: unknown) => {
      const path = String(input);
      if (path === "/api/me") return response({ authenticated: true });
      if (path === "/api/sources") return response(sourcesPayload());
      throw new Error(`unexpected request: ${path}`);
    }));
    render(App);
    expect(await screen.findByText("家中设备扫描")).toBeTruthy();
    expect(screen.getByText("工作机采样")).toBeTruthy();
    expect(screen.getByText("本人手机在线，房间标签是卧室。")).toBeTruthy();
    expect(screen.getByText("口径")).toBeTruthy();
    expect(screen.getByText("不采集")).toBeTruthy();
    expect(screen.getByText("已指定手机：未指定手机 · App 分类：0 个")).toBeTruthy();
  });

  it("上游失败时显示数据暂不可用", async () => {
    vi.stubGlobal("fetch", vi.fn(async (input: unknown) => {
      const path = String(input);
      if (path === "/api/me") return response({ authenticated: true });
      if (path === "/api/sources") return response({ error: "upstream_unavailable" }, 502);
      throw new Error(`unexpected request: ${path}`);
    }));
    render(App);
    expect(await screen.findByText("数据暂不可用")).toBeTruthy();
  });

  it("按北京时间显示来源时间，且不把内部网络值展示给用户", async () => {
    const payload = sourcesPayload() as any;
    payload.sources.home.latestAt = "2026-11-03T15:50:00.000Z";
    payload.sources.home.ageMinutes = 9;
    payload.sources.home.status = "fresh";
    payload.sources.work.latestAt = "2026-11-03T23:42:00+08:00";
    payload.sources.work.ageMinutes = 18;
    payload.sources.work.status = "fresh";
    vi.stubGlobal("fetch", vi.fn(async (input: unknown) => {
      const path = String(input);
      if (path === "/api/me") return response({ authenticated: true });
      if (path === "/api/sources") return response(payload);
      throw new Error(`unexpected request: ${path}`);
    }));
    render(App);
    expect(await screen.findByText("最近：11 月 3 日 23:50")).toBeTruthy();
    expect(screen.getByText("最近：11 月 3 日 23:42")).toBeTruthy();
    expect(screen.getByText("新鲜 · 9 分钟前")).toBeTruthy();
    expect(screen.getByText("新鲜 · 18 分钟前")).toBeTruthy();
    expect(displayShanghaiTime("2026-11-03T15:50:00.000Z")).toBe("11 月 3 日 23:50");
    expect(displayShanghaiTime("2026-11-03T23:42:00+08:00")).toBe("11 月 3 日 23:42");
    expect(document.body.textContent).not.toMatch(/\b(home|office|other)\b/);
  });

  it("未来时间显示时间异常，不显示 0 分钟前", async () => {
    const payload = sourcesPayload() as any;
    payload.sources.home.latestAt = "2026-11-03T16:01:01.000Z";
    payload.sources.home.ageMinutes = null;
    payload.sources.home.status = "time_anomaly";
    vi.stubGlobal("fetch", vi.fn(async (input: unknown) => {
      const path = String(input);
      if (path === "/api/me") return response({ authenticated: true });
      if (path === "/api/sources") return response(payload);
      throw new Error(`unexpected request: ${path}`);
    }));
    render(App);
    expect(await screen.findByText("时间异常")).toBeTruthy();
    expect(screen.queryByText("新鲜 · 0 分钟前")).toBeNull();
  });

  it("过期来源显示分钟或天数，且不显示为没有新鲜数据", async () => {
    const payload = sourcesPayload() as any;
    payload.sources.home.ageMinutes = 11;
    payload.sources.home.status = "stale";
    payload.sources.work.ageMinutes = 24 * 60 + 1;
    payload.sources.work.status = "stale";
    vi.stubGlobal("fetch", vi.fn(async (input: unknown) => {
      const path = String(input);
      if (path === "/api/me") return response({ authenticated: true });
      if (path === "/api/sources") return response(payload);
      throw new Error(`unexpected request: ${path}`);
    }));
    render(App);
    expect(await screen.findByText("过期 · 11 分钟前")).toBeTruthy();
    expect(screen.getByText("过期 · 1 天前")).toBeTruthy();
    expect(screen.queryByText("没有新鲜数据")).toBeNull();
  });
});
