import { describe, expect, it } from "vitest";
import { calculateDailyMetrics, dailyRows } from "../../worker/daily";
import type { StateInput } from "../../worker/models";
import { phonePresenceByMinute, shanghaiDate } from "../../worker/state";

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

  it("缺采样的分钟不计入专注，缺口超过 2 分钟就结束本段", () => {
    const base = input();
    const editorOnly = base.activity.map(row => ({ ...row, app_name: "示例编辑器" }));
    // 09:10 缺 1 分钟：不打断，但这一分钟不计入专注
    const shortGap = calculateDailyMetrics(
      { ...base, activity: editorOnly.filter(row => !row.sampled_at.includes("T09:10:")) },
      Date.parse("2026-11-03T01:30:00.000Z"),
    );
    expect(shortGap.metrics.focus.segmentCount).toBe(1);
    expect(shortGap.metrics.focus.totalMinutes).toBe(29);
    // 09:10–09:13 缺 4 分钟（仍在 5 分钟新鲜窗口内，状态是「在公司有操作」）：拆成 10 + 16，都不足 25 分钟
    const longGap = calculateDailyMetrics(
      { ...base, activity: editorOnly.filter(row => !/T09:1[0-3]:/.test(row.sampled_at)) },
      Date.parse("2026-11-03T01:30:00.000Z"),
    );
    expect(longGap.metrics.statusMinutes.office_active).toBe(31);
    expect(longGap.metrics.focus).toMatchObject({ segmentCount: 0, totalMinutes: 0, longestMinutes: 0 });
  });

  it("生成可幂等写入的状态和指标行", () => {
    const rows = dailyRows(input(), undefined, "2026-11-03T20:30:00.000Z");
    expect(rows.status.date).toBe("2026-11-03");
    expect(rows.status.version).toBe("p7-2026-11-05");
    expect(rows.metrics.metrics.dayType).toBe("workday");
    expect(rows.metrics.computedAt).toBe("2026-11-03T20:30:00.000Z");
  });

  it("同一批原始数据里没数据的那天各指标为 null，不是 0", () => {
    const busy = input();
    const quiet: StateInput = { ...busy, date: "2026-11-04", subjectDeviceIds: ["dev-a"] };
    // 模拟按 8 天分块后误把别的日子的数据交给这一天：calculateDay 只认当天自己的数据。
    const result = calculateDailyMetrics(quiet);
    expect(result.metrics.officeActiveMinutes).toBeNull();
    expect(result.metrics.afterWorkWorkMachineMinutes).toBeNull();
    expect(result.metrics.weekendWorkMachineMinutes).toBeNull();
    expect(result.metrics.focus).toEqual({ segmentCount: null, totalMinutes: null, longestMinutes: null, communicationInterruptions: null });
    expect(result.metrics.bedroomMinutes).toBeNull();
    expect(result.day.keyboardMouseMinutes).toEqual({ keyboard: null, pointer: null, both: null });
  });

  it("工作日工作机在家里网络有键鼠都算下班后（不论当天是否去公司），休息日有键鼠都算", () => {
    const home = (date: string, hour: number) => ({
      sampled_at: `${date}T${String(hour).padStart(2, "0")}:00:00+08:00`,
      net: "home" as const, idle_sec: 10, locked: false, key_idle_sec: 10, pointer_idle_sec: 10, app_name: "示例编辑器",
    });
    const base = input();
    // 2026-11-03 周二：早上 07:00 在家用工作机（上班前）、09:00 公司、21:00 在家
    const workday = calculateDailyMetrics({ ...base, activity: [home("2026-11-03", 7), ...base.activity, home("2026-11-03", 21)] });
    expect(workday.metrics.afterWorkWorkMachineMinutes).toBe(2);
    expect(workday.metrics.weekendWorkMachineMinutes).toBe(0);
    // 2026-11-04 周三在家办公，没去公司
    const wfh = calculateDailyMetrics({ ...base, date: "2026-11-04", activity: [home("2026-11-04", 10), home("2026-11-04", 11)] });
    expect(wfh.metrics.afterWorkWorkMachineMinutes).toBe(2);
    // 2026-11-01 周日
    const rest = calculateDailyMetrics({ ...base, date: "2026-11-01", activity: [home("2026-11-01", 15)] });
    expect(rest.metrics.dayType).toBe("restday");
    expect(rest.metrics.weekendWorkMachineMinutes).toBe(1);
    expect(rest.metrics.afterWorkWorkMachineMinutes).toBe(0);
  });

  it("缺口原因：心跳缺失、手机没扫到、其余归工作机", () => {
    const base = input();
    const heartbeats = [];
    for (let minute = 0; minute < 60; minute += 5) {
      heartbeats.push({ observed_at: `2026-11-03T20:${String(minute).padStart(2, "0")}:00+08:00`, scan_ok: true });
    }
    const configured = calculateDailyMetrics({ ...base, heartbeats, subjectDeviceIds: ["dev-a"] });
    const reasons = configured.metrics.coverage.gapReasonMinutes;
    expect(reasons.phone_scan_missing).toBeGreaterThan(0);   // 20 点那一小时心跳正常但手机没出现
    expect(reasons.home_scan_missing).toBeGreaterThan(reasons.phone_scan_missing);
    const unconfigured = calculateDailyMetrics({ ...base, heartbeats });
    expect(unconfigured.metrics.coverage.gapReasonMinutes.phone_scan_missing).toBe(0);
    expect(unconfigured.metrics.coverage.gapReasonMinutes.work_machine_missing).toBeGreaterThan(0);
  });

  it("全缺口日的每分钟查找不随数据量平方增长", () => {
    const base = input();
    const heartbeats = [], snapshots = [];
    for (let minute = 0; minute < 8 * 1440; minute += 1) {
      const at = new Date(Date.parse("2026-10-28T00:00:00+08:00") + minute * 60_000).toISOString();
      heartbeats.push({ observed_at: at, scan_ok: false });
      snapshots.push({ device_id: "dev-b", observed_at: at, status: "online" as const });
    }
    const started = performance.now();
    for (let day = 0; day < 8; day += 1) {
      const date = shanghaiDate(Date.parse("2026-10-28T00:00:00+08:00") + day * 86400_000);
      calculateDailyMetrics({ ...base, activity: [], heartbeats, snapshots, subjectDeviceIds: ["dev-a"], date });
    }
    expect(performance.now() - started).toBeLessThan(5000);
  });

  it("周一按工作日、周六按休息日落库与统计", () => {
    const home = (date: string) => ({
      sampled_at: `${date}T20:00:00+08:00`, net: "home" as const, idle_sec: 5, locked: false,
      key_idle_sec: 5, pointer_idle_sec: 5, app_name: "示例编辑器",
    });
    const monday = dailyRows({ ...input(), date: "2026-11-02", activity: [home("2026-11-02")] });
    expect(monday.metrics.metrics.dayType).toBe("workday");
    expect(monday.metrics.metrics.afterWorkWorkMachineMinutes).toBe(1);
    expect(monday.metrics.metrics.weekendWorkMachineMinutes).toBe(0);
    const saturday = dailyRows({ ...input(), date: "2026-11-07", activity: [home("2026-11-07")] });
    expect(saturday.metrics.metrics.dayType).toBe("restday");
    expect(saturday.metrics.metrics.weekendWorkMachineMinutes).toBe(1);
    expect(saturday.metrics.metrics.afterWorkWorkMachineMinutes).toBe(0);
  });

  it("手机缺口原因复用事件区间而不是二十分钟窗口", () => {
    const base = input();
    const result = phonePresenceByMinute({
      ...base,
      subjectDeviceIds: ["dev-a"],
      devices: [{ device_id: "dev-a", room: "客厅" }],
      events: [
        { device_id: "dev-a", event_at: "2026-11-03T00:00:00+08:00", status: "online" },
        { device_id: "dev-a", event_at: "2026-11-03T01:00:00+08:00", status: "offline" },
      ],
    });
    expect(result[30]).toBe(true);
    expect(result[59]).toBe(true);
    expect(result[60]).toBe(false);
    const expired = phonePresenceByMinute({
      ...base,
      date: "2026-11-02",
      subjectDeviceIds: ["dev-a"],
      devices: [{ device_id: "dev-a", room: "客厅" }],
      events: [{ device_id: "dev-a", event_at: "2026-11-01T00:00:00+08:00", status: "online" }],
    });
    expect(expired[721]).toBe(false);
  });
});

