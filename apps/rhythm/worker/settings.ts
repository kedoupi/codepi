import { APP_CATEGORIES, normalizeAppCategory } from "./models";
import type { AppCategory } from "./models";
import type { Env } from "./types";

const CATEGORIES = [...APP_CATEGORIES];
export const DEFAULT_ANOMALY_THRESHOLDS = { earlyLateMinutes: 40, commutePercent: 50 } as const;

export type RhythmSettings = {
  subjectDeviceIds: string[];
  appCategories: Record<string, AppCategory>;
  otherNetworkNames: Record<string, string>;
  anomalyThresholds: { earlyLateMinutes: number; commutePercent: number };
};

export const EMPTY_SETTINGS: RhythmSettings = {
  subjectDeviceIds: [], appCategories: {}, otherNetworkNames: {}, anomalyThresholds: { ...DEFAULT_ANOMALY_THRESHOLDS },
};

const MAX_MAP_ENTRIES = 500;
const MAX_TEXT_LENGTH = 200;
const SECRET_LIKE = /(secret|token|password|api[_-]?key|private[_-]?key|^sk[-_]|^gh[pousr]_|^xox[baprs]-|^eyJ)/i;

export type DeviceCandidate = { device_id: string; vendor: string | null; name: string | null; room: string | null };

export type SettingsUpdate = RhythmSettings;

export async function readSettings(env: Env): Promise<RhythmSettings> {
  const row = await env.DB.prepare(
    "SELECT subject_device_ids, app_categories, other_network_names, anomaly_thresholds FROM settings WHERE id='default'",
  ).first<{
    subject_device_ids: string | null; app_categories: string | null;
    other_network_names: string | null; anomaly_thresholds: string | null;
  }>();
  if (!row) return EMPTY_SETTINGS;
  return {
    subjectDeviceIds: parseDeviceIds(row.subject_device_ids),
    appCategories: parseCategories(row.app_categories),
    otherNetworkNames: parseStringMap(row.other_network_names),
    anomalyThresholds: parseThresholds(row.anomaly_thresholds),
  };
}

function parseDeviceIds(value: string | null): string[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((item): item is string => typeof item === "string" && item.trim().length > 0).map(item => item.trim());
  } catch {
    return [];
  }
}

function parseCategories(value: string | null): Record<string, AppCategory> {
  if (!value) return {};
  try {
    const parsed = JSON.parse(value) as unknown;
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return {};
    const result: Record<string, AppCategory> = {};
    for (const [name, category] of Object.entries(parsed as Record<string, unknown>)) {
      const normalized = normalizeAppCategory(category);
      if (normalized) result[name] = normalized;
    }
    return result;
  } catch {
    return {};
  }
}

function parseStringMap(value: string | null): Record<string, string> {
  if (!value) return {};
  try {
    const parsed = JSON.parse(value) as unknown;
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return {};
    return Object.fromEntries(Object.entries(parsed as Record<string, unknown>)
      .filter(([, item]) => typeof item === "string" && item.trim().length > 0)
      .map(([key, item]) => [key.trim(), String(item).trim()]));
  } catch {
    return {};
  }
}

function parseThresholds(value: string | null): RhythmSettings["anomalyThresholds"] {
  if (!value) return { ...DEFAULT_ANOMALY_THRESHOLDS };
  try {
    const parsed = JSON.parse(value) as Record<string, unknown>;
    const earlyLateMinutes = Number(parsed.earlyLateMinutes);
    const commutePercent = Number(parsed.commutePercent);
    if (!Number.isFinite(earlyLateMinutes) || !Number.isFinite(commutePercent)) {
      return { ...DEFAULT_ANOMALY_THRESHOLDS };
    }
    return { earlyLateMinutes, commutePercent };
  } catch {
    return { ...DEFAULT_ANOMALY_THRESHOLDS };
  }
}

function plainSettingText(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0 && value.length <= MAX_TEXT_LENGTH
    && !/[\u0000-\u001f\u007f]/.test(value);
}

/** 值（设备 id、自定义网络名）另外拒收像 secret 的内容；键（App 名、网络标识）只校验长度与字符，避免误伤「1Password」这类 App。 */
function safeSettingText(value: unknown): value is string {
  return plainSettingText(value) && !SECRET_LIKE.test(value.trim());
}

function strictStringMap(value: unknown, categoryValues = false): Record<string, string> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new Error("invalid_settings");
  const entries = Object.entries(value as Record<string, unknown>);
  if (entries.length > MAX_MAP_ENTRIES) throw new Error("invalid_settings");
  const result: Record<string, string> = {};
  for (const [key, item] of entries) {
    if (!plainSettingText(key) || !safeSettingText(item)) throw new Error("invalid_settings");
    if (categoryValues && !(CATEGORIES as string[]).includes(item)) throw new Error("invalid_settings");
    result[key.trim()] = item.trim();
  }
  return result;
}

