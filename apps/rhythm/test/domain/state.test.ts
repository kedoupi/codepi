import { describe, expect, it } from "vitest";
import { loadCases, toStateInput } from "../../shared/cases";
import { buildStoredWorkBlocks, buildWorkBlocks, calculateDay, dayStartEpoch, minuteLabel, phonePresenceByMinute, shanghaiDate, STATE_THRESHOLDS, workBlockMinGapMinutes } from "../../worker/state";
import type { ActivitySample, DayMetrics, DayStatus, StateInput } from "../../worker/models";

const cases = loadCases();

describe("共享状态用例", () => {
  it("覆盖任务书要求的全部场景", () => {
    expect(cases.map(item => item.name)).toEqual([
      "普通工作日",
      "双设备频段切换",
      "休息日全天在家",
      "手机落家里",
      "旧数据无 net 字段",
      "数据缺口",
      "跨午夜与时区混写",
      "其他网络",
      "pending-offline 抖动",
      "远程操作工作机",
      "起床与回卧室",
      "公司离座",
      "通勤超过上限",
      "旧采样离座与指标",
      "旧采样通勤与到家推断",
      "网络标签 cutoff 边界",
      "整数心跳双设备在家",
      "事件 no-response 沿用快照前态 freshness",
      "长空档在外与扫描缺口",
      "下班长空档在外到家",
    ]);
  });
  for (const item of cases) {
    it(item.name, () => {
      const day = calculateDay(toStateInput(item));
      for (const [minute, status] of Object.entries(item.expect.statusAt)) {
        expect(day.minuteStatuses[Number(minute)], `${item.name} 第 ${minute} 分钟`).toBe(status);
      }
      for (const [minute, evidence] of Object.entries(item.expect.evidenceAt ?? {})) {
        expect(day.minuteEvidence[Number(minute)], `${item.name} 第 ${minute} 分钟类别`).toBe(evidence);
      }
      for (const [minute, detail] of Object.entries(item.expect.detailAt ?? {})) {
        expect(day.minuteDetails[Number(minute)], `${item.name} 第 ${minute} 分钟明细`).toBe(detail);
      }
      const kinds = day.moments.map(moment => moment.kind);
      for (const kind of item.expect.contains ?? []) expect(kinds, `${item.name} 应有 ${kind}`).toContain(kind);
      for (const kind of item.expect.notContains ?? []) expect(kinds, `${item.name} 不应有 ${kind}`).not.toContain(kind);
      for (const [key, value] of Object.entries(item.expect.metrics ?? {})) {
        expect(day.metrics[key as keyof DayMetrics], `${item.name} 指标 ${key}`).toBe(value);
      }
      for (const [category, minutes] of Object.entries(item.expect.appCategories ?? {})) {
        const found = day.appBreakdown.find(entry => entry.category === category);
        expect(found?.minutes, `${item.name} 应用分类 ${category}`).toBe(minutes);
      }
      expect(day.minuteStatuses).toHaveLength(1440);
      expect(day.segments.at(-1)?.endMinute).toBe(1439);
      const momentMinutes = day.moments.map(moment => moment.minute);
      expect(momentMinutes).toEqual([...momentMinutes].sort((a, b) => a - b));
    });
  }
});
describe("开会状态", () => {
  const sample = (minute: number, extra: Partial<ActivitySample> = {}): ActivitySample => ({
    sampled_at: `2026-11-06T${String(Math.floor(minute / 60)).padStart(2, "0")}:${String(minute % 60).padStart(2, "0")}:00+08:00`,
    net: "office", power: "Battery Power", locked: false, key_idle_sec: 10, pointer_idle_sec: 10, app_name: "会议 App", ...extra,
  });

  it("公司网络、电池、有键鼠时记为开会并隔离工位指标", () => {
    const day = calculateDay({ ...emptyInput("2026-11-06"), activity: Array.from({ length: 60 }, (_, offset) => sample(650 + offset)) });
    expect(day.minuteStatuses[650]).toBe("office_meeting");
    expect(day.minuteStatuses[709]).toBe("office_meeting");
    expect(day.metrics.officeMeetingMinutes).toBe(65);
    expect(day.metrics.officeActiveMinutes).toBe(0);
    expect(day.appBreakdown).toEqual([]);
    expect(day.meetingAppBreakdown?.[0]).toMatchObject({ category: "其他", minutes: 60 });
    expect(day.workBlocks[0]).toMatchObject({ kind: "meeting", status: "office_meeting" });
  });

  it("接电无键鼠与锁屏仍为离座，未知电源的旧活跃样本仍为在工位", () => {
    const base = emptyInput("2026-11-06");
    const away = calculateDay({ ...base, activity: [sample(640, { power: "AC Power" }), sample(650, { power: "AC Power", key_idle_sec: 999, pointer_idle_sec: 999 }), sample(660, { power: "AC Power" })] });
    const locked = calculateDay({ ...base, activity: [sample(640, { power: "AC Power" }), sample(650, { power: "Battery Power", locked: true }), sample(660, { power: "AC Power" })] });
    const legacy = calculateDay({ ...base, activity: [sample(650, { power: null })] });
    expect(away.minuteStatuses[650]).toBe("office_away");
    expect(locked.minuteStatuses[650]).toBe("office_away");
    expect(legacy.minuteStatuses[650]).toBe("office_active");
  });

  it("在工位转开会或开会转回工位不生成离开电脑", () => {
    const day = calculateDay({ ...emptyInput("2026-11-06"), activity: Array.from({ length: 21 }, (_, offset) => sample(640 + offset, offset >= 10 && offset < 20 ? {} : { power: "AC Power" })) });
    expect(day.moments.filter(moment => moment.kind === "leave_computer")).toEqual([]);
    expect(day.moments.filter(moment => moment.kind === "start_work").map(moment => moment.minute)).toEqual([640]);
  });
  it("在工位与开会之间的接电空档，以及开会之间的空档，记为离座", () => {
    const base = emptyInput("2026-11-06");
    const sampleAt = (minute: number, power: string, idle = 10) => sample(minute, { power, key_idle_sec: idle, pointer_idle_sec: idle });
    const day = calculateDay({ ...base, activity: [
      sampleAt(640, "接电"), sampleAt(650, "接电", 999), sampleAt(660, "电池"),
      sampleAt(680, "电池"), sampleAt(690, "接电", 999), sampleAt(700, "电池"),
    ] });
    expect(day.minuteStatuses[650]).toBe("office_away");
    expect(day.minuteStatuses[690]).toBe("office_away");
  });
  it("最后一段开会转通勤时记录一次离开电脑", () => {
    const at = (minute: number, power: string) => sample(minute, { power });
    const day = calculateDay({
      ...emptyInput("2026-11-06"),
      activity: [at(620, "接电"), at(650, "电池")],
      devices: [{ device_id: "dev-a", room: "客厅" }],
      snapshots: [
        { device_id: "dev-a", observed_at: "2026-11-06T09:40:00+08:00", status: "online", room: "客厅" },
        { device_id: "dev-a", observed_at: "2026-11-06T12:10:00+08:00", status: "online", room: "客厅" },
      ],
      subjectDeviceIds: ["dev-a"],
    });
    expect(day.minuteStatuses[656]).toBe("commute");
    expect(day.moments.filter(moment => moment.kind === "leave_computer").map(moment => moment.minute)).toEqual([656]);
  });
});

