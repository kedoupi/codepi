import type { Env } from "./types";
import { app, errorResponse, isCacheableAssetPath } from "./app";
import { secureResponse } from "./lib";

export { GuMaterialsBackup } from "./materials-backup";
export { GuMcp } from "./mcp";

export default {
  async fetch(request: Request, env: Env, ctx?: ExecutionContext) {
    try {
      const response = await app.fetch(request, env, ctx);
      const immutableAsset = response.status === 200 && isCacheableAssetPath(new URL(request.url).pathname);
      return secureResponse(response, immutableAsset);
    } catch (error) {
      return secureResponse(errorResponse(error));
    }
  },
} satisfies ExportedHandler<Env>;
