import type { Env } from "./env";
import { dispatch } from "./app";
import { runAutomaticSync } from "./lib/auto-sync.ts";
import { normalizeApiError, storageQuotaResetAt } from "./lib/errors.ts";
import { WorkerEntrypoint } from "cloudflare:workers";
import { executeHealthOperation } from "./lib/health-data.ts";
import { pageHealthData, prepareHealthPage, splitHealthRequestArgs } from "./lib/health-mcp-page.ts";
import { emptySummary } from "@kedoupi/shared/desk/contract";
import { buildHealthSummary } from "./routes/desk-summary.ts";
import type { HealthReply, HealthRequest, SourceSummary } from "@kedoupi/shared/mcp/contract";

/** RPC capability only: no public HTTP route can invoke these operations. */
export class HealthMcp extends WorkerEntrypoint<Env> {
  async execute(input: HealthRequest): Promise<HealthReply> {
    if (input?.subject !== "kdp-owner" || !this.env.PERSONAL_OWNER_ID || this.env.PERSONAL_OWNER_ID === "dev-local") {
      return { ok: false, error: "not_owner", status: 403 };
    }
    try {
      const requestNow = Date.now();
      const { rawArgs, cursor } = splitHealthRequestArgs(input.args);
      const prepared = await prepareHealthPage(input.operation, rawArgs, cursor);
      const snapshotNow = prepared.binding
        ? Date.parse(prepared.binding.generated_at)
        : requestNow;
      const executionArgs = prepared.binding
        && (input.operation === "query_records" || input.operation === "aggregate")
        ? { ...rawArgs, refresh: false }
        : rawArgs;
      const data = await executeHealthOperation(
        this.env,
        this.env.PERSONAL_OWNER_ID,
        input.operation,
        executionArgs,
        snapshotNow,
      );
      return {
        ok: true,
        data: await pageHealthData(input.operation, data, prepared, new Date(snapshotNow).toISOString()),
      };
    } catch (failure) {
      const error = normalizeApiError(failure);
      return { ok: false, error: error.code, status: error.status };
    }
  }

  async summary(subject: string): Promise<SourceSummary> {
    if (subject !== "kdp-owner" || !this.env.PERSONAL_OWNER_ID || this.env.PERSONAL_OWNER_ID === "dev-local") {
      const { privateMetric: _privateMetric, ...empty } = emptySummary("health", "未授权");
      return { ...empty, status: "unavailable" };
    }
    const { privateMetric: _privateMetric, ...summary } = await buildHealthSummary(this.env);
    return summary;
  }
}

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
