import { SsoError } from "./sso.ts";

export class ApiError extends Error {
  code: string;
  status: number;
  constructor(code: string, status = 502) {
    super(code);
    this.code = code;
    this.status = status;
  }
}

export function normalizeApiError(error: unknown, fallback = "internal_error", status = 500): ApiError {
  if (error instanceof SsoError) return new ApiError(error.code, error.status);
  let current = error;
  let isD1 = false;
  // D1 may put the provider's quota message on a nested cause.
  for (let depth = 0; depth < 5 && current instanceof Error; depth++) {
    const message = current.message;
    isD1 ||= /D1/i.test(message);
    if (isD1 && /writ/i.test(message) && (/\b7500\b/.test(message)
      || (/daily/i.test(message) && /limit|quota/i.test(message)))) {
      return new ApiError("storage_write_quota_exceeded", 503);
    }
    current = current.cause;
  }
  return error instanceof ApiError ? error : new ApiError(fallback, status);
}

export function storageQuotaResetAt(now = Date.now()): string {
  return new Date(Date.parse(new Date(now).toISOString().slice(0, 10)) + 86_400_000).toISOString();
}

export async function upstreamRequest(url: string | URL, init: RequestInit = {}): Promise<Response> {
  try {
    return await fetch(url, { ...init, signal: init.signal ?? AbortSignal.timeout(12_000) });
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw new ApiError("upstream_unavailable", 502);
  }
}

export function ouraResourceError(status: number): ApiError {
  // A rejected access token is recoverable; only the refresh endpoint can
  // confirm that the grant itself is no longer usable.
  if (status === 401) return new ApiError("oura_access_token_rejected", 502);
  if (status === 403) return new ApiError("permission_or_membership_required", 403);
  if (status === 400 || status === 422) return new ApiError("upstream_request_rejected", 502);
  if (status === 429) return new ApiError("rate_limited", 429);
  return new ApiError("upstream_unavailable", 502);
}

async function missingOuraScope(response: Response): Promise<boolean> {
  const reader = response.body?.getReader();
  if (!reader) return false;
  const decoder = new TextDecoder();
  let text = "";
  let size = 0;
  try {
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      size += part.value.byteLength;
      if (size > 4096) return false;
      text += decoder.decode(part.value, { stream: true });
    }
    const body = JSON.parse(text + decoder.decode()) as { detail?: unknown; error?: unknown; title?: unknown } | null;
    return body?.error === "insufficient_scope" || body?.title === "Missing Scopes"
      || typeof body?.detail === "string"
        && /^Token is not authorized access [a-z][a-z0-9_]{0,63} scope\.$/.test(body.detail);
  } catch {
    // An unreadable diagnostic body must retain the original HTTP error.
    return false;
  } finally {
    await reader.cancel().catch(() => {});
  }
}

export async function ouraResponseError(response: Response): Promise<ApiError> {
  // Oura uses 401 for missing scopes too. Refreshing cannot expand consent.
  if (response.status === 401 || response.status === 403) {
    if (await missingOuraScope(response)) return new ApiError("oura_scope_required", 403);
  } else {
    await response.body?.cancel();
  }
  return ouraResourceError(response.status);
}

export async function upstreamFetch(url: string | URL, init: RequestInit = {}): Promise<Response> {
  const response = await upstreamRequest(url, init);
  if (!response.ok) {
    throw await ouraResponseError(response);
  }
  return response;
}