function emptyInput(date: string): StateInput {
  return {
    date,
    activity: [],
    devices: [],
    snapshots: [],
    events: [],
    heartbeats: [],
    subjectDeviceIds: [],
    appCategories: {},
  };
}

describe("工作时段块", () => {
  it("合并恰好 1 分钟 away/unknown，保留前 3 个 App 与排序", () => {
    const statuses: DayStatus[] = new Array(1440).fill("unknown");
    const evidence = new Array(1440).fill("no_data" as const);
    const samples: Array<ActivitySample | null> = new Array(1440).fill(null);
    const apps = ["App A", "App B", "App C", "App A", "App D", "App E", "App B", "App C"];
    const active = (minute: number, app?: string) => {
      statuses[minute] = "office_active"; evidence[minute] = "seen";
      samples[minute] = app ? { sampled_at: `2026-11-05T00:${String(minute).padStart(2, "0")}:00+08:00`, net: "office", key_idle_sec: 10, app_name: app } : null;
    };
    for (let minute = 100; minute <= 104; minute += 1) active(minute, apps[minute - 100]);
    statuses[105] = "office_away"; evidence[105] = "inferred";
    active(106, "App C"); active(107, "App B");
    statuses[108] = "commute"; evidence[108] = "inferred";
    active(109, "App C");
    statuses[110] = "unknown"; evidence[110] = "no_data";
    active(111, "App C");
    statuses[112] = "office_away"; evidence[112] = "inferred";
    statuses[113] = "office_away"; evidence[113] = "inferred";
    active(114, "App D");
    const blocks = buildWorkBlocks(samples, statuses, evidence);
    expect(workBlockMinGapMinutes).toBe(2);
    expect(blocks.map(block => block.kind)).toEqual(["active", "other", "active", "away", "active"]);
    expect(blocks[0]).toMatchObject({ startMinute: 100, endMinute: 107, minutes: 8, gapMinutes: 1, inferred: false, appsKind: "app" });
    expect(blocks[0].topApps.map(app => app.name)).toEqual(["App A", "App B", "App C"]);
    expect(blocks[0].topApps.map(app => app.minutes)).toEqual([2, 2, 2]);
    expect(blocks[1]).toMatchObject({ status: "commute", startMinute: 108, endMinute: 108, gapMinutes: 0 });
    expect(blocks[2]).toMatchObject({ startMinute: 109, endMinute: 111, gapMinutes: 1 });
    expect(blocks[3]).toMatchObject({ startMinute: 112, endMinute: 113, minutes: 2, gapMinutes: 0 });
  });

  it("无公司分钟为空，历史块不携带分类 App", () => {
    const statuses: DayStatus[] = new Array(1440).fill("unknown");
    const evidence = new Array(1440).fill("no_data" as const);
    expect(buildWorkBlocks(new Array(1440).fill(null), statuses, evidence)).toEqual([]);
    const segments = [
      { status: "office_active" as const, startMinute: 540, endMinute: 544, evidence: "seen" as const },
      { status: "office_away" as const, startMinute: 545, endMinute: 545, evidence: "inferred" as const },
      { status: "office_active" as const, startMinute: 546, endMinute: 549, evidence: "seen" as const },
    ];
    const blocks = buildStoredWorkBlocks(segments);
    expect(blocks[0]).toMatchObject({ kind: "active", appsKind: "none", apps: [], topApps: [], primaryApp: null, gapMinutes: 1 });
  });

  it("跨午夜工作块从 00:00 开始并保留边界标签", () => {
    const statuses: DayStatus[] = new Array(1440).fill("unknown");
    const evidence = new Array(1440).fill("no_data" as const);
    statuses[0] = "office_active"; statuses[1] = "office_away"; statuses[2] = "office_active";
    evidence[0] = "seen"; evidence[1] = "inferred"; evidence[2] = "seen";
    const block = buildWorkBlocks(new Array(1440).fill(null), statuses, evidence)[0];
    expect(block).toMatchObject({ startMinute: 0, endMinute: 2, startLabel: "00:00", endLabel: "00:02", gapMinutes: 1 });
  });
});

