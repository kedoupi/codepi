/**
 * Read-only tools exposed to MCP clients (Claude, ChatGPT).
 *
 * Everything here is computed server-side from the same cached daily data the
 * dashboard uses: the model never does the arithmetic, and every response
 * carries the date range, coverage and sync state so answers stay checkable.
 */
import type { Env } from "../env";
import { capabilities } from "./capabilities.ts";
import { clampDays, type DailyResponse, type NestedDay } from "./daily.ts";
import type { SessionRow } from "./session.ts";
import { loadSubscription } from "./subscription.ts";
import { isDailyResponse, loadDailyForSession } from "./user-daily.ts";
import { buildCompareReport, buildWeeklyReport, type InsightDay } from "./weekly-report.ts";

export const DISCLAIMER = "非医疗建议 / Not medical advice.";

export type ToolDefinition = {
  name: string;
  title: string;
  description: string;
  inputSchema: Record<string, unknown>;
};

const DAYS_SCHEMA = {
  type: "integer",
  enum: [7, 30, 90],
  default: 30,
  description: "Window size in days ending today.",
} as const;

export const TOOLS: ToolDefinition[] = [
  {
    name: "get_connection_status",
    title: "Oura connection status",
    description:
      "Check whether the Oura account is connected, when data was last synced, the latest day with data, and whether the cached metrics are stale. Call this first when results look out of date.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "get_daily_metrics",
    title: "Daily sleep, readiness and activity",
    description:
      "Read per-day Oura scores and key contributors for a date window. Scores are Oura's official values; missing metrics stay null rather than being estimated. Defaults to the last 30 days.",
    inputSchema: {
      type: "object",
      properties: { days: DAYS_SCHEMA },
      additionalProperties: false,
    },
  },
  {
    name: "get_period_summary",
    title: "Averages for a period",
    description:
      "Average sleep, readiness and activity scores with average steps for a window, plus how many days actually had data. Use this for 'how am I doing lately' questions.",
    inputSchema: {
      type: "object",
      properties: { days: DAYS_SCHEMA },
      additionalProperties: false,
    },
  },
  {
    name: "compare_periods",
    title: "Compare two periods",
    description:
      "Compare the most recent 7 days against the 7 days before them (mode=week), or the last 30 days against the previous 30 (mode=range). Returns both sides and the exact dates compared.",
    inputSchema: {
      type: "object",
      properties: {
        mode: { type: "string", enum: ["week", "range"], default: "week" },
      },
      additionalProperties: false,
    },
  },
];

function ownerSession(userId: string): SessionRow {
  // Reuses the dashboard's data path (cache, token refresh, mapping) without a
  // browser session. Authorization is enforced by the OAuth token, not this row.
  return { id: "mcp", user_id: userId, kind: "oauth", expires_at: "" };
}

function round1(value: number | null | undefined): number | null {
  return typeof value === "number" && Number.isFinite(value) ? Math.round(value * 10) / 10 : null;
}

function dailyForTool(res: DailyResponse) {
  return {
    from: res.from,
    to: res.to,
    days: res.days.map(day => ({
      date: day.date,
      sleep_score: day.sleep?.score ?? null,
      readiness_score: day.readiness?.score ?? null,
      activity_score: day.activity?.score ?? null,
      steps: day.activity?.steps ?? null,
      contributors: {
        sleep: day.sleep?.contributors ?? null,
        readiness: day.readiness?.contributors ?? null,
      },
    })),
  };
}

function coverage(days: NestedDay[]) {
  const populated = days.filter(day => day.sleep || day.readiness || day.activity);
  return {
    days_requested: days.length,
    days_with_data: populated.length,
    days_without_data: days.length - populated.length,
    latest_day_with_data: populated.at(-1)?.date ?? null,
  };
}

type ToolResult = {
  content: { type: "text"; text: string }[];
  structuredContent: Record<string, unknown>;
  isError?: boolean;
};

