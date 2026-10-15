import { describe, expect, it } from "vitest";
import { marginPosition, riskRail } from "../src/charts";

/**
 * 2026-10-15 线上批次的九条规则距离（rule_id → distance / triggered）。
 * 这里当作回归夹具：轴的量程与断点就是按这组数据选的，规则集变化后如果标记重新
 * 粘连，下面的分离度断言会失败。
 */
const BATCH = [
  { rule_id: "NVDA_stop_buy", distance: 0.0735, triggered: true },
  { rule_id: "GOOGL_trim", distance: 0.3482, triggered: false },
  { rule_id: "NVDA_price_pause", distance: 0.3831, triggered: false },
  { rule_id: "NVDA_max", distance: 0.4185, triggered: false },
  { rule_id: "GOOGL_force", distance: 0.4785, triggered: false },
  { rule_id: "tech_max", distance: 0.5113, triggered: false },
  { rule_id: "XLV_max", distance: 0.7019, triggered: false },
  { rule_id: "cash_min", distance: 3.9946, triggered: false },
];

const marginOf = (row: { distance: number; triggered: boolean }) =>
  row.triggered ? -row.distance : row.distance;

describe("risk rail uses a signed margin axis", () => {
  it("keeps the axis monotonic so a larger margin is never drawn further left", () => {
    const samples = [
      -1, -0.2, -0.19, -0.05, 0, 0.05, 0.15, 0.599, 0.601, 1, 2, 4, 9,
    ];
    const positions = samples.map(marginPosition);
    for (let i = 1; i < positions.length; i++) {
      expect(positions[i]).toBeGreaterThanOrEqual(positions[i - 1]);
    }
    expect(positions[0]).toBe(0);
    expect(positions[positions.length - 1]).toBe(100);
  });

  it("does not collapse the batch markers into each other at the narrowest track", () => {
    const positions = BATCH.map((row) => marginPosition(marginOf(row))).sort(
      (a, b) => a - b,
    );
    const gaps = positions
      .slice(1)
      .map((position, i) => position - positions[i]);
    // 309px 是移动端实测的轨道宽度。标记宽 5px，中心距低于 10px 就会粘连——
    // 旧设计在这里只有 5–10px 而标记直径 11px，五个点糊成一团。
    expect((Math.min(...gaps) / 100) * 309).toBeGreaterThanOrEqual(10);
  });

  it("places triggered rules left of the shared zero line and everything else right of it", () => {
    const zero = marginPosition(0);
    for (const row of BATCH) {
      const position = marginPosition(marginOf(row));
      if (row.triggered) expect(position).toBeLessThan(zero);
      else expect(position).toBeGreaterThan(zero);
    }
    const html = riskRail(BATCH.map((row) => ({ ...row, item: row.rule_id })));
    const zeroMarks = html.match(/class="rail-zero" data-l="[\d.]+"/g) || [];
    expect(zeroMarks).toHaveLength(BATCH.length);
    // 共用一条轴：每一行的原点位置必须一致。
    expect(new Set(zeroMarks)).toHaveLength(1);
  });

  it("still reports the absolute distance from the spec, not the signed margin", () => {
    const html = riskRail([
      {
        rule_id: "NVDA_stop_buy",
        item: "NVDA（停买线）",
        kind: "权重",
        current: "7.0%",
        threshold: "≥6.5% 停买",
        distance: 0.0735,
        triggered: true,
        proximity: "near",
        action: "不再加仓（不是卖出信号）",
      },
    ]);
    expect(html).toContain("7.35%");
    expect(html).not.toContain("−7.35%");
    expect(html).not.toContain("-7.35%");
  });

  it("marks the compressed far segment instead of stretching the linear part", () => {
    const html = riskRail([
      {
        item: "现金/基金",
        kind: "权重",
        current: "69.9%",
        threshold: "≥14%",
        distance: 3.9946,
        triggered: false,
        proximity: "clear",
      },
    ]);
    const expected = marginPosition(0.6).toFixed(1);
    expect(html).toContain(
      `class="rail-zone zone-far" data-l="${Number(expected)}"`,
    );
    expect(html).toContain(`data-w="${100 - Number(expected)}"`);
  });

  it("keeps the decision lines on the two spec thresholds", () => {
    const html = riskRail([
      {
        item: "X",
        kind: "权重",
        current: "1%",
        threshold: ">2%",
        distance: 0.5,
        triggered: false,
        proximity: "clear",
      },
    ]);
    expect(html).toContain(
      `class="rail-line line-critical" data-l="${marginPosition(0.05)}"`,
    );
    expect(html).toContain(
      `class="rail-line line-near" data-l="${marginPosition(0.15)}"`,
    );
  });

  it("sorts crossed rules ahead of untouched ones and rules without a threshold last", () => {
    const html = riskRail([
      { item: "远", distance: 0.45, triggered: false },
      { item: "无阈值", distance: null, triggered: null },
      { item: "越线", distance: 0.02, triggered: true },
    ]);
    expect(html.indexOf(">越线<")).toBeLessThan(html.indexOf(">远<"));
    expect(html.indexOf(">远<")).toBeLessThan(html.indexOf(">无阈值<"));
  });
});