describe("缺失数据永远是未知", () => {
  it("没有任何上游数据时全天未知，且不产生离家或到家时刻", () => {
    const day = calculateDay(emptyInput("2026-11-06"));
    expect(new Set(day.minuteStatuses)).toEqual(new Set(["unknown"]));
    expect(day.moments).toEqual([]);
    expect(day.metrics).toMatchObject({
      commuteToWorkMinutes: null, commuteHomeMinutes: null, officeActiveMinutes: null,
      homeMinutes: null, bedroomMinutes: null, livingRoomMinutes: null, homeUnknownMinutes: null,
    });
    expect(day.appBreakdown).toEqual([]);
    expect(day.keyboardMouseMinutes).toEqual({ keyboard: null, pointer: null, both: null });
  });

  it("快照 pending-offline 无前态或前态离线都按在线处理", () => {
    const base = { ...emptyInput("2026-11-07"), subjectDeviceIds: ["dev-a"] };
    const first = calculateDay({ ...base, snapshots: [
      { device_id: "dev-a", observed_at: "2026-11-07T00:00:00+08:00", status: "pending-offline", room: "客厅" },
    ] });
    expect(first.minuteStatuses[0]).toBe("living_room");
    const afterOffline = calculateDay({ ...base, snapshots: [
      { device_id: "dev-a", observed_at: "2026-11-07T00:00:00+08:00", status: "offline", room: null },
      { device_id: "dev-a", observed_at: "2026-11-07T00:02:00+08:00", status: "pending-offline", room: "客厅" },
    ] });
    expect(afterOffline.minuteStatuses[2]).toBe("living_room");
  });

  it("事件 pending-offline 跳过，不把二十分钟快照 freshness 延长为事件区间", () => {
    const day = calculateDay({
      ...emptyInput("2026-11-07"),
      subjectDeviceIds: ["dev-a"],
      snapshots: [{ device_id: "dev-a", observed_at: "2026-11-07T00:00:00+08:00", status: "online", room: "客厅" }],
      events: [{ device_id: "dev-a", event_at: "2026-11-07T00:01:00+08:00", status: "pending-offline" }],
    });
    expect(day.minuteStatuses[20]).toBe("living_room");
    expect(day.minuteStatuses[21]).toBe("unknown");
  });
  it("同一时刻两台设备一台在线一台离线，输入顺序不影响在家判断", () => {
    const base = {
      ...emptyInput("2026-11-08"),
      subjectDeviceIds: ["dev-a", "dev-b"],
      devices: [{ device_id: "dev-a", room: "客厅" }, { device_id: "dev-b", room: "客厅" }],
    };
    const snapshots = [
      { device_id: "dev-a", observed_at: "2026-11-08T00:00:00+08:00", status: "online" as const, room: "客厅" },
      { device_id: "dev-b", observed_at: "2026-11-08T00:00:00+08:00", status: "offline" as const, room: null },
    ];
    const first = calculateDay({ ...base, snapshots });
    const second = calculateDay({ ...base, snapshots: [...snapshots].reverse() });
    expect(first.minuteStatuses[0]).toBe("living_room");
    expect(second.minuteStatuses[0]).toBe("living_room");
    expect(first.minuteStatuses).toEqual(second.minuteStatuses);
  });

  it("只把参与合并的设备计入：离线参与设备决定不在家，全部过期才未知", () => {
    const active = { sampled_at: "2026-11-04T09:00:00+08:00", idle_sec: 30, locked: false, key_idle_sec: 20, pointer_idle_sec: 40 };
    const base = {
      ...emptyInput("2026-11-04"),
      subjectDeviceIds: ["dev-a", "dev-b"],
      devices: [{ device_id: "dev-a", room: "客厅" }, { device_id: "dev-b", room: "客厅" }],
      activity: [active],
    };
    const allOffline = calculateDay({ ...base, events: [
      { device_id: "dev-a", event_at: "2026-11-04T08:00:00+08:00", status: "offline" },
      { device_id: "dev-b", event_at: "2026-11-04T08:00:00+08:00", status: "offline" },
    ] });
    expect(allOffline.minuteStatuses[540]).toBe("office_active");
    const expiredAndOffline = calculateDay({ ...base,
      snapshots: [{ device_id: "dev-a", observed_at: "2026-11-04T08:00:00+08:00", status: "online", room: "客厅" }],
      events: [{ device_id: "dev-b", event_at: "2026-11-04T08:00:00+08:00", status: "offline" }],
    });
    expect(expiredAndOffline.minuteStatuses[540]).toBe("office_active");
    const allExpired = calculateDay({ ...base, snapshots: [
      { device_id: "dev-a", observed_at: "2026-11-04T08:00:00+08:00", status: "online", room: "客厅" },
      { device_id: "dev-b", observed_at: "2026-11-04T08:00:00+08:00", status: "online", room: "客厅" },
    ] });
    expect(allExpired.minuteStatuses[540]).toBe("unknown");
    const oneOnline = calculateDay({ ...base, events: [
      { device_id: "dev-a", event_at: "2026-11-04T08:00:00+08:00", status: "offline" },
      { device_id: "dev-b", event_at: "2026-11-04T08:00:00+08:00", status: "online" },
    ] });
    expect(oneOnline.minuteStatuses[540]).toBe("living_room");
  });

  it("同设备同一时刻按状态排序，多台在线按设备 ID 选择房间", () => {
    const base = {
      ...emptyInput("2026-11-08"),
      subjectDeviceIds: ["dev-b", "dev-a"],
      devices: [{ device_id: "dev-b", room: "客厅" }, { device_id: "dev-a", room: "卧室" }],
    };
    const rows = [
      { device_id: "dev-a", observed_at: "2026-11-08T00:00:00+08:00", status: "offline" as const, room: null },
      { device_id: "dev-a", observed_at: "2026-11-08T00:00:00+08:00", status: "online" as const, room: "卧室" },
      { device_id: "dev-b", observed_at: "2026-11-08T00:00:00+08:00", status: "online" as const, room: "客厅" },
    ];
    const first = calculateDay({ ...base, snapshots: rows });
    const second = calculateDay({ ...base, snapshots: [...rows].reverse() });
    expect(first.minuteStatuses[0]).toBe("bedroom");
    expect(second.minuteStatuses[0]).toBe("bedroom");
  });
  it("事件 no-response 重新起算区间，并延续 offline 前态", () => {
    const base = { ...emptyInput("2026-11-08"), subjectDeviceIds: ["dev-a"], devices: [{ device_id: "dev-a", room: "客厅" }] };
    const refreshed = calculateDay({ ...base, events: [
      { device_id: "dev-a", event_at: "2026-11-06T00:00:00+08:00", status: "online" as const },
      { device_id: "dev-a", event_at: "2026-11-07T12:00:00+08:00", status: "no-response" as const },
    ] });
    const expired = calculateDay({ ...base, events: [
      { device_id: "dev-a", event_at: "2026-11-06T00:00:00+08:00", status: "online" as const },
    ] });
    expect(refreshed.minuteStatuses[1439]).toBe("living_room");
    expect(expired.minuteStatuses[0]).toBe("unknown");
    const offline = phonePresenceByMinute({ ...base, events: [
      { device_id: "dev-a", event_at: "2026-11-08T00:00:00+08:00", status: "offline" as const },
      { device_id: "dev-a", event_at: "2026-11-08T00:01:00+08:00", status: "no-response" as const },
    ] });
    expect(offline[10]).toBe(false);
  });

  it("no-response 维持单台设备前一状态并刷新新鲜度，没有前态时保持未知", () => {
    const base = { ...emptyInput("2026-11-08"), subjectDeviceIds: ["dev-a"], devices: [{ device_id: "dev-a", room: "客厅" }] };
    const snapshot = calculateDay({ ...base, snapshots: [
      { device_id: "dev-a", observed_at: "2026-11-08T00:00:00+08:00", status: "online" as const, room: "客厅" },
      { device_id: "dev-a", observed_at: "2026-11-08T00:02:00+08:00", status: "no-response" as const, room: "卧室" },
    ] });
    expect(snapshot.minuteStatuses[10]).toBe("living_room");
    expect(snapshot.minuteStatuses[21]).toBe("living_room");
    expect(snapshot.minuteStatuses[23]).toBe("unknown");
    const event = calculateDay({ ...base, events: [
      { device_id: "dev-a", event_at: "2026-11-08T00:00:00+08:00", status: "online" as const },
      { device_id: "dev-a", event_at: "2026-11-08T00:01:00+08:00", status: "no-response" as const },
    ] });
    expect(event.minuteStatuses[10]).toBe("living_room");
    const initial = calculateDay({ ...base, events: [{ device_id: "dev-a", event_at: "2026-11-08T00:00:00+08:00", status: "no-response" as const }] });
    expect(initial.minuteStatuses[0]).toBe("unknown");
    const snapshotThenEvent = calculateDay({ ...base,
      snapshots: [{ device_id: "dev-a", observed_at: "2026-11-08T00:00:00+08:00", status: "online" as const, room: "客厅" }],
      events: [{ device_id: "dev-a", event_at: "2026-11-08T00:10:00+08:00", status: "no-response" as const }],
    });
    expect(snapshotThenEvent.minuteStatuses[30]).toBe("living_room");
    expect(snapshotThenEvent.minuteStatuses[31]).toBe("unknown");
  });
  it("no-response 不复活已过期的 online 或 offline 前态", () => {
    const base = { ...emptyInput("2026-11-08"), subjectDeviceIds: ["dev-a"], devices: [{ device_id: "dev-a", room: "客厅" }] };
    const staleOnline = calculateDay({ ...base, snapshots: [
      { device_id: "dev-a", observed_at: "2026-11-08T00:00:00+08:00", status: "online" as const, room: "客厅" },
      { device_id: "dev-a", observed_at: "2026-11-08T02:00:00+08:00", status: "no-response" as const },
    ] });
    expect(staleOnline.minuteStatuses[130]).toBe("unknown");
    const staleEvent = calculateDay({ ...base, events: [
      { device_id: "dev-a", event_at: "2026-11-06T00:00:00+08:00", status: "online" as const },
      { device_id: "dev-a", event_at: "2026-11-08T12:00:00+08:00", status: "no-response" as const },
    ] });
    expect(staleEvent.minuteStatuses[720]).toBe("unknown");
    const staleOffline = calculateDay({ ...base, snapshots: [
      { device_id: "dev-a", observed_at: "2026-11-08T00:00:00+08:00", status: "offline" as const },
      { device_id: "dev-a", observed_at: "2026-11-08T02:00:00+08:00", status: "no-response" as const },
    ], activity: [{ sampled_at: "2026-11-04T09:00:00+08:00", idle_sec: 30, locked: false, key_idle_sec: 20, pointer_idle_sec: 40 }] });
    expect(staleOffline.minuteStatuses[130]).toBe("unknown");
    const staleLegacyOffline = calculateDay({ ...emptyInput("2026-11-04"), subjectDeviceIds: ["dev-a"], devices: [{ device_id: "dev-a", room: "客厅" }], snapshots: [
      { device_id: "dev-a", observed_at: "2026-11-04T00:00:00+08:00", status: "offline" as const },
      { device_id: "dev-a", observed_at: "2026-11-04T02:00:00+08:00", status: "no-response" as const },
    ], activity: [{ sampled_at: "2026-11-04T09:00:00+08:00", idle_sec: 30, locked: false, key_idle_sec: 20, pointer_idle_sec: 40 }] });
    expect(staleLegacyOffline.minuteStatuses[540]).toBe("unknown");
  });

  it("只有无前态 no-response 时，在家相关指标保持未知而不是 0", () => {
    const day = calculateDay({ ...emptyInput("2026-11-08"), subjectDeviceIds: ["dev-a"], events: [
      { device_id: "dev-a", event_at: "2026-11-08T00:00:00+08:00", status: "no-response" },
    ] });
    expect(day.metrics.homeMinutes).toBeNull();
    expect(day.metrics.homeUnknownMinutes).toBeNull();
    expect(day.metrics.bedroomMinutes).toBeNull();
    expect(day.metrics.livingRoomMinutes).toBeNull();
  });

  it("手机掉线只是没有在家证据，不会被算成离家", () => {
    const day = calculateDay({
      ...emptyInput("2026-11-08"),
      subjectDeviceIds: ["dev-a"],
      snapshots: [
        { device_id: "dev-a", observed_at: "2026-11-08T00:00:00+08:00", status: "online", room: "客厅" },
        { device_id: "dev-a", observed_at: "2026-11-08T00:05:00+08:00", status: "offline", room: null },
      ],
    });
    expect(day.minuteStatuses[0]).toBe("living_room");
    expect(day.minuteStatuses[5]).toBe("unknown");
    expect(day.moments.map(moment => moment.kind)).not.toContain("leave_home");
  });
});

