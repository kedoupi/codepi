export const errorMessages: Record<string, string> = {
  unauthorized: "登录已过期，请重新登录。",
  auth_not_configured: "统一登录尚未配置，请稍后重试。",
  auth_unavailable: "统一登录暂时不可用，请稍后重试。",
  upstream_unavailable: "数据暂不可用，请稍后重试。",
  invalid_date: "日期无效，不能读取未来日期。",
  internal_error: "数据暂不可用，请稍后重试。",
};

export async function api<T>(path: string): Promise<T> {
  const response = await fetch(path, {
    credentials: "same-origin",
    cache: "no-store",
    signal: AbortSignal.timeout(30_000),
  });
  if (response.status === 401) {
    window.dispatchEvent(new Event("rhythm:unauthorized"));
    throw new Error(errorMessages.unauthorized);
  }
  const result = await response.json() as T & { error?: string };
  if (!response.ok) throw new Error(errorMessages[result.error ?? ""] ?? `请求失败（${response.status}），请稍后重试。`);
  return result;
}

export function dateText(value: string): string {
  const [year, month, day] = value.split("-").map(Number);
  return `${year} 年 ${month} 月 ${day} 日`;
}

export function displayShanghaiTime(value: string | null): string | null {
  if (!value) return null;
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return null;
  const parts = new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai",
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    hourCycle: "h23",
  }).formatToParts(timestamp);
  const get = (type: Intl.DateTimeFormatPartTypes) => parts.find(part => part.type === type)?.value ?? "";
  return `${get("month")} 月 ${get("day")} 日 ${get("hour")}:${get("minute")}`;
}