function ok(payload: Record<string, unknown>): ToolResult {
  return {
    content: [{ type: "text", text: JSON.stringify(payload, null, 2) }],
    structuredContent: payload,
  };
}

export async function runTool(
  env: Env,
  request: Request,
  userId: string,
  name: string,
  args: Record<string, unknown>,
): Promise<ToolResult> {
  const sub = await loadSubscription(env, userId);
  const caps = capabilities(env, userId, sub?.status);
  if (!caps.personal) {
    return {
      content: [{ type: "text", text: "This connector is limited to the account owner." }],
      structuredContent: { error: "not_owner" },
      isError: true,
    };
  }

  const daysArg = clampDays(Number(args.days ?? 30));
  const session = ownerSession(userId);

  if (name === "get_connection_status") {
    const daily = await loadDailyForSession(request, env, session, 90);
    if (!isDailyResponse(daily)) return await errorFrom(daily);
    return ok({
      connected: true,
      account: userId,
      synced_at: daily.sync?.syncedAt ?? null,
      latest_day_with_data: daily.sync?.latestDataDate ?? null,
      stale: daily.sync?.stale ?? false,
      stale_reason: daily.sync?.error ?? null,
      populated_days_in_window: daily.sync?.populatedDays ?? 0,
      window_days: daily.sync?.windowDays ?? 90,
      data_source: daily.source ?? "oura",
      disclaimer: DISCLAIMER,
    });
  }

  if (name === "get_daily_metrics") {
    const daily = await loadDailyForSession(request, env, session, daysArg);
    if (!isDailyResponse(daily)) return await errorFrom(daily);
    return ok({
      ...dailyForTool(daily),
      coverage: coverage(daily.days),
      synced_at: daily.sync?.syncedAt ?? null,
      stale: daily.sync?.stale ?? false,
      disclaimer: DISCLAIMER,
    });
  }

  if (name === "get_period_summary") {
    const daily = await loadDailyForSession(request, env, session, daysArg);
    if (!isDailyResponse(daily)) return await errorFrom(daily);
    const report = buildWeeklyReport(daily.days as InsightDay[]);
    return ok({
      period: report.thisPeriod,
      days: daily.count,
      averages: report.avgs.thisWeek,
      coverage: coverage(daily.days),
      synced_at: daily.sync?.syncedAt ?? null,
      stale: daily.sync?.stale ?? false,
      notes: report.summaries,
      disclaimer: DISCLAIMER,
    });
  }

  if (name === "compare_periods") {
    const mode = args.mode === "range" ? "range" : "week";
    const window = mode === "range" ? 90 : 30;
    const daily = await loadDailyForSession(request, env, session, window);
    if (!isDailyResponse(daily)) return await errorFrom(daily);
    const report = buildCompareReport(daily.days as InsightDay[], mode);
    return ok({
      mode: report.mode,
      left: { ...report.left, sleep: round1(report.left.sleep) },
      right: { ...report.right, sleep: round1(report.right.sleep) },
      coverage: coverage(daily.days),
      synced_at: daily.sync?.syncedAt ?? null,
      stale: daily.sync?.stale ?? false,
      basis: "Averages computed from Oura official daily scores; both sides use the same metric set.",
      disclaimer: DISCLAIMER,
    });
  }

  return {
    content: [{ type: "text", text: `Unknown tool: ${name}` }],
    structuredContent: { error: "unknown_tool", name },
    isError: true,
  };
}

async function errorFrom(res: Response): Promise<ToolResult> {
  const body = (await res.json().catch(() => ({}))) as { error?: string };
  const code = body.error ?? `http_${res.status}`;
  const hint =
    code === "reconnect_required"
      ? "The Oura token expired. Open https://oura.kdp.cool and log in again."
      : code === "sync_in_progress"
        ? "A sync is already running; retry shortly."
        : undefined;
  return {
    content: [{ type: "text", text: hint ? `${code}: ${hint}` : code }],
    structuredContent: { error: code, ...(hint ? { hint } : {}) },
    isError: true,
  };
}