describe("通勤是推断且有上限", () => {
  it("缺口超过上限时不报告通勤，缺口之内才报告", () => {
    const base = { ...emptyInput("2026-11-09"), subjectDeviceIds: ["dev-a"] };
    const snapshot = { device_id: "dev-a", observed_at: "2026-11-09T07:00:00+08:00", status: "online" as const, room: "卧室" };
    const within = calculateDay({
      ...base,
      snapshots: [snapshot],
      activity: [{ sampled_at: "2026-11-09T09:00:00+08:00", net: "office", idle_sec: 30, locked: false, key_idle_sec: 20, pointer_idle_sec: 40 }],
    });
    expect(within.minuteStatuses[500]).toBe("commute");
    expect(within.minuteEvidence[500]).toBe("inferred");
    expect(within.metrics.commuteToWorkMinutes).toBeGreaterThan(0);

    const beyond = calculateDay({
      ...base,
      snapshots: [snapshot],
      activity: [{ sampled_at: "2026-11-09T14:00:00+08:00", net: "office", idle_sec: 30, locked: false, key_idle_sec: 20, pointer_idle_sec: 40 }],
    });
    expect(beyond.minuteStatuses[60]).toBe("unknown");
    expect(beyond.metrics.commuteToWorkMinutes).toBe(0);
    expect(beyond.minuteStatuses).not.toContain("commute");
  });
});
describe("在外状态", () => {
  it("17:51 最后活动到 20:49 到家只把 17:52–20:48 记为在外", () => {
    const item = cases.find(candidate => candidate.name === "下班长空档在外到家")!;
    const day = calculateDay(toStateInput(item));
    expect(day.minuteStatuses[1071]).toBe("office_active");
    expect(day.minuteStatuses.slice(1072, 1249).every(status => status === "outside")).toBe(true);
    expect(day.minuteStatuses[1249]).toBe("living_room");
    expect(day.moments.filter(moment => moment.kind === "leave_computer").map(moment => moment.minute)).toEqual([1072]);
    expect(day.moments.map(moment => moment.kind)).not.toContain("arrive_home");
    expect(day.minuteStatuses.filter(status => status === "outside")).toHaveLength(177);
  });

  it("同形状的 120 分钟以内缺口仍为通勤", () => {
    const input = toStateInput(cases.find(candidate => candidate.name === "下班长空档在外到家")!);
    input.events = input.events.map(event => event.event_at.startsWith("2026-11-11T20:49")
      ? { ...event, event_at: "2026-11-11T19:00:00+08:00" }
      : event.event_at.startsWith("2026-11-11T20:50")
        ? { ...event, event_at: "2026-11-11T19:01:00+08:00" }
        : event);
    const day = calculateDay(input);
    expect(day.minuteStatuses[1100]).toBe("commute");
    expect(day.minuteStatuses).not.toContain("outside");
  });

  it("未配置手机、没有办公锚点、历史日未回家都不推断在外", () => {
    const exact = toStateInput(cases.find(candidate => candidate.name === "下班长空档在外到家")!);
    const noPhone = calculateDay({ ...exact, subjectDeviceIds: [] });
    expect(noPhone.minuteStatuses).not.toContain("outside");

    const noOffice = calculateDay({ ...exact, activity: [] });
    expect(noOffice.minuteStatuses).not.toContain("outside");

    const noReturn = calculateDay({ ...exact, events: exact.events.filter(event => !event.event_at.startsWith("2026-11-11T20:49") && !event.event_at.startsWith("2026-11-11T20:50")) });
    expect(noReturn.minuteStatuses).not.toContain("outside");
  });

  it("当天尾部手机离线或扫描失败时保持未知", () => {
    const exact = toStateInput(cases.find(candidate => candidate.name === "下班长空档在外到家")!);
    const offlineAtNight = calculateDay({
      ...exact,
      events: [...exact.events.filter(event => !event.event_at.startsWith("2026-11-11T20:49") && !event.event_at.startsWith("2026-11-11T20:50")), { device_id: "dev-a", event_at: "2026-11-11T20:00:00+08:00", status: "offline" }],
    }, Date.parse("2026-11-11T23:00:00+08:00"));
    expect(offlineAtNight.minuteStatuses[1200]).toBe("unknown");
    expect(offlineAtNight.minuteStatuses).not.toContain("outside");

    const scanFailed = calculateDay({ ...exact, heartbeats: exact.heartbeats.map(row => ({ ...row, scan_ok: false })) });
    expect(scanFailed.minuteStatuses[1200]).toBe("unknown");
    expect(scanFailed.minuteStatuses).not.toContain("outside");
  });
});

