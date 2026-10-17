import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, screen } from "@testing-library/svelte";
import { mountApp, resetClientState, stubFetch } from "./helpers";

beforeEach(() => {
  resetClientState();
});

afterEach(async () => {
  cleanup();
  await new Promise((done) => setTimeout(done, 0));
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("chart to position linkage targets", () => {
  it("marks both the desktop row and the mobile card with the same anchor and data-position", async () => {
    stubFetch({ sso: true });
    mountApp("#positions");
    await screen.findByText("当前持仓");
    // 桌面表格行
    const row = document.querySelector("tr.position-row[data-position='GOOGL']")!;
    expect(row.id).toBe("position-anchor-GOOGL");
    // 移动端卡片（<=900px 才显示）必须能被同一个选择器命中
    const card = document.querySelector("article.position-card[data-position='GOOGL']")!;
    expect(card.id).toBe("position-anchor-GOOGL");
    expect(document.querySelector("[data-position='现金']")).toBeTruthy();
  });

  it("does not attach the jump affordance to the position rows themselves", async () => {
    stubFetch({ sso: true });
    mountApp("#positions");
    await screen.findByText("当前持仓");
    // 持仓页自身不应有可点击跳转的 data-position 图表节点
    expect(document.querySelector("#content .composition-legend-item")).toBeNull();
    expect(document.querySelector("#content .composition-segment")).toBeNull();
  });
});
