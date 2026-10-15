import type { Env } from "../env";
import {
  jsonError,
  oauthConfigured,
  resolveEncryptionKey,
} from "./config";
import { clampDays, dateWindow, loadDevDaily, mapOuraToDaily, type DailyResponse } from "./daily";
import { fetchDailySummaries } from "./oura";
import type { SessionRow } from "./session";
import { cachedDaily } from "./sync-cache.ts";
import { withOuraAccess } from "./oura-access.ts";

export async function loadDailyForSession(
  request: Request,
  env: Env,
  session: SessionRow,
  days: number,
  force = false,
): Promise<DailyResponse | Response> {
  const windowDays = clampDays(days);

  if (session.kind === "dev") {
    return loadDevDaily(windowDays);
  }

  return loadDailyForUser(request, env, session.user_id, windowDays, force);
}

export async function loadDailyForUser(
  request: Request, env: Env, userId: string, days: number, force = false,
): Promise<DailyResponse | Response> {
  const windowDays = clampDays(days);
  const encKey = resolveEncryptionKey(request, env);
  if (!encKey) {
    return jsonError("TOKEN_ENCRYPTION_KEY not configured", 503);
  }
  if (!oauthConfigured(env)) {
    return jsonError("Oura OAuth secrets not configured", 503, {
      hint: "Set OURA_CLIENT_ID and OURA_CLIENT_SECRET",
    });
  }

  const selected = dateWindow(windowDays);
  return cachedDaily(env, userId, windowDays, selected.startDate, selected.endDate, force, async () => {
  const { startDate, endDate, dates } = dateWindow(90);
  const raw = await withOuraAccess(request, env, userId, accessToken => fetchDailySummaries({
    accessToken,
    startDate,
    endDate,
  }));
  return {
    ...mapOuraToDaily({
      dates,
      sleep: raw.sleep,
      readiness: raw.readiness,
      activity: raw.activity,
    }),
    user_id: userId,
  };
  });
}

export function isDailyResponse(value: DailyResponse | Response): value is DailyResponse {
  return !(value instanceof Response);
}