describe("历史手机区间与旧网络推断", () => {
  const active = { sampled_at: "2026-11-04T09:00:00+08:00", idle_sec: 30, locked: false, key_idle_sec: 20, pointer_idle_sec: 40 };
  const phone = { device_id: "dev-a", name: "示例手机", room: "客厅" };

  it("旧采样在手机离线且有操作时推断公司", () => {
    const day = calculateDay({ ...emptyInput("2026-11-04"), subjectDeviceIds: ["dev-a"], devices: [phone], events: [
      { device_id: "dev-a", event_at: "2026-11-04T08:00:00+08:00", status: "offline" },
    ], activity: [active] });
    expect(day.minuteStatuses[540]).toBe("office_active");
    expect(day.minuteEvidence[540]).toBe("inferred");
    expect(day.minuteDetails[540]).toContain("网络标签上线前");
  });

  it("旧采样手机状态未知时保持未知，cutoff 后缺失 net 也保持未知", () => {
    const unknown = calculateDay({ ...emptyInput("2026-11-04"), subjectDeviceIds: ["dev-a"], devices: [phone], activity: [active] });
    expect(unknown.minuteStatuses[540]).toBe("unknown");
    const afterCutoff = calculateDay({ ...emptyInput("2026-11-05"), subjectDeviceIds: ["dev-a"], devices: [phone], events: [
      { device_id: "dev-a", event_at: "2026-11-05T12:00:00+08:00", status: "offline" },
    ], activity: [{ ...active, sampled_at: "2026-11-05T13:00:00+08:00" }] });
    expect(afterCutoff.minuteStatuses[780]).toBe("unknown");
  });

  it("cutoff 后 office 网络仍按看到处理", () => {
    const day = calculateDay({ ...emptyInput("2026-11-05"), activity: [{ ...active, sampled_at: "2026-11-05T13:00:00+08:00", net: "office" }] });
    expect(day.minuteStatuses[780]).toBe("office_active");
    expect(day.minuteEvidence[780]).toBe("seen");
  });

  it("心跳覆盖的事件区间标 seen，首个心跳前标 inferred，心跳缺失后未知", () => {
    const base = { ...emptyInput("2026-11-06"), subjectDeviceIds: ["dev-a"], devices: [phone], events: [
      { device_id: "dev-a", event_at: "2026-11-06T00:00:00+08:00", status: "online" as const },
    ] };
    const inferred = calculateDay(base);
    expect(inferred.minuteEvidence[10]).toBe("inferred");
    const covered = calculateDay({ ...base, heartbeats: [{ observed_at: "2026-11-06T00:00:00+08:00", scan_ok: true }] });
    expect(covered.minuteEvidence[10]).toBe("seen");
    expect(covered.minuteStatuses[21]).toBe("unknown");
  });

  it("事件区间超过 36 小时失效，pending-offline 不改变状态", () => {
    const long = calculateDay({ ...emptyInput("2026-11-07"), subjectDeviceIds: ["dev-a"], devices: [phone], events: [
      { device_id: "dev-a", event_at: "2026-11-06T00:00:00+08:00", status: "online" },
    ] });
    expect(long.minuteStatuses[721]).toBe("unknown");
    const pending = calculateDay({ ...emptyInput("2026-11-08"), subjectDeviceIds: ["dev-a"], devices: [phone], events: [
      { device_id: "dev-a", event_at: "2026-11-08T00:00:00+08:00", status: "online" },
      { device_id: "dev-a", event_at: "2026-11-08T00:01:00+08:00", status: "pending-offline" },
    ] });
    expect(pending.minuteStatuses[10]).toBe("living_room");
  });

  it("窗口内较早成功心跳仍覆盖最近失败心跳", () => {
    const day = calculateDay({
      ...emptyInput("2026-11-09"), subjectDeviceIds: ["dev-a"], devices: [phone], events: [
        { device_id: "dev-a", event_at: "2026-11-09T00:00:00+08:00", status: "online" },
      ], heartbeats: [
        { observed_at: "2026-11-09T00:00:00+08:00", scan_ok: true },
        { observed_at: "2026-11-09T00:10:00+08:00", scan_ok: false },
      ],
    });
    expect(day.minuteEvidence[15]).toBe("seen");
    expect(day.minuteStatuses[15]).toBe("living_room");
  });
});

