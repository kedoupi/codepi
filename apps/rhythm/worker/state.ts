import type {
  ActivitySample, AppBreakdown, AppCategory, DayComputation, DayStatus, Evidence, HomeDevice,
  HomeEvent, HomeSnapshot, KeyMoment, RhythmStatus, StateInput, StatusSegment,
} from "./models";

/**
 * Named thresholds. Every number that changes a conclusion lives here so the
 * shared fixtures can assert one documented default instead of magic values.
 */
export const STATE_THRESHOLDS = {
  /** A work-machine sample stays usable for this many minutes. */
  activityFreshnessMinutes: 5,
  /**
   * A home-device observation stays usable for this many minutes. The home
   * scanner reports every device on a fixed interval, so the window has to be
   * wider than one scan interval or the home route flickers to 未知 between
   * two scans.
   */
  homeFreshnessMinutes: 20,
  /** Idle seconds below this count as recent keyboard or mouse activity. */
  activeIdleSeconds: 180,
  /** How far back "最近几分钟有键鼠" looks for activity. */
  activityLookbackMinutes: 5,
  /** Longest gap that may still be reported as 公司 · 离座. */
  officeAwayMaxMinutes: 120,
  /** Longest gap that may still be reported as 通勤. */
  commuteMaxMinutes: 120,
  /** 起床 is only claimed from this minute onwards when the day starts inside the living room. */
  wakeEarliestMinute: 240,
  /** Future upstream timestamps within this tolerance are accepted for the current minute. */
  futureTimestampToleranceSeconds: 60,
} as const;

/**
 * Asia/Shanghai has used a fixed +08:00 offset since 1991, so day boundaries
 * are computed with that offset while every incoming timestamp keeps its own
 * offset (`+08:00` and `Z` are both accepted and normalised to an instant).
 */
const SHANGHAI_OFFSET_MS = 8 * 60 * 60 * 1000;
const MINUTES_PER_DAY = 1440;
const MS_PER_MINUTE = 60_000;

export function dayStartEpoch(date: string): number {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!match) return NaN;
  const year = Number(match[1]), month = Number(match[2]), day = Number(match[3]);
  const utc = Date.UTC(year, month - 1, day) - SHANGHAI_OFFSET_MS;
  const check = new Date(utc + SHANGHAI_OFFSET_MS);
  return check.getUTCFullYear() === year && check.getUTCMonth() === month - 1 && check.getUTCDate() === day ? utc : NaN;
}

export function shanghaiDate(value: string | number): string {
  const epoch = typeof value === "number" ? value : Date.parse(value);
  if (!Number.isFinite(epoch)) return "";
  const local = new Date(epoch + SHANGHAI_OFFSET_MS);
  return `${local.getUTCFullYear()}-${String(local.getUTCMonth() + 1).padStart(2, "0")}-${String(local.getUTCDate()).padStart(2, "0")}`;
}

/**
 * 日历日（YYYY-MM-DD，按北京时间理解）是星期几：0=周日 … 6=周六。
 * 必须按 UTC 解析这个日历日再取 getUTCDay；按 `+08:00` 零点解析会落到前一天的 16:00Z，星期整体错一天。
 */
export function weekdayOf(date: string): number {
  return new Date(`${date}T00:00:00Z`).getUTCDay();
}

export function minuteLabel(minute: number): string {
  return `${String(Math.floor(minute / 60)).padStart(2, "0")}:${String(minute % 60).padStart(2, "0")}`;
}

function epoch(value: string | null | undefined): number | null {
  if (!value) return null;
  const result = Date.parse(value);
  return Number.isFinite(result) ? result : null;
}

type PhoneObservation = { at: number; status: string; room: string | null };

