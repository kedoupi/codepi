import { shanghaiDate } from "./state";

export const OWNER_SUBJECT = "kdp-owner";
export const OWNER_USER_ID = "rhythm-owner";
export const UPSTREAM_TIMEOUT_MS = 10_000;
export const UPSTREAM_PAGE_LIMIT = 1000;
export const UPSTREAM_MAX_PAGES = 20;

export class AppError extends Error {
  status: number;
  code: string;

  constructor(code: string, status: number, message = code) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

export function json(body: unknown, status = 200, headers: HeadersInit = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      ...headers,
    },
  });
}

export function secureResponse(response: Response): Response {
  const headers = new Headers(response.headers);
  headers.set("Cache-Control", "no-store");
  headers.set("X-Content-Type-Options", "nosniff");
  headers.set("X-Frame-Options", "DENY");
  headers.set("Referrer-Policy", "no-referrer");
  headers.set("X-Robots-Tag", "noindex, nofollow, noarchive");
  headers.set(
    "Content-Security-Policy",
    "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; font-src 'self'; connect-src 'self'; frame-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
  );
  return new Response(response.body, { status: response.status, headers });
}

export function validateDate(value: string | null): string {
  const date = (value ?? "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new AppError("invalid_date", 400);
  const parsed = new Date(`${date}T00:00:00+08:00`);
  if (Number.isNaN(parsed.getTime()) || shanghaiDate(parsed.getTime()) !== date) {
    throw new AppError("invalid_date", 400);
  }
  return date;
}

export function isoShanghai(epochMs: number): string {
  const local = new Date(epochMs + 8 * 60 * 60 * 1000);
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${local.getUTCFullYear()}-${pad(local.getUTCMonth() + 1)}-${pad(local.getUTCDate())}`
    + `T${pad(local.getUTCHours())}:${pad(local.getUTCMinutes())}:${pad(local.getUTCSeconds())}+08:00`;
}