describe("北京时间切天", () => {
  it("日界线按 Asia/Shanghai 计算", () => {
    expect(shanghaiDate(Date.parse("2026-10-26T16:00:00Z"))).toBe("2026-10-27");
    expect(shanghaiDate(Date.parse("2026-10-26T15:59:59Z"))).toBe("2026-10-26");
    expect(dayStartEpoch("2026-10-26")).toBe(Date.parse("2026-10-25T16:00:00Z"));
    expect(Number.isNaN(dayStartEpoch("2026-02-30"))).toBe(true);
    expect(minuteLabel(0)).toBe("00:00");
    expect(minuteLabel(1439)).toBe("23:59");
  });

  it("同一时刻写成 +08:00 或 Z 得到同一个状态", () => {
    const offset = calculateDay({
      ...emptyInput("2026-11-10"),
      activity: [{ sampled_at: "2026-11-10T09:00:00+08:00", net: "office", idle_sec: 30, locked: false, key_idle_sec: 20, pointer_idle_sec: 40 }],
    });
    const utc = calculateDay({
      ...emptyInput("2026-11-10"),
      activity: [{ sampled_at: "2026-11-10T01:00:00Z", net: "office", idle_sec: 30, locked: false, key_idle_sec: 20, pointer_idle_sec: 40 }],
    });
    expect(utc.minuteStatuses).toEqual(offset.minuteStatuses);
  });

  it("阈值常量都有可读默认值", () => {
    expect(STATE_THRESHOLDS.activityFreshnessMinutes).toBeGreaterThan(0);
    expect(STATE_THRESHOLDS.homeFreshnessMinutes).toBeGreaterThan(0);
    expect(STATE_THRESHOLDS.activeIdleSeconds).toBeGreaterThan(0);
    expect(STATE_THRESHOLDS.officeAwayMaxMinutes).toBeGreaterThan(0);
    expect(STATE_THRESHOLDS.commuteMaxMinutes).toBeGreaterThan(0);
  });
});

