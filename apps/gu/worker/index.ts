import type { Env } from "./types";
import { app, errorResponse } from "./app";
import { secureResponse } from "./lib";

export { GuMaterialsBackup } from "./materials-backup";
export { GuMcp } from "./mcp";

export default {
  async fetch(request: Request, env: Env, ctx?: ExecutionContext) {
    try {
      return secureResponse(await app.fetch(request, env, ctx));
    } catch (error) {
      return secureResponse(errorResponse(error));
    }
  },
} satisfies ExportedHandler<Env>;
