export const deskSources = ["health", "gu", "wechat"] as const;
export type DeskSource = typeof deskSources[number];
export type DeskRange = "current" | "week";
export interface DeskSummary {
  source: DeskSource;
  status: "ok" | "empty" | "unavailable";
  asOf: string | null;
  updatedAt: string | null;
  stale: boolean;
  metrics: { label: string; value: string }[];
  facts: string[];
  notes: string[];
  attention: { label: string; href: string }[];
  privateMetric?: { label: string; value: string };
}

export function calendarDay(now = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(now);
  const get = (type: string) => parts.find(part => part.type === type)!.value;
  return `${get("year")}-${get("month")}-${get("day")}`;
}

export function shiftDay(day: string, offset: number): string {
  return new Date(Date.parse(`${day}T00:00:00Z`) + offset * 86400_000).toISOString().slice(0, 10);
}

export function finite(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

export function emptySummary(source: DeskSource, note: string): DeskSummary {
  return {
    source, status: "empty", asOf: null, updatedAt: null, stale: false,
    metrics: [], facts: [], notes: [note], attention: [],
  };
}

export function deskJson(value: unknown, status = 200): Response {
  return Response.json(value, { status, headers: {
    "Cache-Control": "no-store", "Referrer-Policy": "no-referrer",
    "X-Content-Type-Options": "nosniff", "X-Robots-Tag": "noindex, nofollow",
  } });
}

/** Dedicated per-service read credential, never an SSO or provider token. */
export async function authorizeSummary(request: Request, token?: string): Promise<Response | null> {
  const url = new URL(request.url);
  if (url.protocol !== "https:" && !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)) {
    return deskJson({ error: "https_required" }, 403);
  }
  if (request.method !== "GET") return deskJson({ error: "method_not_allowed" }, 405);
  if (!token || token.length < 32) return deskJson({ error: "summary_not_configured" }, 503);
  const supplied = request.headers.get("Authorization") ?? "";
  if (supplied.length > 512) return deskJson({ error: "unauthorized" }, 401);
  const digest = async (v: string) => new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(v)));
  const [a, b] = await Promise.all([digest(supplied), digest(`Bearer ${token}`)]);
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  if (diff) return deskJson({ error: "unauthorized" }, 401);
  if (!["current", "week"].includes(url.searchParams.get("range") ?? "current")) {
    return deskJson({ error: "invalid_range" }, 400);
  }
  return null;
}
