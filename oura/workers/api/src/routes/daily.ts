import type { Env } from "../env";
import { isResponse, requireSession } from "../lib/authz";
import { clampDays } from "../lib/daily";
import { isDailyResponse, loadDailyForSession } from "../lib/user-daily";

/** GET /api/me/daily?days=7|30|90 — session-gated nested daily (live board shape). */
export async function handleMeDaily(
  request: Request,
  env: Env,
): Promise<Response> {
  const url = new URL(request.url);
  if (request.method !== "GET" && !(url.pathname === "/api/me/sync" && request.method === "POST")) {
    return Response.json({ error: "method_not_allowed" }, { status: 405 });
  }
  const days = clampDays(Number(url.searchParams.get("days") ?? "30"));
  const auth = await requireSession(request, env);
  if (isResponse(auth)) return auth;

  const daily = await loadDailyForSession(request, env, auth.session, days, request.method === "POST");
  if (!isDailyResponse(daily)) return daily;
  return Response.json(daily, { headers: { "Cache-Control": "no-store" } });
}
