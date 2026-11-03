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
const UPSTREAM_CHUNK_DAYS = 8;

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

function stateInput(date: string, settings: RhythmSettings, rows: RawStateRows): StateInput {
  return {
    date,
    ...rows,
    subjectDeviceIds: settings.subjectDeviceIds,
    appCategories: settings.appCategories,
    otherNetworkNames: settings.otherNetworkNames,
  };
}

export async function loadStateInput(env: Env, date: string, settings: RhythmSettings): Promise<StateInput> {
  return stateInput(date, settings, await loadRawRows(env, date, date));
}

export async function recomputeDay(env: Env, date: string, settings: RhythmSettings, computedAt = new Date().toISOString()) {
  const input = await loadStateInput(env, date, settings);
  const rows = dailyRows(input, undefined, computedAt);
  await upsertDailyRows(env, rows);
  return rows;
}

export function dateOffset(date: string, days: number): string {
  return shanghaiDate(dayStartEpoch(date) + days * DAY_MS);
}

export function dateDistance(from: string, to: string): number {
  return Math.round((dayStartEpoch(to) - dayStartEpoch(from)) / DAY_MS);
}

export async function recomputeRange(
  env: Env, from: string, to: string, settings: RhythmSettings, computedAt = new Date().toISOString(),
) {
  const rows = [];
  for (let chunkStart = from; dateDistance(chunkStart, to) >= 0; chunkStart = dateOffset(chunkStart, UPSTREAM_CHUNK_DAYS)) {
    const chunkEnd = dateDistance(chunkStart, to) >= UPSTREAM_CHUNK_DAYS - 1
      ? dateOffset(chunkStart, UPSTREAM_CHUNK_DAYS - 1)
      : to;
    const raw = await loadRawRows(env, chunkStart, chunkEnd);
    for (let date = chunkStart; dateDistance(date, chunkEnd) >= 0; date = dateOffset(date, 1)) {
      rows.push(await (async () => {
        const result = dailyRows(stateInput(date, settings, raw), undefined, computedAt);
        await upsertDailyRows(env, result);
        return result;
      })());
    }
  }
  return rows;
}