export function parseSettingsUpdate(value: unknown, previous: RhythmSettings = EMPTY_SETTINGS): SettingsUpdate {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new Error("invalid_settings");
  const body = value as Record<string, unknown>;
  const expected = ["subject_device_ids", "app_categories", "other_network_names", "anomaly_thresholds"];
  if (Object.keys(body).some(key => !expected.includes(key)) || !("app_categories" in body) || !("other_network_names" in body)) {
    throw new Error("invalid_settings");
  }
  const subjectDeviceIds = body.subject_device_ids === undefined
    ? previous.subjectDeviceIds
    : (() => {
      if (!Array.isArray(body.subject_device_ids) || body.subject_device_ids.length > MAX_MAP_ENTRIES) throw new Error("invalid_settings");
      const values = body.subject_device_ids.map(item => {
        if (!safeSettingText(item)) throw new Error("invalid_settings");
        return item.trim();
      });
      if (new Set(values).size !== values.length) throw new Error("invalid_settings");
      return values;
    })();
  const appCategories = strictStringMap(body.app_categories, true) as Record<string, AppCategory>;
  const otherNetworkNames = strictStringMap(body.other_network_names);
  const anomalyThresholds = body.anomaly_thresholds === undefined
    ? previous.anomalyThresholds
    : (() => {
      if (typeof body.anomaly_thresholds !== "object" || body.anomaly_thresholds === null || Array.isArray(body.anomaly_thresholds)) {
        throw new Error("invalid_settings");
      }
      const thresholds = body.anomaly_thresholds as Record<string, unknown>;
      if (Object.keys(thresholds).length !== 2 || !("early_late_minutes" in thresholds) || !("commute_percent" in thresholds)) {
        throw new Error("invalid_settings");
      }
      const earlyLateMinutes = thresholds.early_late_minutes;
      const commutePercent = thresholds.commute_percent;
      if (!Number.isInteger(earlyLateMinutes) || !Number.isInteger(commutePercent)
        || (earlyLateMinutes as number) < 1 || (earlyLateMinutes as number) > 1440
        || (commutePercent as number) < 1 || (commutePercent as number) > 300) throw new Error("invalid_settings");
      return { earlyLateMinutes: earlyLateMinutes as number, commutePercent: commutePercent as number };
    })();
  return { subjectDeviceIds, appCategories, otherNetworkNames, anomalyThresholds };
}

export type PendingRecompute = { days: number; from: string | null; to: string | null };

export async function readPendingRecompute(env: Env): Promise<PendingRecompute> {
  const row = await env.DB.prepare(
    "SELECT COUNT(*) AS days, MIN(date) AS first, MAX(date) AS last FROM settings_recompute_queue",
  ).first<{ days: number; first: string | null; last: string | null }>();
  return { days: row?.days ?? 0, from: row?.first ?? null, to: row?.last ?? null };
}

export function publicSettings(settings: RhythmSettings, candidates: DeviceCandidate[], pending?: PendingRecompute) {
  return {
    pending_recompute_days: pending ?? { days: 0, from: null, to: null },
    subject_device_ids: settings.subjectDeviceIds,
    device_candidates: candidates,
    app_categories: settings.appCategories,
    other_network_names: settings.otherNetworkNames,
    anomaly_thresholds: {
      early_late_minutes: settings.anomalyThresholds.earlyLateMinutes,
      commute_percent: settings.anomalyThresholds.commutePercent,
    },
  };
}

export async function saveSettings(env: Env, settings: SettingsUpdate, reason = "settings_changed"): Promise<void> {
  const updatedAt = new Date().toISOString();
  await env.DB.batch([
    env.DB.prepare(
      "INSERT INTO settings (id, subject_device_ids, app_categories, other_network_names, anomaly_thresholds, updated_at) VALUES ('default', ?, ?, ?, ?, ?) "
      + "ON CONFLICT(id) DO UPDATE SET subject_device_ids=excluded.subject_device_ids, app_categories=excluded.app_categories, other_network_names=excluded.other_network_names, anomaly_thresholds=excluded.anomaly_thresholds, updated_at=excluded.updated_at",
    ).bind(
      JSON.stringify(settings.subjectDeviceIds), JSON.stringify(settings.appCategories),
      JSON.stringify(settings.otherNetworkNames), JSON.stringify(settings.anomalyThresholds), updatedAt,
    ),
    env.DB.prepare(
      // INSERT…SELECT 接 upsert 时 SELECT 必须带 WHERE，否则 SQLite 会把 ON 当成 JOIN 条件（解析歧义）。
      "INSERT INTO settings_recompute_queue (date, reason, queued_at) SELECT date, ?, ? FROM daily_metrics WHERE true "
      + "ON CONFLICT(date) DO UPDATE SET reason=excluded.reason, queued_at=excluded.queued_at",
    ).bind(reason, updatedAt),
  ]);
}
