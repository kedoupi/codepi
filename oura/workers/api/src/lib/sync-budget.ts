import type { Env } from "../env";
import { ApiError } from "./errors.ts";

// A conservative app budget, not the account-wide Cloudflare quota. Leave room
// for manual sync, other products, scheduler bookkeeping and auth operations.
export const AUTOMATIC_WRITE_BUDGET = 50_000;

export async function reserveSyncWrites(env: Env, userId: string, rows: number) {
  if (rows > AUTOMATIC_WRITE_BUDGET) throw new ApiError("sync_window_too_large", 422);
  const day = new Date().toISOString().slice(0, 10);
  const result = await env.DB.prepare(`INSERT INTO auto_sync_budget(user_id,utc_day,reserved_rows) VALUES (?,?,?)
    ON CONFLICT(user_id) DO UPDATE SET utc_day=excluded.utc_day,
      reserved_rows=CASE WHEN auto_sync_budget.utc_day=excluded.utc_day
        THEN auto_sync_budget.reserved_rows+excluded.reserved_rows ELSE excluded.reserved_rows END
    WHERE auto_sync_budget.utc_day<>excluded.utc_day OR auto_sync_budget.reserved_rows+excluded.reserved_rows<=?
    RETURNING reserved_rows`).bind(userId, day, rows, AUTOMATIC_WRITE_BUDGET).first();
  if (!result) throw new ApiError("daily_sync_budget_reached", 429);
}
