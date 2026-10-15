import type { SyncInfo } from "./types";
export type WeeklyPayload = {
  sync?: SyncInfo;
  ok?: boolean;
  locked?: boolean;
  disclaimer?: string;
  thisPeriod?: { from: string; to: string };
  lastPeriod?: { from: string; to: string };
  summaries?: string[];
  teaser?: string[];
  tips?: string[];
  bodyLocale?: string;
};

export type CompareColumn = {
  label: string;
  from: string;
  to: string;
  days: number;
  sleep: number | null;
  readiness: number | null;
  activity: number | null;
  steps: number | null;
};

export type ComparePayload = {
  sync?: SyncInfo;
  ok?: boolean;
  locked?: boolean;
  mode?: "week" | "range";
  left?: CompareColumn | null;
  right?: CompareColumn | null;
  bodyLocale?: string;
};
