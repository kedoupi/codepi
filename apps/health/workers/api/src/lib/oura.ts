/**
 * Oura Cloud API — authorization-code OAuth + daily collections.
 * Docs: https://cloud.ouraring.com/docs/authentication
 *       https://cloud.ouraring.com/v2/docs
 */

import { ApiError, ouraResourceError, upstreamRequest } from "./errors.ts";
export const OURA_AUTH_URL = "https://cloud.ouraring.com/oauth/authorize";
export const OURA_TOKEN_URL = "https://api.ouraring.com/oauth/token";
export const OURA_API_BASE = "https://api.ouraring.com/v2/usercollection";

/** Resilience needs stress; both ring endpoints need ring_configuration. */
export const DEFAULT_SCOPES = "daily personal email heartrate workout tag session spo2 heart_health stress ring_configuration";

export type OuraTokens = {
  access_token: string;
  refresh_token: string;
  expires_in: number;
};

export type OuraPersonalInfo = {
  id: string;
  email?: string | null;
  age?: number | null;
};

export function compareOuraIdentity(
  stored: { id: string; email?: string | null },
  received: OuraPersonalInfo,
) {
  const normalize = (id: string) => id.trim().toLowerCase().replace(/-/g, "");
  // Diagnostic categories only. Normalized IDs or matching emails must never
  // authorize replacing the existing provider binding.
  const idComparison = stored.id === received.id ? "exact"
    : stored.id.trim() === received.id.trim() ? "whitespace_only"
    : stored.id.toLowerCase() === received.id.toLowerCase() ? "case_only"
    : normalize(stored.id) === normalize(received.id) ? "format_only"
    : "different";
  const emailComparison = typeof stored.email !== "string" || !stored.email.trim()
    || typeof received.email !== "string" || !received.email.trim() ? "unavailable"
    : stored.email === received.email ? "exact"
    : stored.email.trim().toLowerCase() === received.email.trim().toLowerCase() ? "format_only"
    : "different";
  return {
    idComparison,
    emailComparison,
    storedIdLength: stored.id.length,
    receivedIdLength: received.id.length,
  };
}

/**
 * Loose Oura Cloud daily document. `daily_sleep` / `daily_readiness` /
 * `daily_activity` share `id` + `day` + `score`; readiness adds temperature
 * fields; activity adds steps / calories / time buckets. pick* selects the
 * production field set — extra Cloud keys are ignored.
 */
export type OuraDailyDoc = {
  id?: string;
  day: string;
  score?: number | null;
  contributors?: Record<string, number | null | undefined>;
  temperature_deviation?: number | null;
  temperature_trend_deviation?: number | null;
  steps?: number | null;
  active_calories?: number | null;
  equivalent_walking_distance?: number | null;
  high_activity_time?: number | null;
  medium_activity_time?: number | null;
  low_activity_time?: number | null;
  sedentary_time?: number | null;
};

export type OuraListResponse = {
  data?: OuraDailyDoc[];
  next_token?: string | null;
};

export function buildAuthorizeUrl(opts: {
  clientId: string;
  redirectUri: string;
  state: string;
  scope?: string;
}): string {
  const auth = new URL(OURA_AUTH_URL);
  auth.searchParams.set("response_type", "code");
  auth.searchParams.set("client_id", opts.clientId);
  auth.searchParams.set("redirect_uri", opts.redirectUri);
  auth.searchParams.set("scope", opts.scope ?? DEFAULT_SCOPES);
  auth.searchParams.set("state", opts.state);
  return auth.toString();
}

async function postToken(body: URLSearchParams): Promise<OuraTokens> {
  const res = await upstreamRequest(OURA_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  const json = await res.json().catch(() => null) as (Partial<OuraTokens> & { error?: string }) | null;
  if (!res.ok) {
    if (res.status === 429) throw new ApiError("rate_limited", 429);
    if (res.status >= 500) throw new ApiError("upstream_unavailable", 502);
    if (res.status === 400 || res.status === 401) {
      if (json?.error === "invalid_client" || json?.error === "unauthorized_client") {
        throw new ApiError("oura_not_configured", 503);
      }
      if (json?.error === "invalid_grant") {
        throw new ApiError(body.get("grant_type") === "refresh_token" ? "reconnect_required" : "token_exchange_failed", 401);
      }
    }
    throw new ApiError("upstream_request_rejected", 502);
  }
  const expiresIn = Number(json?.expires_in);
  if (typeof json?.access_token !== "string" || !json.access_token
    || typeof json.refresh_token !== "string" || !json.refresh_token
    || !Number.isFinite(expiresIn) || expiresIn <= 0) {
    throw new ApiError("invalid_upstream_response", 502);
  }
  return {
    access_token: json.access_token,
    refresh_token: json.refresh_token,
    expires_in: expiresIn,
  };
}

export async function exchangeCodeForTokens(args: {
  code: string;
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}): Promise<OuraTokens> {
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code: args.code,
    redirect_uri: args.redirectUri,
    client_id: args.clientId,
    client_secret: args.clientSecret,
  });
  return postToken(body);
}

export async function refreshAccessToken(args: {
  refreshToken: string;
  clientId: string;
  clientSecret: string;
}): Promise<OuraTokens> {
  const body = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: args.refreshToken,
    client_id: args.clientId,
    client_secret: args.clientSecret,
  });
  return postToken(body);
}

async function ouraGet<T>(accessToken: string, path: string): Promise<T> {
  const res = await upstreamRequest(`${OURA_API_BASE}${path}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) {
    // Keep provider HTTP status semantics reachable: 401 triggers the
    // single refresh path, while 429 remains eligible for backoff.
    throw ouraResourceError(res.status);
  }
  return JSON.parse(await res.text()) as T;
}

export async function fetchPersonalInfo(
  accessToken: string,
): Promise<OuraPersonalInfo> {
  const info = await ouraGet<OuraPersonalInfo>(accessToken, "/personal_info");
  if (typeof info?.id !== "string" || !info.id.trim()) {
    throw new ApiError("invalid_upstream_response", 502);
  }
  return info;
}

async function fetchCollection(
  accessToken: string,
  path: string,
  startDate: string,
  endDate: string,
): Promise<OuraDailyDoc[]> {
  const out: OuraDailyDoc[] = [];
  let next: string | null = null;
  for (let i = 0; i < 8; i++) {
    const q = new URLSearchParams({ start_date: startDate, end_date: endDate });
    if (next) q.set("next_token", next);
    const page = await ouraGet<OuraListResponse>(
      accessToken,
      `${path}?${q.toString()}`,
    );
    if (page.data?.length) out.push(...page.data);
    next = page.next_token ?? null;
    if (!next) return out;
  }
  throw new ApiError("sync_window_too_large", 422);
}

export async function fetchDailySummaries(args: {
  accessToken: string;
  startDate: string;
  endDate: string;
}): Promise<{
  sleep: OuraDailyDoc[];
  readiness: OuraDailyDoc[];
  activity: OuraDailyDoc[];
}> {
  const { accessToken, startDate, endDate } = args;
  const [sleep, readiness, activity] = await Promise.all([
    fetchCollection(accessToken, "/daily_sleep", startDate, endDate),
    fetchCollection(accessToken, "/daily_readiness", startDate, endDate),
    fetchCollection(accessToken, "/daily_activity", startDate, endDate),
  ]);
  return { sleep, readiness, activity };
}