function phoneObservations(
  snapshots: HomeSnapshot[],
  events: HomeEvent[],
  devices: HomeDevice[],
  deviceIds: Set<string>,
  latestAllowedAt = Infinity,
): PhoneObservation[] {
  const roomByDevice = new Map(devices.map(device => [device.device_id, device.room ?? null]));
  const rows: PhoneObservation[] = [];
  for (const row of snapshots) {
    const at = epoch(row.observed_at);
    if (at === null || at > latestAllowedAt || !deviceIds.has(row.device_id)) continue;
    rows.push({ at, status: row.status, room: row.room ?? roomByDevice.get(row.device_id) ?? null });
  }
  for (const row of events) {
    const at = epoch(row.event_at);
    if (at === null || at > latestAllowedAt || !deviceIds.has(row.device_id)) continue;
    rows.push({ at, status: row.status ?? "offline", room: roomByDevice.get(row.device_id) ?? null });
  }
  return rows.sort((a, b) => a.at - b.at);
}

function latestBefore(rows: PhoneObservation[], at: number): PhoneObservation | null {
  let result: PhoneObservation | null = null;
  for (const row of rows) {
    if (row.at > at) break;
    result = row;
  }
  return result;
}

function isActiveSample(row: ActivitySample): boolean {
  if (row.locked === true) return false;
  const idle = [row.key_idle_sec, row.pointer_idle_sec, row.idle_sec]
    .filter((value): value is number => typeof value === "number" && Number.isFinite(value));
  return idle.length > 0 && Math.min(...idle) < STATE_THRESHOLDS.activeIdleSeconds;
}

function appCategory(row: ActivitySample, mappings: Record<string, AppCategory>): AppCategory {
  for (const name of [row.app_name ?? "", row.bundle_id ?? ""]) {
    if (name && mappings[name]) return mappings[name];
  }
  return "其他";
}

function buildSegments(statuses: DayStatus[], evidence: Evidence[]): StatusSegment[] {
  const segments: StatusSegment[] = [];
  let start = 0;
  for (let index = 1; index <= statuses.length; index++) {
    if (index < statuses.length && statuses[index] === statuses[start] && evidence[index] === evidence[start]) continue;
    segments.push({ status: statuses[start], startMinute: start, endMinute: index - 1, evidence: evidence[start] });
    start = index;
  }
  return segments;
}

function buildAppBreakdown(
  minuteSamples: Array<ActivitySample | null>,
  mappings: Record<string, AppCategory>,
): AppBreakdown[] {
  const byCategory = new Map<AppCategory, Map<string, number>>();
  for (const row of minuteSamples) {
    // 只统计样本自己所在的那一分钟：一条样本最多算 1 分钟，不按新鲜窗口延续。
    if (!row || row.net !== "office" || !isActiveSample(row)) continue;
    const category = appCategory(row, mappings);
    const app = row.app_name?.trim() || row.bundle_id?.trim() || "未标注应用";
    const apps = byCategory.get(category) ?? new Map<string, number>();
    apps.set(app, (apps.get(app) ?? 0) + 1);
    byCategory.set(category, apps);
  }
  const total = [...byCategory.values()].reduce((sum, apps) => sum + [...apps.values()].reduce((a, b) => a + b, 0), 0);
  return [...byCategory.entries()].map(([category, apps]) => {
    const minutes = [...apps.values()].reduce((a, b) => a + b, 0);
    return {
      category,
      minutes,
      share: total ? minutes / total : 0,
      apps: [...apps.entries()].map(([name, value]) => ({ name, minutes: value })).sort((a, b) => b.minutes - a.minutes),
    };
  }).sort((a, b) => b.minutes - a.minutes);
}

function pushMoment(target: KeyMoment[], moment: KeyMoment) {
  if (!target.some(item => item.kind === moment.kind && item.minute === moment.minute)) target.push(moment);
}

function officeAwayCandidate(active: boolean[], office: boolean[], index: number): boolean {
  if (!office[index] || active[index]) return false;
  let previous = -1;
  let next = -1;
  for (let i = index - 1; i >= 0 && index - i <= STATE_THRESHOLDS.officeAwayMaxMinutes; i--) {
    if (active[i]) { previous = i; break; }
  }
  for (let i = index + 1; i < active.length && i - index <= STATE_THRESHOLDS.officeAwayMaxMinutes; i++) {
    if (active[i]) { next = i; break; }
  }
  return previous >= 0 && next >= 0;
}

