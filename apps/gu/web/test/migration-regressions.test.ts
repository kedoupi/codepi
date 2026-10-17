import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, screen } from "@testing-library/svelte";
import { goTo, mountApp, resetClientState, stubFetch } from "./helpers";

beforeEach(() => {
  resetClientState();
});

afterEach(async () => {
  cleanup();
  await new Promise((done) => setTimeout(done, 0));
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("history record picker (single live control)", () => {
  it("renders exactly one #history-date / #history-detail and updates the detail on change", async () => {
    stubFetch({ sso: true });
    mountApp();
    await screen.findByText("持仓变化");
    expect(document.querySelectorAll("#history-date").length).toBe(1);
    expect(document.querySelectorAll("#history-detail").length).toBe(1);
    const select = document.querySelector<HTMLSelectElement>("#history-date")!;
    const detail = () => document.querySelector("#history-detail")!.textContent ?? "";
    // 默认选中最后一条（本批行情）。
    expect(detail()).toContain("本批行情估算");
    const first = select.options[0].value;
    select.value = first;
    select.dispatchEvent(new Event("change", { bubbles: true }));
    await vi.waitFor(() => expect(detail()).toContain("历史档案约值"));
    expect(detail()).toContain("持仓档案_SSOT.md");
  });

  it("keeps the picked record after leaving and returning to the overview", async () => {
    stubFetch({ sso: true });
    mountApp();
    await screen.findByText("持仓变化");
    const select = document.querySelector<HTMLSelectElement>("#history-date")!;
    select.value = select.options[0].value;
    select.dispatchEvent(new Event("change", { bubbles: true }));
    await vi.waitFor(() =>
      expect(document.querySelector("#history-detail")!.textContent ?? "").toContain("历史档案约值"),
    );
    await goTo("#positions");
    await screen.findByText("当前持仓");
    await goTo("#overview");
    await screen.findByText("持仓变化");
    expect(document.querySelector("#history-detail")!.textContent ?? "").toContain("历史档案约值");
  });
});

describe("chart geometry after a refresh", () => {
  it("re-applies CSSOM chart styles when a new batch replaces the chart nodes", async () => {
    const stub = stubFetch({ sso: true });
    mountApp();
    await screen.findByText("持仓变化");
    const widthBefore = () =>
      document.querySelector<HTMLElement>(".composition-segment")?.style.width ?? "";
    await vi.waitFor(() => expect(widthBefore()).not.toBe(""));
    // 新批次且权重/风控距离实际变化：{@html} 替换图表节点，
    // action 必须重新经 CSSOM 写入几何（相同 HTML 会保留旧节点，测不出回归）。
    const { baseData } = await import("./helpers");
    const changed = baseData();
    changed.positions[0].weight_raw = 0.4;
    changed.risk[0].distance = 0.32;
    stub.setHandler(async (path) =>
      path === "/api/me"
        ? Response.json({ authenticated: true })
        : Response.json({
            batch_id: "two",
            received_at: "2026-10-15T03:00:00Z",
            data: changed,
          }),
    );
    document.querySelector<HTMLButtonElement>("#refresh")!.click();
    await screen.findByText("已载入新同步批次。");
    await vi.waitFor(() => expect(widthBefore()).not.toBe(""));
    // 风控距离图的 rail-dot 需要 data-l 经 CSSOM 写入 left（含 clamp）。
    await goTo("#positions");
    await screen.findByText("风控距离");
    await vi.waitFor(() =>
      expect(document.querySelector<HTMLElement>(".rail-dot")?.style.left ?? "").not.toBe(""),
    );
  });
});

describe("entry mount", () => {
  it("clears the .boot placeholder when mounting the real entry", async () => {
    stubFetch({ sso: true });
    location.hash = "#overview";
    document.body.innerHTML = '<div id="app"><p class="boot">正在读取投资工作台…</p></div>';
    vi.resetModules();
    await import("../src/main");
    await vi.waitFor(
      () => expect(document.body.textContent ?? "").toContain("投资总览"),
      { timeout: 10000 },
    );
    expect(document.querySelector(".boot")).toBeNull();
    expect(document.body.textContent ?? "").not.toContain("正在读取投资工作台…");
  }, 15000);
});
