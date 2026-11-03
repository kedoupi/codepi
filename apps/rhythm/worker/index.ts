import { app, errorResponse } from "./app";
import { secureResponse } from "./lib";
import { recomputeRange, dateOffset } from "./recompute";
import { readSettings } from "./settings";
import { shanghaiDate } from "./state";
import type { Env } from "./types";

export default {
  async fetch(request: Request, env: Env, ctx?: ExecutionContext) {
    try { return secureResponse(await app.fetch(request, env, ctx)); }
    catch (error) { return secureResponse(errorResponse(error)); }
  },
  async scheduled(_controller: ScheduledController, env: Env, ctx: ExecutionContext) {
    const yesterday = dateOffset(shanghaiDate(Date.now()), -1);
    const from = dateOffset(yesterday, -2);
    ctx.waitUntil(recomputeRange(env, from, yesterday, await readSettings(env))
      .catch(() => console.error("daily_recompute_failed")));
  },
} satisfies ExportedHandler<Env>;
