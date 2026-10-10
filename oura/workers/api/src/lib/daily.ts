import { KEDOUPI_BOARD_SAMPLE as kedoupiBoardJson } from "../data/kedoupi-board.ts";
import type { OuraDailyDoc } from "./oura.ts";
import {
  indexByDay,
  pickActivity,
  pickReadiness,
  pickSleep,
  publicActivity,
  publicReadiness,
  publicSleep,
  type ActivityBlock,
  type ReadinessBlock,
  type SleepBlock,
} from "./pickers.ts";

export type { ActivityBlock, ReadinessBlock, SleepBlock };

/** One calendar row — live `GET /oura/daily` day object. */
export type NestedDay = {
  date: string;
  sleep: SleepBlock | null;
  readiness: ReadinessBlock | null;
  activity: ActivityBlock | null;
};

/**
 * Primary `/api/me/daily` payload. Matches the live personal board
 * (`ok` / `days[]` / `from` / `to` / `count`). Session extras (`source`,
 * `dev`, `label`, `user_id`, `dataset`) are allowed.
 */
export type DailyResponse = {
  ok: true;
  days: NestedDay[];
  from: string;
  to: string;
  count: number;
  user_id?: string;
  source?: "oura" | "dev";
  stub?: boolean;
  dev?: boolean;
  label?: string;
  dataset?: string;
};

export type BoardDailyPayload = {
  ok: true;
  user_id?: string;
  from: string;
  to: string;
  count: number;
  days: NestedDay[];
};

/** Bundled live sample: `GET https://api.xiaotaozi.cc/oura/daily?user_id=kedoupi&days=30`. */
export const KEDOUPI_BOARD_SAMPLE = kedoupiBoardJson as BoardDailyPayload;

export const KEDOUPI_BOARD_DAILY_URL = "https://api.xiaotaozi.cc/oura/daily";

export const DEV_BOARD_LABEL =
  "DEV · kedoupi 个人看板真实样本（bundled 30d）· 待 per-user OAuth";

export const DEV_BOARD_LIVE_LABEL =
  "DEV · 现网个人看板实时数据（kedoupi / api.xiaotaozi.cc）· 待 per-user OAuth";

function utcDateString(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export function dateWindow(
  days: number,
  now = new Date(),
): {
  startDate: string;
  endDate: string;
  dates: string[];
} {
  const end = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
  );
  const dates: string[] = [];
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(end);
    d.setUTCDate(end.getUTCDate() - i);
    dates.push(utcDateString(d));
  }
  return {
    startDate: dates[0]!,
    endDate: dates[dates.length - 1]!,
    dates,
  };
}

export function clampDays(raw: number): 7 | 30 | 90 {
  return raw === 7 || raw === 90 ? raw : 30;
}

export function isBoardDailyPayload(value: unknown): value is BoardDailyPayload {
  if (!value || typeof value !== "object") return false;
  const o = value as Record<string, unknown>;
  return o.ok === true && Array.isArray(o.days);
}

/** Last N real days from a board payload. Does not invent extra calendar rows. */
export function sliceBoardDays(days: NestedDay[], count: number): NestedDay[] {
  if (count >= days.length) return days.slice();
  return days.slice(days.length - count);
}

export function decorateDaily(
  days: NestedDay[],
  extra: Omit<DailyResponse, "ok" | "days" | "from" | "to" | "count"> = {},
): DailyResponse {
  return {
    ok: true,
    days,
    from: days[0]?.date ?? "",
    to: days[days.length - 1]?.date ?? "",
    count: days.length,
    ...extra,
  };
}

/**
 * DEV path: serve the real kedoupi board days (not a synthetic sine wave).
 * `days=90` returns the 30 bundled rows when live fetch is unavailable —
 * we do not fabricate a 90-day series.
 */
export function buildDevDaily(days: number): DailyResponse {
  const windowDays = clampDays(days);
  const sliced = sliceBoardDays(KEDOUPI_BOARD_SAMPLE.days, windowDays);
  const truncated = windowDays > KEDOUPI_BOARD_SAMPLE.days.length;
  return decorateDaily(sliced, {
    user_id: KEDOUPI_BOARD_SAMPLE.user_id ?? "kedoupi",
    source: "dev",
    dev: true,
    dataset: "kedoupi-personal-board",
    label: truncated
      ? `${DEV_BOARD_LABEL} · 请求 ${windowDays} 天仅有 ${sliced.length} 天真实样本`
      : DEV_BOARD_LABEL,
  });
}

/** DEV-only live board fetch. Never used on the OAuth user path. */
export async function fetchKedoupiBoardDaily(
  days: 7 | 30 | 90,
): Promise<DailyResponse | null> {
  const url = `${KEDOUPI_BOARD_DAILY_URL}?user_id=kedoupi&days=${days}`;
  const res = await fetch(url, { headers: { Accept: "application/json" } });
  if (!res.ok) return null;
  const json: unknown = await res.json();
  if (!isBoardDailyPayload(json)) return null;
  return decorateDaily(json.days, {
    user_id: json.user_id ?? "kedoupi",
    source: "dev",
    dev: true,
    dataset: "kedoupi-personal-board-live",
    label: DEV_BOARD_LIVE_LABEL,
  });
}

export async function loadDevDaily(days: 7 | 30 | 90): Promise<DailyResponse> {
  try {
    const live = await fetchKedoupiBoardDaily(days);
    if (live && live.days.length) return live;
  } catch {
    // Bundled 30d sample is the contract fallback.
  }
  return buildDevDaily(days);
}

/** Map Oura Cloud collections through pick* onto the live nested day shape. */
export function mapOuraToDaily(args: {
  dates: string[];
  sleep: OuraDailyDoc[];
  readiness: OuraDailyDoc[];
  activity: OuraDailyDoc[];
}): DailyResponse {
  const sleepBy = indexByDay(args.sleep);
  const readinessBy = indexByDay(args.readiness);
  const activityBy = indexByDay(args.activity);

  const days: NestedDay[] = args.dates.map((date) => {
    const sleep = pickSleep(sleepBy[date]);
    const readiness = pickReadiness(readinessBy[date]);
    const activity = pickActivity(activityBy[date]);
    return {
      date,
      sleep: sleep ? publicSleep(sleep) : null,
      readiness: readiness ? publicReadiness(readiness) : null,
      activity: activity ? publicActivity(activity) : null,
    };
  });

  return decorateDaily(days, { source: "oura" });
}
