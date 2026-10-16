import type { Locale } from "./i18n";

export class RequestError extends Error {
  code: string;
  status: number;
  requestId: string;
  retryAt: string;
  constructor(code: string, status: number, requestId = "", retryAt = "") {
    super(code);
    this.code = code;
    this.status = status;
    this.requestId = requestId;
    this.retryAt = retryAt;
  }
}

function reportExpiredSession(error: RequestError): RequestError {
  if (error.status === 401 && error.code === "unauthorized" && typeof window !== "undefined") {
    window.dispatchEvent(new Event("oura:session-expired"));
  }
  return error;
}

// AbortSignal.any is not part of ES2022's lib; combine signals without relying on it.
function mergeSignals(...signals: (AbortSignal | null | undefined)[]) {
  const defined = signals.filter((s): s is AbortSignal => !!s);
  const dispose = () => { for (const signal of defined) signal.removeEventListener("abort", abort); };
  const controller = new AbortController();
  const abort = () => controller.abort();
  for (const signal of defined) {
    if (signal.aborted) {
      abort();
      break;
    }
    signal.addEventListener("abort", abort, { once: true });
  }
  return { signal: controller.signal, dispose };
}

export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const timeoutSignal = AbortSignal.timeout(25_000);
  const { signal, dispose } = mergeSignals(timeoutSignal, init.signal);
  const abortFailure = () => init.signal?.aborted
    ? new RequestError("aborted", 0)
    : timeoutSignal.aborted ? new RequestError("timeout", 0) : null;
  try {
    let response: Response;
    try {
      response = await fetch(path, { ...init, credentials: "include", cache: "no-store", signal });
    } catch {
      throw abortFailure() ?? new RequestError("network_error", 0);
    }
    let body: unknown = null;
    try {
      body = await response.json();
    } catch {
      const cancelled = abortFailure();
      if (cancelled) throw cancelled;
      if (!response.ok) {
        throw reportExpiredSession(new RequestError(response.status === 401 ? "unauthorized" : "service_unavailable", response.status,
          response.headers.get("X-Request-ID") || ""));
      }
      throw new RequestError("invalid_response", 502,
        response.headers.get("X-Request-ID") || "");
    }
    if (!response.ok) {
      const errorBody = (body && typeof body === "object") ? body as Record<string, unknown> : {};
      const code = typeof errorBody.error === "string"
        ? errorBody.error
        : response.status === 401 ? "unauthorized" : "service_unavailable";
      throw reportExpiredSession(new RequestError(code, response.status,
        response.headers.get("X-Request-ID") || "",
        typeof errorBody.retryAt === "string" ? errorBody.retryAt : ""));
    }
    if (!body || typeof body !== "object") throw new RequestError("invalid_response", 502);
    return body as T;
  } finally {
    dispose();
  }
}
export function errorText(error: unknown, locale: Locale): string {
  const code = error instanceof RequestError ? error.code : "service_unavailable";
  const messages: Record<string, [string, string]> = {
    unauthorized: ["网站登录已过期，请重新登录。", "Your website session expired. Sign in again."],
    reconnect_required: ["Oura 授权已失效，请重新连接。", "Your Oura authorization expired. Reconnect Oura."],
    oura_not_configured: ["Oura 连接配置异常，请联系维护者检查。", "The Oura connection configuration needs attention. Contact the site maintainer."],
    upstream_request_rejected: ["Oura 拒绝了此次数据请求，请稍后重试；这不代表授权已失效。", "Oura rejected this data request. Retry later; this does not indicate expired authorization."],
    upstream_access_denied: ["已刷新 Oura 连接，但上游仍拒绝此类数据的访问，请检查 Oura 中的应用授权。", "The Oura connection was refreshed, but access to this data is still denied. Check the app's permissions in Oura."],
    oura_scope_required: ["Oura 授权缺少此类数据所需权限，请重新连接并允许请求的全部权限。", "Reconnect Oura and allow all requested permissions to access this data."],
    invalid_upstream_response: ["Oura 返回的数据格式异常，请稍后重试。", "Oura returned an unexpected response. Retry later."],
    rate_limited: ["Oura 请求较多，请稍后重试。", "Oura is rate limiting requests. Retry shortly."],
    sync_in_progress: ["数据正在同步，请稍后刷新。", "Sync is in progress. Retry shortly."],
    auto_sync_disabled: ["后台数据更新暂未开启，请联系维护者检查配置。", "Background data updates are disabled. Contact the site maintainer."],
    daily_sync_budget_reached: ["今日自动同步写入预算已用完，将在北京时间次日 09:00 后继续，已保存的数据保留。", "Today's automatic write budget is used. Background sync resumes after 01:00 UTC tomorrow; saved data is retained."],
    storage_write_quota_exceeded: ["数据库写入额度已达到上限，暂时无法保存新数据。额度每天北京时间 08:00 重置，已保存的历史数据保留。", "The database write limit has been reached. New data cannot be saved until the daily reset at 00:00 UTC. Saved history is retained."],
    permission_or_membership_required: ["此类数据缺少权限或会员访问资格，请重新授权并检查 Oura 会员状态。", "Permission or membership access is missing. Reauthorize and check your Oura membership."],
    sync_window_too_large: ["数据量较大，请缩小日期范围后重试。", "Too much data. Retry with a shorter date range."],
    network_error: ["连接超时或网络不可用，请重试。", "The connection timed out or is unavailable. Retry."],
    timeout: ["连接超时，请重试。", "The connection timed out. Retry."],
    aborted: ["请求已取消。", "The request was cancelled."],
    service_unavailable: ["服务暂时不可用，请稍后重试。", "The service is temporarily unavailable. Retry shortly."],
    upstream_unavailable: ["暂时无法同步 Oura，请稍后重试。", "Oura sync is temporarily unavailable. Retry shortly."],
    invalid_response: ["服务响应异常，请稍后重试。", "Unexpected server response. Retry shortly."],
  };
  let text = (messages[code] ?? messages.service_unavailable)[locale === "zh" ? 0 : 1];
  if (code === "storage_write_quota_exceeded" && error instanceof RequestError && Number.isFinite(Date.parse(error.retryAt))) {
    const reset = new Date(error.retryAt).toLocaleString(locale === "zh" ? "zh-CN" : "en", {
      timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit",
    });
    text += locale === "zh" ? ` 本次预计恢复：${reset}（北京时间）。` : ` Expected reset: ${reset} (Shanghai time).`;
  }
  return text + (error instanceof RequestError && error.requestId ? ` (${error.requestId.slice(0, 8)})` : "");
}
