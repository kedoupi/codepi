import type { Env } from "../env";
import { ApiError } from "./errors.ts";

// A conservative app budget, not the account-wide Cloudflare quota. This only
// bounds background work, whether started by the user or the daily schedule.
// Workers Paid includes 50 million rows written per month (~1.6M/day) plus the
// free daily allowance, so 400k estimated rows/day stays an order of magnitude
// inside the plan and leaves room for other products on the account. The
// estimate is deliberately ~4x the rows actually written (index and bookkeeping
// overhead), so this corresponds to roughly 100k real rows per day.
export const AUTOMATIC_WRITE_BUDGET = 400_000;

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
