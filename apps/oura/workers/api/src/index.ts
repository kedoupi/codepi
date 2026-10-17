import type { Env } from "./env";
import { dispatch } from "./app";
import { runAutomaticSync } from "./lib/auto-sync.ts";
import { normalizeApiError, storageQuotaResetAt } from "./lib/errors.ts";

function corsHeaders(req: Request, env: Env): HeadersInit {
  const origin = req.headers.get("Origin");
  const allowed = origin === new URL(req.url).origin || origin === env.FRONTEND_ORIGIN;
  if (!origin || !allowed) return { Vary: "Origin" };
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "GET, POST, PUT, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Allow-Credentials": "true",
    Vary: "Origin",
  };
}

export default {
  async scheduled(controller: ScheduledController, env: Env): Promise<void> {
    await runAutomaticSync(env, controller.scheduledTime, controller.cron);
  },
  async fetch(request: Request, env: Env, ctx?: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    try {
      return await dispatch(request, env, ctx);
    } catch (err) {
      const requestId = crypto.randomUUID();
      const error = normalizeApiError(err);
      const retryAt = error.code === "storage_write_quota_exceeded" ? storageQuotaResetAt() : null;
      // Keep operational evidence without health data, credentials, query
      // parameters or raw provider/database exception messages.
      console.error(JSON.stringify({ event: "api_failure", requestId, route: url.pathname, code: error.code, status: error.status }));
      return Response.json(
        { error: error.code, requestId, ...(retryAt ? { retryAt } : {}) },
        { status: error.status, headers: { ...corsHeaders(request, env), "Cache-Control": "no-store", "X-Request-ID": requestId,
          ...(retryAt ? { "Retry-After": String(Math.max(1, Math.ceil((Date.parse(retryAt) - Date.now()) / 1000))) } : {}),
        } },
      );
    }
  },
} satisfies ExportedHandler<Env>;
