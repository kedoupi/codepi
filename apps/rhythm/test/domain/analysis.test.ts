import { describe, expect, it } from "vitest";
import { coverageTier, findAnomalies, qualityDays, trendDays, weekStart } from "../../worker/analysis";
import { dayType } from "../../worker/daily";
import type { DailyMetrics, DailyMetricsRow } from "../../worker/models";

function metrics(date: string, startWorkMinute = 540, commuteToWorkMinutes = 30): DailyMetricsRow {
  const empty: DailyMetrics = {
    statusMinutes: {
      bedroom: 0, living_room: 0, home: 0, office_active: 60,
      office_away: 0, commute: commuteToWorkMinutes, other_network: 0, unknown: 0,
    },
    commuteToWorkMinutes,
    commuteHomeMinutes: 30,
    wakeMinute: 480,
    leaveHomeMinute: 510,
    startWorkMinute,
    leaveComputerMinute: 1080,
    arriveHomeMinute: 1110,
    returnBedroomMinute: 1380,
    officeActiveMinutes: 60,
    homeMinutes: 900,
    bedroomMinutes: 300,
    livingRoomMinutes: 300,
    homeUnknownMinutes: 300,
    officeSpanMinutes: 120,
    focus: { segmentCount: 1, totalMinutes: 30, longestMinutes: 30, communicationInterruptions: 0 },
    afterWorkWorkMachineMinutes: 0,
    weekendWorkMachineMinutes: 0,
    afterWorkRoomMinutes: {},
    weekendRoomMinutes: {},
    appCategoryMinutes: { "开发": 60, "沟通": 0, "文档": 0, "浏览": 0, "其他": 0 },
    hourlyAppCategoryMinutes: {},
    topAppName: "示例编辑器",
    topAppMinutes: 60,
    otherNetworkMinutes: {},
    coverage: {
      ratio: 0.99,
      gapReasonMinutes: { home_scan_missing: 0, phone_scan_missing: 0, work_machine_missing: 0 },
    },
    dayType: "workday",
  };
  return { date, metrics: empty, computedAt: "2026-11-03T20:30:00.000Z", version: "p6-2026-11-05" };
}

describe("趋势、异常和可信度分析", () => {
  it("按日期补出缺失日，并保留未知覆盖率", () => {
    const days = trendDays("2026-11-01", "2026-11-03", [metrics("2026-11-01")]);
    expect(days.map(day => [day.date, day.missing])).toEqual([
      ["2026-11-01", false], ["2026-11-02", true], ["2026-11-03", true],
    ]);
    expect(qualityDays(days)[1]).toMatchObject({
      date: "2026-11-02",
      missing: true,
      coverage: null,
      tier: "unknown",
    });
  });

  it("同类日样本达到五天后按阈值列出异常原因", () => {
    const rows = [
      metrics("2026-10-26"), metrics("2026-10-27"), metrics("2026-10-28"),
      metrics("2026-10-29"), metrics("2026-10-30"), metrics("2026-11-02", 600, 90),
    ];
    const result = findAnomalies(rows, { earlyLateMinutes: 40, commutePercent: 50 }, "2026-11-02");
    expect(result.anomalies).toHaveLength(1);
    expect(result.anomalies[0].reasons.map(reason => reason.metric)).toEqual(["开始办公", "上班通勤"]);
    expect(result.anomalies[0].sampleDays).toBe(5);
    expect(result.insufficientSample).toHaveLength(0);
  });

  it("基线只用该日之前近 30 天的同类日，之后的日子与休息日不参与", () => {
    const rest = (date: string) => {
      const row = metrics(date, 900, 0);
      row.metrics.dayType = "restday";
      return row;
    };
    const rows = [
      metrics("2026-09-01", 300),   // 超过 30 天，不进基线
      metrics("2026-10-26"), metrics("2026-10-27"), metrics("2026-10-28"), metrics("2026-10-29"),
      rest("2026-11-01"),           // 休息日不进工作日基线
      metrics("2026-11-02"),
      metrics("2026-11-03", 900),   // 之后的异常日不能拉偏 11-02 的基线
    ];
    const result = findAnomalies(rows, { earlyLateMinutes: 40, commutePercent: 50 }, "2026-11-02");
    expect(result.anomalies.map(item => item.date)).toEqual(["2026-11-03"]);
    expect(result.insufficientSample.map(item => [item.date, item.sampleDays])).toEqual([["2026-11-02", 4]]);
  });

  it("区间开头样本不足时列出原因，不判异常", () => {
    const result = findAnomalies([metrics("2026-10-26"), metrics("2026-10-27", 900)], { earlyLateMinutes: 40, commutePercent: 50 });
    expect(result.anomalies).toHaveLength(0);
    expect(result.insufficientSample.map(item => item.sampleDays)).toEqual([0, 1]);
  });

  it("覆盖率档位只接受有效比例", () => {
    expect(coverageTier(null)).toBe("unknown");
    expect(coverageTier(0.99)).toBe("high");
    expect(coverageTier(0.95)).toBe("medium");
    expect(coverageTier(0.94)).toBe("low");
  });

  it("星期按日历日计算：周一是工作日、周六是休息日，周一所在周从周一开始", () => {
    expect(dayType("2026-11-02")).toBe("workday");   // 周一
    expect(dayType("2026-11-06")).toBe("workday");   // 周五
    expect(dayType("2026-11-07")).toBe("restday");   // 周六
    expect(dayType("2026-11-08")).toBe("restday");   // 周日
    expect(weekStart("2026-11-02")).toBe("2026-11-02");
    expect(weekStart("2026-11-07")).toBe("2026-11-02");
    expect(weekStart("2026-11-08")).toBe("2026-11-02");
    expect(weekStart("2026-11-09")).toBe("2026-11-09");
    expect(weekStart("2026-01-01")).toBe("2025-12-29");
  });
});

