import { session } from "./state.svelte";

/**
 * 统一 API 边界。401（或 /api/me 声明未登录）时走 session.clear()，
 * 由它记录回跳 hash、递增 loadVersion 并让 App 回到登录页。
 */
export async function api(path: string, body?: unknown, method?: string) {
  const version = session.loadVersion;
  const response = await fetch(path, {
    method: method || (body === undefined ? "GET" : "POST"),
    headers: body === undefined ? { "X-GU-Workspace": "1" } : { "Content-Type": "application/json", "X-GU-Workspace": "1" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    credentials: "same-origin",
    cache: "no-store",
    signal: AbortSignal.timeout(15_000),
  });
  // 登录类端点的 401/4xx 是表单错误（如验证码无效），不是会话过期；
  // 否则会话清理会卸载正在输入的登录表单。旧实现同样只清数据端点的 401。
  const isAuthEndpoint = path.startsWith("/api/auth/");
  if (response.status === 401) {
    if (!isAuthEndpoint && version === session.loadVersion) session.clear();
    throw Object.assign(new Error("登录已过期，请重新登录"), { status: 401 });
  }
  let result: Record<string, unknown>;
  try {
    result = (await response.json()) as Record<string, unknown>;
  } catch {
    throw Object.assign(
      new Error(`服务响应无效（HTTP ${response.status}），请稍后重试`),
      { status: response.status },
    );
  }
  if (path === "/api/me" && result.authenticated === false) {
    if (version === session.loadVersion) session.clear();
    throw Object.assign(new Error("登录已过期，请重新登录"), { status: 401 });
  }
  if (!response.ok) {
    throw Object.assign(
      new Error(String(result.error || `请求失败（HTTP ${response.status}）`)),
      {
        status: response.status,
        retryAfter:
          Number(result.retry_after || response.headers.get("Retry-After")) ||
          0,
      },
    );
  }
  if (!isAuthEndpoint && version !== session.loadVersion)
    throw new Error("会话或数据读取已变化，请重新读取");
  return result;
}

export async function uploadFile(file: File) {
  const version = session.loadVersion;
  const form = new FormData();
  form.append("file", file);
  const response = await fetch("/api/materials", { method: "POST", body: form,
    credentials: "same-origin", cache: "no-store", signal: AbortSignal.timeout(60_000) });
  if (response.status === 401) {
    if (version === session.loadVersion) session.clear();
    throw new Error("登录已过期，请重新登录");
  }
  const result = await response.json() as Record<string, unknown>;
  if (version !== session.loadVersion) throw new Error("会话已变化，请重新读取");
  if (!response.ok) throw new Error(String(result.error || "上传失败"));
  return result;
}
