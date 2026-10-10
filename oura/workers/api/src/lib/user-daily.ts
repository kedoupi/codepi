import type { Env } from "../env";
import {
  jsonError,
  oauthConfigured,
  resolveEncryptionKey,
} from "./config";
import { clampDays, dateWindow, loadDevDaily, mapOuraToDaily, type DailyResponse } from "./daily";
import { fetchDailySummaries, refreshAccessToken } from "./oura";
import type { SessionRow } from "./session";
import { loadEncryptedTokens, tokensFromOura, upsertEncryptedTokens } from "./tokens";

export async function loadDailyForSession(
  request: Request,
  env: Env,
  session: SessionRow,
  days: number,
): Promise<DailyResponse | Response> {
  const windowDays = clampDays(days);

  if (session.kind === "dev") {
    return loadDevDaily(windowDays);
  }

  const encKey = resolveEncryptionKey(request, env);
  if (!encKey) {
    return jsonError("TOKEN_ENCRYPTION_KEY not configured", 503);
  }
  if (!oauthConfigured(env)) {
    return jsonError("Oura OAuth secrets not configured", 503, {
      hint: "Set OURA_CLIENT_ID and OURA_CLIENT_SECRET",
    });
  }

  let stored = await loadEncryptedTokens(env, session.user_id, encKey);
  if (!stored) {
    return jsonError("no_stored_refresh_token", 401, {
      hint: "Reconnect Oura",
    });
  }

  if (!stored.access_token || stored.expires_at <= Date.now()) {
    const refreshed = await refreshAccessToken({
      refreshToken: stored.refresh_token,
      clientId: env.OURA_CLIENT_ID!,
      clientSecret: env.OURA_CLIENT_SECRET!,
    });
    stored = tokensFromOura(refreshed);
    await upsertEncryptedTokens(env, session.user_id, encKey, stored);
  }

  const { startDate, endDate, dates } = dateWindow(windowDays);
  const raw = await fetchDailySummaries({
    accessToken: stored.access_token,
    startDate,
    endDate,
  });
  return {
    ...mapOuraToDaily({
      dates,
      sleep: raw.sleep,
      readiness: raw.readiness,
      activity: raw.activity,
    }),
    user_id: session.user_id,
  };
}

export function isDailyResponse(value: DailyResponse | Response): value is DailyResponse {
  return !(value instanceof Response);
}
