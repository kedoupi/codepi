/**
 * Production field pickers — port of oura-tcb `pickSleep` / `pickReadiness` /
 * `pickActivity` (oura-common.js). Maps raw Oura Cloud daily documents onto
 * the nested day blocks used by the personal board API.
 */

import type { OuraDailyDoc } from "./oura";

export const SLEEP_CONTRIBUTOR_KEYS = [
  "deep_sleep",
  "efficiency",
  "latency",
  "rem_sleep",
  "restfulness",
  "timing",
  "total_sleep",
] as const;

export const READINESS_CONTRIBUTOR_KEYS = [
  "activity_balance",
  "body_temperature",
  "hrv_balance",
  "previous_day_activity",
  "previous_night",
  "recovery_index",
  "resting_heart_rate",
  "sleep_balance",
] as const;

export type SleepContributorKey = (typeof SLEEP_CONTRIBUTOR_KEYS)[number];
export type ReadinessContributorKey = (typeof READINESS_CONTRIBUTOR_KEYS)[number];

export type SleepContributors = Record<SleepContributorKey, number | null>;
export type ReadinessContributors = Record<ReadinessContributorKey, number | null>;

export type PickedSleep = {
  id: string;
  score: number | null;
  contributors: SleepContributors;
};

export type PickedReadiness = {
  id: string;
  score: number | null;
  temperature_deviation: number | null;
  temperature_trend_deviation: number | null;
  contributors: ReadinessContributors;
};

export type PickedActivity = {
  id: string;
  score: number | null;
  steps: number | null;
  active_calories: number | null;
  equivalent_walking_distance: number | null;
  high_activity_time: number | null;
  medium_activity_time: number | null;
  low_activity_time: number | null;
  sedentary_time: number | null;
};

/** Public sleep block — live `api.xiaotaozi.cc/oura/daily` shape (no id). */
export type SleepBlock = {
  score: number | null;
  contributors: SleepContributors;
};

/** Public readiness block — live board shape (no id). */
export type ReadinessBlock = {
  score: number | null;
  temperature_deviation: number | null;
  temperature_trend_deviation: number | null;
  contributors: ReadinessContributors;
};

/** Public activity block — live board shape (score / steps / active_calories). */
export type ActivityBlock = {
  score: number | null;
  steps: number | null;
  active_calories: number | null;
};

export function num(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function pickContributorMap<K extends string>(
  keys: readonly K[],
  raw: Record<string, unknown> | undefined,
): Record<K, number | null> {
  const src = raw ?? {};
  const out = {} as Record<K, number | null>;
  for (const key of keys) out[key] = num(src[key]);
  return out;
}

/** Faithful port of production `pickSleep`. */
export function pickSleep(row: OuraDailyDoc | null | undefined): PickedSleep | null {
  if (!row) return null;
  const c = (row.contributors ?? {}) as Record<string, unknown>;
  return {
    id: row.id || "",
    score: row.score != null ? num(row.score) : null,
    contributors: pickContributorMap(SLEEP_CONTRIBUTOR_KEYS, c),
  };
}

/** Faithful port of production `pickReadiness`. */
export function pickReadiness(
  row: OuraDailyDoc | null | undefined,
): PickedReadiness | null {
  if (!row) return null;
  const c = (row.contributors ?? {}) as Record<string, unknown>;
  return {
    id: row.id || "",
    score: row.score != null ? num(row.score) : null,
    temperature_deviation:
      row.temperature_deviation != null ? num(row.temperature_deviation) : null,
    temperature_trend_deviation:
      row.temperature_trend_deviation != null
        ? num(row.temperature_trend_deviation)
        : null,
    contributors: pickContributorMap(READINESS_CONTRIBUTOR_KEYS, c),
  };
}

/** Faithful port of production `pickActivity`. */
export function pickActivity(
  row: OuraDailyDoc | null | undefined,
): PickedActivity | null {
  if (!row) return null;
  return {
    id: row.id || "",
    score: row.score != null ? num(row.score) : null,
    steps: row.steps != null ? num(row.steps) : null,
    active_calories: row.active_calories != null ? num(row.active_calories) : null,
    equivalent_walking_distance:
      row.equivalent_walking_distance != null
        ? num(row.equivalent_walking_distance)
        : null,
    high_activity_time:
      row.high_activity_time != null ? num(row.high_activity_time) : null,
    medium_activity_time:
      row.medium_activity_time != null ? num(row.medium_activity_time) : null,
    low_activity_time:
      row.low_activity_time != null ? num(row.low_activity_time) : null,
    sedentary_time: row.sedentary_time != null ? num(row.sedentary_time) : null,
  };
}

export function indexByDay<T extends { day?: string | null }>(
  rows: T[] | null | undefined,
): Record<string, T> {
  const map: Record<string, T> = {};
  for (const row of rows ?? []) {
    if (row && row.day) map[row.day] = row;
  }
  return map;
}

export function publicSleep(picked: PickedSleep): SleepBlock {
  return { score: picked.score, contributors: picked.contributors };
}

export function publicReadiness(picked: PickedReadiness): ReadinessBlock {
  return {
    score: picked.score,
    temperature_deviation: picked.temperature_deviation,
    temperature_trend_deviation: picked.temperature_trend_deviation,
    contributors: picked.contributors,
  };
}

/** Live board activity block — drops pick* extras not present on the public API. */
export function publicActivity(picked: PickedActivity): ActivityBlock {
  return {
    score: picked.score,
    steps: picked.steps,
    active_calories: picked.active_calories,
  };
}
