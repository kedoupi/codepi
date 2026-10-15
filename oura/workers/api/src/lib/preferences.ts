import type { Env } from "../env";

export type LocalePref = "system" | "zh" | "en";

export function normalizeLocalePref(value: unknown): LocalePref | null {
  if (value === "system" || value === "zh" || value === "en") return value;
  return null;
}

export async function loadLocalePref(
  env: Env,
  userId: string,
): Promise<LocalePref | null> {
  const row = await env.DB.prepare(
    `SELECT locale FROM user_prefs WHERE user_id = ?`,
  )
    .bind(userId)
    .first<{ locale: string | null }>();
  return normalizeLocalePref(row?.locale);
}

export async function saveLocalePref(
  env: Env,
  userId: string,
  locale: LocalePref,
): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO user_prefs (user_id, locale, updated_at)
     VALUES (?, ?, datetime('now'))
     ON CONFLICT(user_id) DO UPDATE SET
       locale = excluded.locale,
       updated_at = datetime('now')`,
  )
    .bind(userId, locale)
    .run();
}
