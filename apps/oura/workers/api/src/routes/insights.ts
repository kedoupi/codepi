import type { Env } from "../env";
import { capabilities } from "../lib/capabilities.ts";
import { isResponse, requireSession } from "../lib/authz";
import { jsonError } from "../lib/config";
import { isDailyResponse, loadDailyForSession } from "../lib/user-daily";
import {
  buildCompareReport,
  buildWeeklyReport,
  compareForAccess,
  weeklyForAccess,
} from "../lib/weekly-report";

const noStore = { "Cache-Control": "no-store" };

async function sessionDaily(request: Request, env: Env) {
  const auth = await requireSession(request, env);
  if (isResponse(auth)) return auth;
  const daily = await loadDailyForSession(request, env, auth.session, 30);
  if (!isDailyResponse(daily)) return daily;
  return { days: daily.days, full: capabilities(env, auth.session.user_id).weeklyFull, sync: daily.sync };
}

/** GET /api/me/insights/weekly — summary for signed-in accounts; full advice for the personal owner. */
export async function handleWeeklyInsights(
  request: Request,
  env: Env,
): Promise<Response> {
  if (request.method !== "GET") return jsonError("method not allowed", 405);
  const loaded = await sessionDaily(request, env);
  if (isResponse(loaded)) return loaded;
  const report = buildWeeklyReport(loaded.days);
  return Response.json({ ...weeklyForAccess(report, loaded.full), sync: loaded.sync }, { headers: noStore });
}

/** GET /api/me/insights/compare?mode=week|range — full comparison requires personal access. */
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
  return Response.json({ ...compareForAccess(report, loaded.full), sync: loaded.sync }, { headers: noStore });
}
