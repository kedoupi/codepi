/**
 * Loader for the shared state fixtures.
 *
 * Every fixture is synthetic: device ids look like `dev-a` and network names
 * look like 「示例网络」. A row may either be a literal sample or a range with
 * `from`/`to`/`everyMinutes`, which is expanded into one row per step so the
 * fixtures stay readable while still describing a full day. Expanded rows are
 * written in UTC (`Z`) on purpose: the parser must accept `+08:00` and `Z` in
 * the same file.
 */
import raw from "./fixtures/state-cases.json";
import type {
  ActivitySample, AppCategory, DayMetrics, Evidence, Heartbeat, HomeDevice,
  HomeEvent, HomeSnapshot, MomentKind, RhythmStatus, StateInput,
} from "../worker/models";
import { parseActivity, parseDevices, parseEvents, parseHeartbeats, parseSnapshots } from "../worker/upstream";

export type CaseExpectation = {
  statusAt: Record<string, RhythmStatus>;
  evidenceAt?: Record<string, Evidence>;
  contains?: MomentKind[];
  notContains?: MomentKind[];
  metrics?: Partial<DayMetrics>;
  appCategories?: Record<string, number>;
  detailAt?: Record<string, string>;
};

export type RhythmCase = {
  name: string;
  date: string;
  subjectDeviceIds: string[];
  activity: unknown[];
  devices: unknown[];
  snapshots: unknown[];
  events: unknown[];
  heartbeats: unknown[];
  appCategories: Record<string, AppCategory>;
  expect: CaseExpectation;
};

type Row = Record<string, unknown> & { from?: string; to?: string; everyMinutes?: number };

function expand(rows: unknown[], timeKey: string): Row[] {
  const result: Row[] = [];
  for (const raw of (rows ?? []) as Row[]) {
    const { from, to } = raw;
    if (!from || !to) {
      result.push(raw);
      continue;
    }
    const start = Date.parse(from);
    const end = Date.parse(to);
    if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) {
      throw new Error(`invalid fixture range ${from}..${to}`);
    }
    const step = Math.max(1, Number(raw.everyMinutes ?? 1));
    for (let at = start; at <= end; at += step * 60_000) {
      const { from: _from, to: _to, everyMinutes: _every, ...rest } = raw;
      result.push({ ...rest, [timeKey]: new Date(at).toISOString() });
    }
  }
  return result;
}

export function loadCases(): RhythmCase[] {
  return raw as unknown as RhythmCase[];
}

/** Builds the exact input the Worker feeds into the state engine. */
export function toStateInput(item: RhythmCase): StateInput {
  return {
    date: item.date,
    activity: parseActivity(expand(item.activity, "sampled_at")) as ActivitySample[],
    devices: parseDevices(expand(item.devices, "observed_at")) as HomeDevice[],
    snapshots: parseSnapshots(expand(item.snapshots, "observed_at")) as HomeSnapshot[],
    events: parseEvents(expand(item.events, "event_at")) as HomeEvent[],
    heartbeats: parseHeartbeats(expand(item.heartbeats, "observed_at")) as Heartbeat[],
    subjectDeviceIds: item.subjectDeviceIds ?? [],
    appCategories: item.appCategories ?? {},
  };
}
