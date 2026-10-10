import type { Env } from "../env";
import { isResponse, requireSession } from "../lib/authz";
import { jsonError } from "../lib/config";
import {
  isEntitled,
  loadSubscription,
} from "../lib/subscription";
import { isDailyResponse, loadDailyForSession } from "../lib/user-daily";
import {
  buildCompareReport,
  buildWeeklyReport,
  paywallCompare,
  paywallWeekly,
} from "../lib/weekly-report";

const noStore = { "Cache-Control": "no-store" };

async function sessionDaily(request: Request, env: Env) {
  const auth = await requireSession(request, env);
  if (isResponse(auth)) return auth;
  const daily = await loadDailyForSession(request, env, auth.session, 30);
  if (!isDailyResponse(daily)) return daily;
  const sub = await loadSubscription(env, auth.session.user_id);
  return { days: daily.days, subscribed: isEntitled(sub?.status) };
}

/** GET /api/me/insights/weekly — 3 teaser lines free; tips require subscription. */
export async function handleWeeklyInsights(
  request: Request,
  env: Env,
): Promise<Response> {
  if (request.method !== "GET") return jsonError("method not allowed", 405);
  const loaded = await sessionDaily(request, env);
  if (isResponse(loaded)) return loaded;
  const report = buildWeeklyReport(loaded.days);
  return Response.json(paywallWeekly(report, loaded.subscribed), { headers: noStore });
}

/** GET /api/me/insights/compare?mode=week|range — full page requires subscription. */
export async function handleCompareInsights(
  request: Request,
  env: Env,
): Promise<Response> {
  if (request.method !== "GET") return jsonError("method not allowed", 405);
  const loaded = await sessionDaily(request, env);
  if (isResponse(loaded)) return loaded;
  const url = new URL(request.url);
  const mode = url.searchParams.get("mode") === "range" ? "range" : "week";
  const report = buildCompareReport(loaded.days, mode);
  return Response.json(paywallCompare(report, loaded.subscribed), { headers: noStore });
}
