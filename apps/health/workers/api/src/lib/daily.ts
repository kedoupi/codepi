import { SYNTHETIC_BOARD_SAMPLE } from "../data/synthetic-board.ts";
import type { SyncInfo } from "./sync-cache.ts";
import type { OuraDailyDoc } from "./oura.ts";
import { calendarDay, shiftDay } from "../../../../shared/dates.ts";
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
  sync?: SyncInfo;
};

export type BoardDailyPayload = {
  ok: true;
  user_id?: string;
  from: string;
  to: string;
  count: number;
  days: NestedDay[];
};

export const DEV_BOARD_LABEL =
  "DEV · 合成演示数据（30 天）";

export function dateWindow(
  days: number,
  now = new Date(),
): {
  startDate: string;
  endDate: string;
  dates: string[];
} {
  const end = calendarDay(now);
  const dates: string[] = [];
  for (let i = days - 1; i >= 0; i--) {
    dates.push(shiftDay(end, -i));
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
 * DEV uses only generated data. Requests beyond the fixture window keep their
 * actual sample count instead of inventing additional calendar rows.
 */
export function buildDevDaily(days: number): DailyResponse {
  const windowDays = clampDays(days);
  const sliced = sliceBoardDays(SYNTHETIC_BOARD_SAMPLE.days, windowDays);
  const truncated = windowDays > SYNTHETIC_BOARD_SAMPLE.days.length;
  return decorateDaily(sliced, {
    user_id: SYNTHETIC_BOARD_SAMPLE.user_id,
    source: "dev",
    dev: true,
    dataset: "synthetic-board",
    label: truncated
      ? `${DEV_BOARD_LABEL} · 请求 ${windowDays} 天仅有 ${sliced.length} 天合成样本`
      : DEV_BOARD_LABEL,
  });
}

export async function loadDevDaily(days: 7 | 30 | 90): Promise<DailyResponse> {
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