describe("当天只计算已经到达的分钟", () => {
  it("now=12:00 时 12:00 之后标为未到，指标不计入未来样本", () => {
    const now = Date.parse("2026-11-12T04:00:00Z");
    const day = calculateDay({
      ...emptyInput("2026-11-12"),
      appCategories: { "示例编辑器": "AI 编程" },
      activity: [
        { sampled_at: "2026-11-12T11:59:00+08:00", net: "office", idle_sec: 30, locked: false, key_idle_sec: 20, pointer_idle_sec: 40, app_name: "示例编辑器" },
        { sampled_at: "2026-11-12T12:00:00+08:00", net: "office", idle_sec: 30, locked: false, key_idle_sec: 20, pointer_idle_sec: 40, app_name: "示例编辑器" },
        { sampled_at: "2026-11-12T12:01:00+08:00", net: "office", idle_sec: 30, locked: false, key_idle_sec: 20, pointer_idle_sec: 40, app_name: "示例编辑器" },
      ],
    }, now);
    expect(day.minuteStatuses[720]).toBe("office_active");
    expect(day.minuteStatuses[721]).toBe("not_arrived");
    expect(day.minuteStatuses[1439]).toBe("not_arrived");
    expect(day.metrics.officeActiveMinutes).toBe(2);
    expect(day.appBreakdown[0].minutes).toBe(2);
    expect(day.keyboardMouseMinutes).toEqual({ keyboard: 2, pointer: 2, both: 2 });
  });

  it("过去日期仍计算完整一天，不产生未到状态", () => {
    const day = calculateDay(emptyInput("2026-11-11"), Date.parse("2026-11-12T04:00:00Z"));
    expect(day.minuteStatuses).not.toContain("not_arrived");
    expect(day.segments.at(-1)?.endMinute).toBe(1439);
  });

  it("超过容差的未来样本不参与当天计算", () => {
    const now = Date.parse("2026-11-13T04:00:00Z");
    const day = calculateDay({
      ...emptyInput("2026-11-13"),
      activity: [{ sampled_at: "2026-11-13T12:02:01+08:00", net: "office", idle_sec: 30, locked: false, key_idle_sec: 20, pointer_idle_sec: 40 }],
    }, now);
    expect(day.minuteStatuses[721]).toBe("not_arrived");
    expect(day.appBreakdown).toEqual([]);
    expect(day.keyboardMouseMinutes).toEqual({ keyboard: null, pointer: null, both: null });
  });
});

