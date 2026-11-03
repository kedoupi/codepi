import type { AppCategory } from "./models";
import type { Env } from "./types";

const CATEGORIES: AppCategory[] = ["开发", "沟通", "文档", "浏览", "其他"];

export type RhythmSettings = {
  subjectDeviceIds: string[];
  appCategories: Record<string, AppCategory>;
};

export const EMPTY_SETTINGS: RhythmSettings = { subjectDeviceIds: [], appCategories: {} };

export async function readSettings(env: Env): Promise<RhythmSettings> {
  const row = await env.DB.prepare("SELECT subject_device_ids, app_categories FROM settings WHERE id='default'")
    .first<{ subject_device_ids: string | null; app_categories: string | null }>();
  if (!row) return EMPTY_SETTINGS;
  return {
    subjectDeviceIds: parseDeviceIds(row.subject_device_ids),
    appCategories: parseCategories(row.app_categories),
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
      if (typeof category === "string" && (CATEGORIES as string[]).includes(category)) result[name] = category as AppCategory;
    }
    return result;
  } catch {
    return {};
  }
}
