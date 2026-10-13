import type { Locale } from "./i18n";

export class RequestError extends Error {
  constructor(public code: string, public status: number, public requestId = "") { super(code); }
}
export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  let response: Response;
  try {
    response = await fetch(path, { ...init, credentials: "include", cache: "no-store", signal: AbortSignal.timeout(25_000) });
  } catch { throw new RequestError("network_error", 0); }
  const body = await response.json().catch(() => null);
  if (!response.ok) throw new RequestError(body?.error || "service_unavailable", response.status, response.headers.get("X-Request-ID") || "");
  if (!body || typeof body !== "object") throw new RequestError("invalid_response", 502);
  return body as T;
}
export function errorText(error: unknown, locale: Locale): string {
  const code = error instanceof RequestError ? error.code : "service_unavailable";
  const messages: Record<string, [string, string]> = {
    unauthorized: ["登录已过期，请重新连接 Oura。", "Your session expired. Reconnect Oura."],
    reconnect_required: ["Oura 授权已失效，请重新连接。", "Your Oura authorization expired. Reconnect Oura."],
    rate_limited: ["Oura 请求较多，请稍后重试。", "Oura is rate limiting requests. Retry shortly."],
    sync_in_progress: ["数据正在同步，请稍后刷新。", "Sync is in progress. Retry shortly."],
    network_error: ["连接超时或网络不可用，请重试。", "The connection timed out or is unavailable. Retry."],
    service_unavailable: ["服务暂时不可用，请稍后重试。", "The service is temporarily unavailable. Retry shortly."],
    upstream_unavailable: ["暂时无法同步 Oura，请稍后重试。", "Oura sync is temporarily unavailable. Retry shortly."],
    invalid_response: ["服务响应异常，请稍后重试。", "Unexpected server response. Retry shortly."],
  };
  const text = (messages[code] ?? messages.service_unavailable)[locale === "zh" ? 0 : 1];
  return text + (error instanceof RequestError && error.requestId ? ` (${error.requestId.slice(0, 8)})` : "");
}
