export class ApiError extends Error {
  status: number;
  retryAfter: number;

  constructor(message: string, status: number, retryAfter = 0) {
    super(message);
    this.status = status;
    this.retryAfter = retryAfter;
  }
}

export function currentReturn() {
  return `${location.pathname}${location.search}${location.hash}`;
}

export function loginHref(returnTo = currentReturn()) {
  return `/api/auth/login?return=${encodeURIComponent(returnTo)}`;
}

export function redirectToLogin() {
  location.assign(loginHref());
}

export async function api(
  path: string,
  options: {
    method?: string;
    body?: unknown;
    allowUnauthenticated?: boolean;
  } = {},
): Promise<Record<string, unknown>> {
  const response = await fetch(path, {
    method: options.method || (options.body === undefined ? "GET" : "POST"),
    headers: options.body === undefined
      ? undefined
      : { "Content-Type": "application/json" },
    ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
    credentials: "same-origin",
    cache: "no-store",
    signal: AbortSignal.timeout(20_000),
  });
  if (response.status === 401) {
    if (!options.allowUnauthenticated) redirectToLogin();
    throw new ApiError("请先登录", 401);
  }
  let result: Record<string, unknown>;
  try {
    result = await response.json() as Record<string, unknown>;
  } catch {
    throw new ApiError(`服务响应无效（HTTP ${response.status}）`, response.status);
  }
  if (!response.ok) {
    throw new ApiError(
      String(result.error || `请求失败（HTTP ${response.status}）`),
      response.status,
      Number(result.retry_after || response.headers.get("Retry-After")) || 0,
    );
  }
  return result;
}
