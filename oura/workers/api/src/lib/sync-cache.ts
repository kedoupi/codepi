import type { Env } from "../env";
import { decorateDaily, type DailyResponse, type NestedDay } from "./daily";
import { ApiError, normalizeApiError } from "./errors";

export type SyncState = {
  synced_at: string | null;
  window_to: string | null;
  last_error: string | null;
  lease_until: number;
};
export type SyncInfo = {
  syncedAt: string | null;
  latestDataDate: string | null;
  stale: boolean;
  error: string | null;
  populatedDays: number;
  windowDays: number;
};
export async function readSyncState(env: Env, userId: string): Promise<SyncState | null> {
  return env.DB.prepare("SELECT synced_at, window_to, last_error, lease_until FROM sync_state WHERE user_id = ?")
    .bind(userId).first<SyncState>();
}

export async function cachedDaily(
  env: Env, userId: string, days: number, from: string, to: string,
  force: boolean, load: () => Promise<DailyResponse>,
): Promise<DailyResponse> {
  let state = await readSyncState(env, userId);
  const now = Date.now();
  const fresh = Boolean(state?.synced_at && now - Date.parse(state.synced_at) < 600_000 && state.window_to === to);
  const cooldown = Boolean(state?.synced_at && now - Date.parse(state.synced_at) < 30_000);
  if (!fresh || (force && !cooldown)) {
    const lease = crypto.randomUUID();
    const acquired = await env.DB.prepare(
      `INSERT INTO sync_state (user_id, lease_id, lease_until) VALUES (?, ?, ?)
       ON CONFLICT(user_id) DO UPDATE SET lease_id=excluded.lease_id, lease_until=excluded.lease_until
       WHERE sync_state.lease_until < ? RETURNING lease_id`,
    ).bind(userId, lease, now + 120_000, now).first();
    if (acquired) {
      try {
        const data = await load();
        const syncedAt = new Date().toISOString();
        // One atomic batch: a failed sync must not partially replace the last good snapshot.
        await env.DB.batch([
          env.DB.prepare("DELETE FROM daily_cache WHERE user_id = ? AND day >= ? AND day <= ?")
            .bind(userId, data.from, data.to),
          ...data.days.map(day => env.DB.prepare("INSERT INTO daily_cache (user_id, day, payload) VALUES (?, ?, ?)")
            .bind(userId, day.date, JSON.stringify(day))),
          env.DB.prepare("UPDATE sync_state SET synced_at=?, window_to=?, last_error=NULL, lease_until=0 WHERE user_id=? AND lease_id=?")
            .bind(syncedAt, to, userId, lease),
        ]);
      } catch (error) {
        const code = normalizeApiError(error, "upstream_unavailable", 502).code;
        await env.DB.prepare("UPDATE sync_state SET last_error=?, lease_until=0 WHERE user_id=? AND lease_id=?")
          .bind(code, userId, lease).run();
        if (!state?.synced_at) throw error;
      }
      state = await readSyncState(env, userId);
    } else if (!state?.synced_at) {
      throw new ApiError("sync_in_progress", 409);
    }
  }
  const rows = await env.DB.prepare("SELECT payload FROM daily_cache WHERE user_id=? AND day>=? AND day<=? ORDER BY day")
    .bind(userId, from, to).all<{ payload: string }>();
  const cached = rows.results.map(row => JSON.parse(row.payload) as NestedDay);
  const populated = cached.filter(day => day.sleep || day.readiness || day.activity);
  return decorateDaily(cached, {
    user_id: userId, source: "oura",
    sync: {
      syncedAt: state?.synced_at ?? null,
      latestDataDate: populated.at(-1)?.date ?? null,
      stale: Boolean(state?.last_error || !state?.synced_at || now - Date.parse(state.synced_at) >= 600_000 || state.window_to !== to),
      error: state?.last_error ?? null,
      populatedDays: populated.length, windowDays: days,
    },
  });
}
