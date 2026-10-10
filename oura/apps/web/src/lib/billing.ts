export type WeeklyPayload = {
  ok?: boolean;
  subscribed?: boolean;
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
  ok?: boolean;
  subscribed?: boolean;
  locked?: boolean;
  mode?: "week" | "range";
  left?: CompareColumn | null;
  right?: CompareColumn | null;
  bodyLocale?: string;
};

export async function startCheckout(locale: "zh" | "en"): Promise<string> {
  const res = await fetch("/api/stripe/checkout", {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ locale }),
  });
  const data = (await res.json().catch(() => ({}))) as { url?: string; error?: string };
  if (!res.ok || !data.url) {
    throw new Error(data.error ?? `HTTP ${res.status}`);
  }
  return data.url;
}

export async function startPortal(): Promise<string> {
  const res = await fetch("/api/stripe/portal", {
    method: "POST",
    credentials: "include",
  });
  const data = (await res.json().catch(() => ({}))) as { url?: string; error?: string };
  if (!res.ok || !data.url) {
    throw new Error(data.error ?? `HTTP ${res.status}`);
  }
  return data.url;
}

export async function setDevSubscription(entitled: boolean): Promise<void> {
  const res = await fetch("/api/dev/subscription", {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ entitled }),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
}