export function calculateDay(input: StateInput, now?: number): DayComputation {
  const start = dayStartEpoch(input.date);
  if (!Number.isFinite(start)) throw new Error("invalid_date");
  const isCurrentDay = now !== undefined && shanghaiDate(now) === input.date;
  const calculationAllowedAt = isCurrentDay ? now : Infinity;
  const lastMinute = !isCurrentDay
    ? MINUTES_PER_DAY - 1
    : Math.min(MINUTES_PER_DAY - 1, Math.max(-1, Math.floor((now - start) / MS_PER_MINUTE)));

  const activity = [...input.activity]
    .map(row => ({ row, at: epoch(row.sampled_at) }))
    .filter((item): item is { row: ActivitySample; at: number } => item.at !== null && item.at <= calculationAllowedAt)
    .sort((a, b) => a.at - b.at);
  const deviceIds = new Set(input.subjectDeviceIds);
  const phone = phoneObservations(input.snapshots, input.events, input.devices, deviceIds, calculationAllowedAt);

  // 每条样本只归属它自己所在的那一分钟；同一分钟多条样本取最后一条。
  // 状态判断仍然使用新鲜窗口与回看窗口，但「在电脑前做什么」只按这里的分钟计数。
  const minuteOwnSample: Array<ActivitySample | null> = new Array(MINUTES_PER_DAY).fill(null);
  for (const { row, at } of activity) {
    const minute = Math.floor((at - start) / MS_PER_MINUTE);
    if (minute < 0 || minute >= MINUTES_PER_DAY) continue;
    const current = minuteOwnSample[minute];
    if (!current || (epoch(current.sampled_at) ?? -Infinity) <= at) minuteOwnSample[minute] = row;
  }

  const minuteRows: Array<{
    sample: ActivitySample | null;
    sampleFresh: boolean;
    active: boolean;
    office: boolean;
    home: { present: boolean; room: string | null };
  }> = [];

  let activityIndex = 0;
  for (let minute = 0; minute < MINUTES_PER_DAY; minute++) {
    const at = start + minute * MS_PER_MINUTE;
    while (activityIndex < activity.length && activity[activityIndex].at <= at) activityIndex++;
    const sample = activityIndex > 0 ? activity[activityIndex - 1].row : null;
    const sampleAt = activityIndex > 0 ? activity[activityIndex - 1].at : null;
    const sampleFresh = sampleAt !== null && at - sampleAt <= STATE_THRESHOLDS.activityFreshnessMinutes * MS_PER_MINUTE;
    let active = false;
    const lookbackFrom = at - STATE_THRESHOLDS.activityLookbackMinutes * MS_PER_MINUTE;
    for (let index = activityIndex - 1; index >= 0 && activity[index].at >= lookbackFrom; index--) {
      if (isActiveSample(activity[index].row)) { active = true; break; }
    }
    const observation = latestBefore(phone, at);
    const phoneFresh = observation !== null && at - observation.at <= STATE_THRESHOLDS.homeFreshnessMinutes * MS_PER_MINUTE;
    const home = observation && phoneFresh
      ? { present: observation.status !== "offline", room: observation.room }
      : { present: false, room: null };
    minuteRows.push({
      sample: sampleFresh ? sample : null,
      sampleFresh,
      active,
      office: sampleFresh ? sample?.net === "office" : false,
      home,
    });
  }

  const officeActive = minuteRows.map((item, minute) => minute <= lastMinute && item.office && item.active);
  const officeSignal = minuteRows.map((item, minute) => minute <= lastMinute && item.office);
  const statuses: DayStatus[] = [];
  const evidence: Evidence[] = [];
  const details: string[] = [];

  for (let minute = 0; minute < MINUTES_PER_DAY; minute++) {
    if (minute > lastMinute) {
      statuses.push("not_arrived");
      evidence.push("not_arrived");
      details.push("");
      continue;
    }
    const item = minuteRows[minute];
    if (deviceIds.size > 0 && item.home.present) {
      if (item.home.room === "卧室") { statuses.push("bedroom"); evidence.push("seen"); details.push(""); continue; }
      if (item.home.room === "客厅") { statuses.push("living_room"); evidence.push("seen"); details.push(""); continue; }
      statuses.push("home"); evidence.push("seen");
      details.push("");
      continue;
    }
    if (item.sample?.net === "home") { statuses.push("home"); evidence.push("seen"); details.push(""); continue; }
    if (item.office && item.active) { statuses.push("office_active"); evidence.push("seen"); details.push(""); continue; }
    if (item.office && officeAwayCandidate(officeActive, officeSignal, minute)) {
      statuses.push("office_away");
      evidence.push("inferred");
      details.push("");
      continue;
    }
    if (item.sample?.net === "other") {
      statuses.push("other_network");
      evidence.push("seen");
      details.push(item.sample?.ssid ?? item.sample?.net_key ?? "");
      continue;
    }
    statuses.push("unknown");
    evidence.push("no_data");
    details.push("");
  }

  const isHome = (value: DayStatus) => value === "bedroom" || value === "living_room" || value === "home";
  const homeIndices: number[] = [];
  statuses.forEach((value, index) => { if (isHome(value)) homeIndices.push(index); });
  const firstOffice = officeActive.findIndex(Boolean);
  let lastOffice = -1;
  for (let index = officeActive.length - 1; index >= 0; index--) {
    if (officeActive[index]) { lastOffice = index; break; }
  }

  // 通勤 covers the gap between the last home observation and the first
  // active office sample. An office network sample without activity still
  // belongs to that inferred gap.
  const fillCommute = (from: number, to: number) => {
    if (from < 0 || to < 0 || to <= from) return;
    const length = to - from - 1;
    if (length <= 0 || length > STATE_THRESHOLDS.commuteMaxMinutes) return;
    for (let minute = from + 1; minute < to; minute++) {
      if (statuses[minute] === "unknown") {
        statuses[minute] = "commute";
        evidence[minute] = "inferred";
      }
    }
  };
  if (firstOffice >= 0) {
    const before = homeIndices.filter(index => index < firstOffice).at(-1);
    if (before !== undefined) fillCommute(before, firstOffice);
  }
  if (lastOffice >= 0) {
    const after = homeIndices.find(index => index > lastOffice);
    if (after !== undefined) fillCommute(lastOffice, after);
  }

  const moments: KeyMoment[] = [];
  const livingIndex = statuses.indexOf("living_room");
  if (livingIndex >= 0) {
    const previous = livingIndex > 0 ? statuses[livingIndex - 1] : null;
    const knownBefore = homeIndices.some(index => index < livingIndex);
    if (previous === "bedroom" || (!knownBefore && livingIndex >= STATE_THRESHOLDS.wakeEarliestMinute)) {
      pushMoment(moments, { kind: "wake", minute: livingIndex, label: "起床", evidence: "seen",
        detail: `${minuteLabel(livingIndex)} 首次进入客厅` });
    }
  }
  for (let minute = 1; minute <= lastMinute; minute++) {
    const before = statuses[minute - 1], after = statuses[minute];
    if (isHome(before) && !isHome(after) && after !== "unknown") {
      pushMoment(moments, { kind: "leave_home", minute, label: "离家", evidence: evidence[minute],
        detail: `${minuteLabel(minute)} 离开在家状态` });
    }
    if (after === "office_active" && before !== "office_active") {
      pushMoment(moments, { kind: "start_work", minute, label: "开始办公", evidence: "seen",
        detail: `${minuteLabel(minute)} 公司网络出现键鼠活动` });
    }
    if (before === "office_active" && (after === "office_away" || after === "commute")) {
      pushMoment(moments, { kind: "leave_computer", minute, label: "离开电脑", evidence: "inferred",
        detail: `${minuteLabel(minute)} 不再保持活跃采样` });
    }
    if (!isHome(before) && isHome(after) && before !== "unknown") {
      pushMoment(moments, { kind: "arrive_home", minute, label: "到家", evidence: "seen",
        detail: `${minuteLabel(minute)} 手机回到家中` });
    }
    if (after === "bedroom" && before !== "bedroom" && before !== null) {
      pushMoment(moments, { kind: "return_bedroom", minute, label: "回卧室", evidence: "seen",
        detail: `${minuteLabel(minute)} 手机进入卧室` });
    }
  }
  moments.sort((a, b) => a.minute - b.minute);

  const metrics = {
    commuteToWorkMinutes: null as number | null,
    commuteHomeMinutes: null as number | null,
    officeActiveMinutes: null as number | null,
    homeMinutes: null as number | null,
    bedroomMinutes: null as number | null,
    livingRoomMinutes: null as number | null,
    homeUnknownMinutes: null as number | null,
  };

  // 缺失的一路数据只会让相关指标变成未知，不会被当成 0。
  // 只看当天自己的数据：回看窗口里前一天的样本、同一批次里别的日子的样本都不算「这一路可用」。
  const dayEnd = start + MINUTES_PER_DAY * MS_PER_MINUTE;
  const phoneChannelUsable = deviceIds.size > 0 && phone.some(row => row.at >= start && row.at < dayEnd);
  const workChannelUsable = activity.some(item => item.at >= start && item.at < dayEnd);
  const homeKnown = phoneChannelUsable || workChannelUsable;
  if (phoneChannelUsable && workChannelUsable) {
    metrics.commuteToWorkMinutes = statuses.filter((value, index) => value === "commute" && (firstOffice < 0 || index < firstOffice)).length;
    metrics.commuteHomeMinutes = statuses.filter((value, index) => value === "commute" && (lastOffice < 0 || index > lastOffice)).length;
  }
  if (workChannelUsable) metrics.officeActiveMinutes = statuses.filter(value => value === "office_active").length;
  if (homeKnown) {
    metrics.homeMinutes = statuses.filter(isHome).length;
    metrics.homeUnknownMinutes = statuses.filter(value => value === "home").length;
  }
  if (phoneChannelUsable) {
    metrics.bedroomMinutes = statuses.filter(value => value === "bedroom").length;
    metrics.livingRoomMinutes = statuses.filter(value => value === "living_room").length;
  }

  let keyboard = 0, pointer = 0, both = 0;
  for (const row of minuteOwnSample) {
    if (!row || row.net !== "office" || !isActiveSample(row)) continue;
    const hasKeyboard = typeof row.key_idle_sec === "number" && row.key_idle_sec < STATE_THRESHOLDS.activeIdleSeconds;
    const hasPointer = typeof row.pointer_idle_sec === "number" && row.pointer_idle_sec < STATE_THRESHOLDS.activeIdleSeconds;
    if (hasKeyboard) keyboard++;
    if (hasPointer) pointer++;
    if (hasKeyboard && hasPointer) both++;
  }

  return {
    date: input.date,
    minuteStatuses: statuses,
    minuteEvidence: evidence,
    minuteDetails: details,
    segments: buildSegments(statuses, evidence),
    moments,
    metrics,
    appBreakdown: buildAppBreakdown(minuteOwnSample, input.appCategories),
    keyboardMouseMinutes: workChannelUsable ? { keyboard, pointer, both } : { keyboard: null, pointer: null, both: null },
    channels: { work: workChannelUsable, phone: phoneChannelUsable },
  };
}

export function statusLabel(status: DayStatus): string {
  return {
    bedroom: "卧室",
    living_room: "客厅",
    home: "在家",
    office_active: "公司 · 在电脑前",
    office_away: "公司 · 离座",
    commute: "通勤",
    other_network: "其他网络",
    unknown: "未知",
    not_arrived: "未到",
  }[status];
}

export const STATUS_METHODS: Record<RhythmStatus, string> = {
  bedroom: "本人手机在线，房间标签是卧室。",
  living_room: "本人手机在线，房间标签是客厅。",
  home: "本人手机在线但房间标签为空；或工作机连接的是家里网络。",
  office_active: "工作机连接的是公司网络，且最近几分钟有键鼠操作、未锁屏。",
  office_away: "工作机连接的是公司网络，但锁屏或没有操作，且夹在两段办公之间。",
  commute: "手机最后一次在家到工作机第一次在电脑前之间；下班方向相反。",
  other_network: "工作机连接的是其他网络，显示网络名称，没有则显示网络标识。",
  unknown: "两路都没有新鲜数据，或看不出人在哪里。",
};
