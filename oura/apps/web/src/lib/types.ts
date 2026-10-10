export type MeResponse = {
  authenticated: boolean;
  source: "oauth" | "dev" | null;
  userId: string | null;
  allowDevLogin: boolean;
  oauthConfigured: boolean;
  subscribed?: boolean;
  subscriptionStatus?: string | null;
  localePref?: "system" | "zh" | "en" | null;
  stripeConfigured?: boolean;
  priceLabel?: string;
};

/** DEV UI only when `/api/me` explicitly returned `allowDevLogin: true`. */
export function isDevLoginAllowed(value: boolean | null | undefined): boolean {
  return value === true;
}

export type Contributors = Record<string, number | null | undefined>;

export type Day = {
  date: string;
  sleep?: {
    score?: number | null;
    contributors?: Contributors;
  } | null;
  readiness?: {
    score?: number | null;
    temperature_deviation?: number | null;
    temperature_trend_deviation?: number | null;
    contributors?: Contributors;
  } | null;
  activity?: {
    score?: number | null;
    steps?: number | null;
    active_calories?: number | null;
  } | null;
};

export type DailyResponse = {
  ok?: boolean;
  days?: Day[];
};

export type SummaryCard = {
  label: string;
  score: number | null | undefined;
  meta: string;
  delta: number | null;
  sparkLine: string;
  sparkArea: string;
};

export type BarRow = {
  key: string;
  label: string;
  val: number;
  weak: boolean;
};

export type HeatCell = {
  key: string;
  score: number | null;
  pad: boolean;
  color?: string;
  tip?: string;
  title: string;
};

export type ChartHandle = { destroy: () => void };