describe("只算办公室且有键鼠的分钟", () => {
  it("应用分类只统计 net=office 且有键鼠的分钟", () => {
    const day = calculateDay({
      ...emptyInput("2026-11-11"),
      appCategories: { "示例编辑器": "AI 编程" },
      activity: [
        { sampled_at: "2026-11-11T09:00:00+08:00", net: "home", idle_sec: 30, locked: false, key_idle_sec: 20, pointer_idle_sec: 40, app_name: "示例编辑器" },
        { sampled_at: "2026-11-11T10:00:00+08:00", net: "office", idle_sec: 900, locked: false, app_name: "示例编辑器" },
        { sampled_at: "2026-11-11T11:00:00+08:00", net: "office", idle_sec: 30, locked: false, key_idle_sec: 20, pointer_idle_sec: 40, app_name: "示例编辑器" },
        { sampled_at: "2026-11-11T12:00:00+08:00", net: "other", idle_sec: 30, locked: false, key_idle_sec: 20, pointer_idle_sec: 40, app_name: "示例编辑器" },
      ],
    });
    expect(day.appBreakdown).toHaveLength(1);
    expect(day.appBreakdown[0].category).toBe("AI 编程");
    expect(day.appBreakdown[0].minutes).toBe(1);
    expect(day.keyboardMouseMinutes).toEqual({ keyboard: 1, pointer: 1, both: 1 });
  });

  it("未归类的应用一律算其他", () => {
    const day = calculateDay({
      ...emptyInput("2026-11-12"),
      activity: [{ sampled_at: "2026-11-12T09:00:00+08:00", net: "office", idle_sec: 30, locked: false, key_idle_sec: 20, pointer_idle_sec: 40, app_name: "未登记应用" }],
    });
    expect(day.appBreakdown[0].category).toBe("其他");
  });
});
