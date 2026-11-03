import { dayStartEpoch, shanghaiDate } from "./state";
import { dailyRows, upsertDailyRows } from "./daily";
import type { StateInput } from "./models";
import { isoShanghai } from "./lib";
import {
  parseActivity, parseDevices, parseEvents, parseHeartbeats, parseSnapshots, readUpstream,
  UPSTREAM_ACTIVITY_SAMPLES_PATH, UPSTREAM_HOME_DEVICES_PATH, UPSTREAM_HOME_EVENTS_PATH,
  UPSTREAM_HOME_HEARTBEATS_PATH, UPSTREAM_HOME_SNAPSHOTS_PATH,
} from "./upstream";
import type { RhythmSettings } from "./settings";
import type { Env } from "./types";

const LOOKBACK_MINUTES = 30;
const DAY_MS = 86400_000;
/**
 * 每次向上游取 2 天：家中扫描对全部设备每 5 分钟上报一次快照，设备多时一天可达数千行；
 * 2 天的量留在 UPSTREAM_MAX_PAGES × UPSTREAM_PAGE_LIMIT 以内，超出时 readUpstream 会报错而不是截断。
 */
const UPSTREAM_CHUNK_DAYS = 2;

type RawStateRows = {
  activity: ReturnType<typeof parseActivity>;
  devices: ReturnType<typeof parseDevices>;
  snapshots: ReturnType<typeof parseSnapshots>;
  events: ReturnType<typeof parseEvents>;
  heartbeats: ReturnType<typeof parseHeartbeats>;
};

function rangeForDates(from: string, to: string) {
  const start = dayStartEpoch(from);
  const end = dayStartEpoch(to) + 1440 * 60_000;
  return { from: isoShanghai(start - LOOKBACK_MINUTES * 60_000), to: isoShanghai(end) };
}

async function loadRawRows(env: Env, from: string, to: string): Promise<RawStateRows> {
  const range = rangeForDates(from, to);
  const [activityRaw, devicesRaw, snapshotsRaw, eventsRaw, heartbeatsRaw] = await Promise.all([
    readUpstream(env, UPSTREAM_ACTIVITY_SAMPLES_PATH, range),
    readUpstream(env, UPSTREAM_HOME_DEVICES_PATH),
    readUpstream(env, UPSTREAM_HOME_SNAPSHOTS_PATH, range),
    readUpstream(env, UPSTREAM_HOME_EVENTS_PATH, range),
    readUpstream(env, UPSTREAM_HOME_HEARTBEATS_PATH, range),
  ]);
  return {
    activity: parseActivity(activityRaw),
    devices: parseDevices(devicesRaw),
    snapshots: parseSnapshots(snapshotsRaw),
    events: parseEvents(eventsRaw),
    heartbeats: parseHeartbeats(heartbeatsRaw),
  };
}

/** 只保留属于这一天的数据：[当天 0 点 - 回看窗口, 次日 0 点)。按 8 天分块取数时，别的日子的数据不能混进来。 */
function rowsForDate(date: string, rows: RawStateRows): RawStateRows {
  const from = dayStartEpoch(date) - LOOKBACK_MINUTES * 60_000;
  const to = dayStartEpoch(date) + DAY_MS;
  const inDay = (value: string) => {
    const at = Date.parse(value);
    return Number.isFinite(at) && at >= from && at < to;
  };
  return {
    activity: rows.activity.filter(row => inDay(row.sampled_at)),
    devices: rows.devices,
    snapshots: rows.snapshots.filter(row => inDay(row.observed_at)),
    events: rows.events.filter(row => inDay(row.event_at)),
    heartbeats: rows.heartbeats.filter(row => inDay(row.observed_at)),
  };
}

function stateInput(date: string, settings: RhythmSettings, rows: RawStateRows): StateInput {
  return {
    date,
    ...rowsForDate(date, rows),
    subjectDeviceIds: settings.subjectDeviceIds,
    appCategories: settings.appCategories,
    otherNetworkNames: settings.otherNetworkNames,
  };
}

export async function loadStateInput(env: Env, date: string, settings: RhythmSettings): Promise<StateInput> {
  return stateInput(date, settings, await loadRawRows(env, date, date));
}

export function dateOffset(date: string, days: number): string {
  return shanghaiDate(dayStartEpoch(date) + days * DAY_MS);
}

export function dateDistance(from: string, to: string): number {
  return Math.round((dayStartEpoch(to) - dayStartEpoch(from)) / DAY_MS);
}

/**
 * 重算并落库 [from, to]。只处理到「昨天」（北京时间）：今天还没过完，未到的分钟不能当缺口落库；
 * 今天的指标由接口按需实时计算。
 */
export async function recomputeRange(
  env: Env, from: string, to: string, settings: RhythmSettings, computedAt = new Date().toISOString(),
  now = Date.now(),
) {
  if (to >= shanghaiDate(now)) throw new Error("recompute_includes_today");
  const rows = [];
  for (let chunkStart = from; dateDistance(chunkStart, to) >= 0; chunkStart = dateOffset(chunkStart, UPSTREAM_CHUNK_DAYS)) {
    const chunkEnd = dateDistance(chunkStart, to) >= UPSTREAM_CHUNK_DAYS - 1
      ? dateOffset(chunkStart, UPSTREAM_CHUNK_DAYS - 1)
      : to;
    const raw = await loadRawRows(env, chunkStart, chunkEnd);
    for (let date = chunkStart; dateDistance(date, chunkEnd) >= 0; date = dateOffset(date, 1)) {
      const result = dailyRows(stateInput(date, settings, raw), undefined, computedAt);
      await upsertDailyRows(env, result);
      rows.push(result);
    }
  }
  return rows;
}
