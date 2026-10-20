import { app, errorResponse } from "./app";
import { secureResponse } from "./lib";
import type { Env } from "./types";

export { MeMcp } from "./mcp";
export { MeImportsBackup } from "./imports-backup";

export default {
  async fetch(request: Request, env: Env, ctx?: ExecutionContext) {
    try { return secureResponse(await app.fetch(request, env, ctx)); }
    catch (error) { return secureResponse(errorResponse(error)); }
  },
} satisfies ExportedHandler<Env>;
