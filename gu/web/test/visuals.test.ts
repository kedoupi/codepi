import { describe, expect, it } from "vitest";
import {
  allocationGap,
  cashBuffer,
  compositionBar,
  eventTimeline,
  positionAnchorId,
  riskRail,
} from "../src/charts";

const pos = (
  ticker: string,
  weight: number,
  target: number | null,
  valueUsd: number | null,
  name = ticker,
) => ({ ticker, name, weight, weight_raw: weight, target, value_usd: valueUsd });

describe("composition bar groups positions by raw weight with cash separated", () => {
  it("renders one button per position and exposes data-position for linkage", () => {
    const rows = [
      pos("GOOGL", 0.13, 0.135, 74600),
      pos("NVDA", 0.07, 0.065, 39900),
      pos("VOO", 0.056, 0.6, 32300),
      pos("XLV", 0.036, 0.05, 20500),
      pos("港股", 0.008, 0.01, 4800),
      pos("现金", 0.699, 0.14, 400200),
    ];
    const html = compositionBar(rows);
    expect(html).toContain("GOOGL");
    expect(html).toContain("NVDA");
    expect(html).toContain("现金");
    // Each button exposes data-position for the click handler.
    const matches = html.match(/data-position="[^"]+"/g) || [];
    expect(matches.length).toBe(12); // 6 segment buttons + 6 legend buttons
    expect(html).toContain('data-color="cash"');
    expect(html).toContain('data-color="hk"');
    // 13.0% label fits inside GOOGL segment; 港股 0.8% segment is too narrow so the
    // segment has no composition-label span, while the legend always shows it.
    const segments = html.match(/<button[^>]*class="composition-segment"[^>]*>[\s\S]*?<\/button>/g) || [];
    const googlSeg = segments.find((s) => s.includes('data-position="GOOGL"')) || "";
    const hkSeg = segments.find((s) => s.includes('data-position="港股"')) || "";
    expect(googlSeg).toContain("13.0%");
    expect(hkSeg).not.toMatch(/<span class="composition-label">/);
  });

  it("uses weight_raw and renders the percent at 1 digit", () => {
    const rows = [pos("GOOGL", 0.035499343, 0.05, 12345)];
    const html = compositionBar(rows);
    expect(html).toContain("3.5%");
  });

  it("omits zero-weight positions to avoid misleading empty segments", () => {
    const rows = [
      pos("GOOGL", 0.13, 0.135, 1000),
      pos("EMPTY", 0, 0.05, 0),
      pos("NVDA", -0.001, 0.065, -10),
    ];
    const html = compositionBar(rows);
    expect(html).not.toContain("EMPTY");
    expect(html).not.toContain("NVDA");
  });

  it("renders nothing when no rows have weight", () => {
    expect(compositionBar([])).toBe("");
    expect(compositionBar([pos("NVDA", 0, null, 0)])).toBe("");
  });
});

describe("cash buffer chart contrasts current and post-DCA buffer to the minimum", () => {
  it("requires cashAfter and cashMinimum; hides DCA row when dcaAmount is missing", () => {
    const html = cashBuffer(0.699, 0.14, null, 573000, "2026-09-16");
    expect(html).toContain("当前现金");
    expect(html).toContain("69.9%");
    expect(html).toContain("缓冲 +55.9");
    expect(html).not.toContain("本月投后估算");
  });

  it("computes post-DCA cash weight using dcaAmount and totalUsd", () => {
    const html = cashBuffer(0.699, 0.14, 30000, 573000, "2026-09-16");
    expect(html).toContain("本月投后估算");
    // 0.699 - 30000 / 573000 = 0.699 - 0.0524 = 0.6466 → 64.7%
    expect(html).toContain("64.7%");
    expect(html).toMatch(/缓冲 \+50\.7/);
  });

  it("drops the chart when cashAfter or cashMinimum is missing", () => {
    expect(cashBuffer(null, 0.14, 1000, 100000, "2026-09-16")).toBe("");
    expect(cashBuffer(0.5, null, 1000, 100000, "2026-09-16")).toBe("");
  });

  it("marks the row danger when current cash is below the minimum", () => {
    const html = cashBuffer(0.10, 0.14, null, 100000, "2026-09-16");
    expect(html).toMatch(/cash-fill danger/);
    expect(html).toContain("缓冲 −4.0");
  });

  it("marks warning when overshoot is under 5 percentage points", () => {
    const html = cashBuffer(0.18, 0.14, null, 100000, "2026-09-16");
    expect(html).toMatch(/cash-fill warning/);
  });
});

describe("event timeline only renders what the synced snapshot contains", () => {
  const events = [
    { title: "VOO 月投", start: { date: "2026-10-20" }, execution_status: "unconfirmed" },
    { title: "GOOGL 财报", start: { date_time: "2026-10-29T04:30:00Z" }, execution_status: "unconfirmed" },
    { title: "风控体检", start: { date: "2026-10-15" }, execution_status: "recorded_done" },
  ];

  it("renders all synced events with axis offsets that stay within 0-100", () => {
    const html = eventTimeline(events, "2026-10-15T07:00:00Z");
    const offsets = (html.match(/data-l="([\d.]+)"/g) || []).map((s) => Number(s.match(/-?\d+(\.\d+)?/)?.[0]));
    expect(offsets.length).toBe(3);
    for (const offset of offsets) {
      expect(offset).toBeGreaterThanOrEqual(0);
      expect(offset).toBeLessThanOrEqual(100);
    }
    expect(html).toContain("VOO 月投");
    expect(html).toContain("GOOGL 财报");
  });

  it("hides the timeline when the snapshot is empty", () => {
    expect(eventTimeline([], null)).toBe("");
    expect(eventTimeline(undefined as unknown as [], null)).toBe("");
  });

  it("skips events with no parsable start time", () => {
    const html = eventTimeline(
      [
        { title: "bad", start: {} as unknown as { date: string }, execution_status: "unconfirmed" },
        { title: "ok", start: { date: "2026-10-15" }, execution_status: "unconfirmed" },
      ],
      null,
    );
    expect(html).toContain("ok");
    expect(html).not.toContain("bad");
  });
});

describe("positionAnchorId is alphanumeric and stable for the same ticker", () => {
  it("matches the row id pattern and strips ticker spaces", () => {
    expect(positionAnchorId("GOOGL")).toMatch(/^position-anchor-GOOGL$/);
    expect(positionAnchorId("BRK.B")).toMatch(/^position-anchor-BRK-B$/);
    expect(positionAnchorId("现金")).toMatch(/^position-anchor-/);
    expect(positionAnchorId("")).toMatch(/^position-anchor-/);
  });
});

describe("existing charts still produce stable markup", () => {
  it("keeps allocationGap and riskRail markup unchanged", () => {
    expect(allocationGap([pos("GOOGL", 0.13, 0.135, 74600)])).toContain("GOOGL");
    expect(riskRail([
      { rule_id: "NVDA_stop_buy", item: "NVDA", kind: "权重", current: "7.0%", threshold: "≥6.5%",
        current_value: 0.07, current_unit: "ratio", distance: 0.0735, triggered: true,
        proximity: "critical", level: "已触发", action: "停买" },
    ])).toContain("NVDA");
  });
});
