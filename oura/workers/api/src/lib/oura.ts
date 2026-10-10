/**
 * Oura Cloud API — authorization-code OAuth + daily collections.
 * Docs: https://cloud.ouraring.com/docs/authentication
 *       https://cloud.ouraring.com/v2/docs
 */

export const OURA_AUTH_URL = "https://cloud.ouraring.com/oauth/authorize";
export const OURA_TOKEN_URL = "https://api.ouraring.com/oauth/token";
export const OURA_API_BASE = "https://api.ouraring.com/v2/usercollection";

/** Default scopes: sleep / readiness / activity (+ email for account identity). */
export const DEFAULT_SCOPES = "daily personal email";

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
  const res = await fetch(OURA_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`Oura token HTTP ${res.status}: ${text.slice(0, 240)}`);
  }
  const json = JSON.parse(text) as Partial<OuraTokens> & { error?: string };
  if (!json.access_token || !json.refresh_token) {
    throw new Error(json.error ?? "Oura token response missing tokens");
  }
  return {
    access_token: json.access_token,
    refresh_token: json.refresh_token,
    expires_in: Number(json.expires_in ?? 86400),
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
  const res = await fetch(`${OURA_API_BASE}${path}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`Oura ${path} HTTP ${res.status}: ${text.slice(0, 240)}`);
  }
  return JSON.parse(text) as T;
}

export async function fetchPersonalInfo(
  accessToken: string,
): Promise<OuraPersonalInfo> {
  const info = await ouraGet<OuraPersonalInfo>(accessToken, "/personal_info");
  if (!info?.id) throw new Error("Oura personal_info missing id");
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
    if (!next) break;
  }
  return out;
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
