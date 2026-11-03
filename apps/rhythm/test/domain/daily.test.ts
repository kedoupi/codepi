import { describe, expect, it } from "vitest";
import { calculateDailyMetrics, dailyRows } from "../../worker/daily";
import type { StateInput } from "../../worker/models";

function input(): StateInput {
  const date = "2026-11-03";
  const activity = [];
  for (let minute = 0; minute < 30; minute += 1) {
    activity.push({
      sampled_at: `${date}T09:${String(minute).padStart(2, "0")}:00+08:00`,
      net: "office" as const,
      idle_sec: 20,
      locked: false,
      key_idle_sec: 20,
      pointer_idle_sec: 20,
      app_name: minute === 25 ? "示例沟通" : "示例编辑器",
    });
  }
  return {
    date,
    activity,
    devices: [],
    snapshots: [],
    events: [],
    heartbeats: [],
    subjectDeviceIds: [],
    appCategories: { "示例编辑器": "开发", "示例沟通": "沟通" },
  };
}

describe("每日指标", () => {
  it("统计状态、分类、小时和沟通打断", () => {
    const result = calculateDailyMetrics(input(), Date.parse("2026-11-03T01:30:00.000Z"));
    expect(result.metrics.statusMinutes.office_active).toBe(31);
    expect(result.metrics.appCategoryMinutes.开发).toBe(29);
    expect(result.metrics.appCategoryMinutes.沟通).toBe(1);
    expect(result.metrics.hourlyAppCategoryMinutes["09"].开发).toBe(29);
    expect(result.metrics.focus).toEqual({
      segmentCount: 1,
      totalMinutes: 25,
      longestMinutes: 25,
      communicationInterruptions: 1,
    });
  });

  it("生成可幂等写入的状态和指标行", () => {
    const rows = dailyRows(input(), undefined, "2026-11-03T20:30:00.000Z");
    expect(rows.status.date).toBe("2026-11-03");
    expect(rows.status.version).toBe("p4-2026-11-03");
    expect(rows.metrics.metrics.dayType).toBe("workday");
    expect(rows.metrics.computedAt).toBe("2026-11-03T20:30:00.000Z");
  });
});
