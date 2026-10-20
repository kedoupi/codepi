import { app, errorResponse } from "./app";
import { runScheduledSync } from "./github";
import { secureResponse } from "./lib";
import type { Env } from "./types";

export { ProjectMcp } from "./mcp";

export default {
  async fetch(request: Request, env: Env, ctx?: ExecutionContext) {
    try {
      return secureResponse(await app.fetch(request, env, ctx));
    } catch (error) {
      return secureResponse(errorResponse(error));
    }
  },

  async scheduled(_controller: ScheduledController, env: Env): Promise<void> {
    try {
      await runScheduledSync(env);
    } catch {
      console.warn(JSON.stringify({ event: "project_scheduled_failed" }));
    }
  },
} satisfies ExportedHandler<Env>;
