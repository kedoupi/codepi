export const errorMessages: Record<string, string> = {
  unauthorized: "登录已过期，请重新登录。",
  auth_not_configured: "统一登录尚未配置，请稍后重试。",
  auth_unavailable: "统一登录暂时不可用，请稍后重试。",
  storage_unavailable: "保存或读取失败，请重试。已填写的内容仍保留。",
  invalid_argument: "填写内容不符合要求，请核对长度、类型和日期。",
  origin_not_allowed: "请求来源无效，请从本站重新打开。",
  secret_detected: "检测到疑似密钥，整次提交未保存。请移除后重试。",
  already_imported: "这个 AI 客户端已经完成过首次导入。",
  import_in_progress: "这个客户端还有未完成的导入。请恢复原 request_id，或先完成现有批次。",
  import_limit_exceeded: "导入不能超过 500 条或 512 KiB。",
  empty_import: "没有可导入的内容。",
  chunk_conflict: "重试的内容与已有分块不同。请恢复原内容，或在导入列表查看进度。",
  not_pending: "这条提议已被处理，请刷新列表。",
  not_pending_or_import_unfinished: "这条记忆已被处理，或所属导入尚未完成。",
  not_active: "记录状态已变化，请刷新后重试。",
  import_not_finished: "导入尚未完成，暂时不能确认。",
  import_original_mismatch: "原件完整性检查未通过，请稍后重试。",
};
let generation = 0;
export function clearRequests() { generation++; }
export async function api<T>(path: string, body?: unknown, method?: string): Promise<T> {
  const version = generation;
  const response = await fetch(path, {
    method: method ?? (body === undefined ? "GET" : "POST"),
    headers: body === undefined ? {} : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
    credentials: "same-origin", cache: "no-store", signal: AbortSignal.timeout(30_000),
  });
  if (version !== generation) throw new Error("会话已变化，请重新读取。");
  if (response.status === 401) {
    clearRequests();
    window.dispatchEvent(new Event("me:unauthorized"));
    throw new Error(errorMessages.unauthorized);
  }
  const result = await response.json() as T & { error?: string };
  if (version !== generation) throw new Error("会话已变化，请重新读取。");
  if (!response.ok) throw new Error(errorMessages[result.error ?? ""] ?? `请求失败（${response.status}），请稍后重试。`);
  return result;
}
export function queryString(values: Record<string, string | number | null | undefined>) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(values)) if (value !== undefined && value !== null && value !== "") params.set(key, String(value));
  return params.toString();
}
export function dateLabel(value: string) {
  return new Intl.DateTimeFormat("zh-CN", { timeZone: "Asia/Shanghai", dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
}
export const memoryKinds: Record<string, string> = { preference: "偏好", fact: "事实", decision: "决定", lesson: "经验", note: "笔记" };
export const timelineKinds: Record<string, string> = { work: "工作", startup: "创业", education: "教育", project: "项目", life: "生活" };
export const statuses: Record<string, string> = { pending: "待确认", active: "已确认", rejected: "已拒绝", archived: "已归档",
  open: "传输中", finishing: "等待完成", finished: "导入完成", failed: "失败" };
