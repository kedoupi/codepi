import { CliError, EXIT, errorMessage } from "./errors.js";
import type { McpToolResult } from "./mcp.js";

export const MAX_TASK_PAGES = 64;
export const MAX_TASK_ITEMS = 5000;

type JsonObject = Record<string, unknown>;
type FetchTaskPage = (offset: number, revision: string) => Promise<McpToolResult>;

/**
 * Follow `task_list` offset pages to completion before rendering. The first
 * page's revision must stay the same; a repeated or non-advancing offset or a
 * duplicate task means the list changed or the server misbehaved.
 */
export async function expandTaskPages(first: McpToolResult, fetchPage: FetchTaskPage): Promise<McpToolResult> {
  const firstRoot = object(first.structured);
  if (!firstRoot) throw invalidPage("任务列表响应缺少结构化内容。");
  const revision = parseRevision(firstRoot.revision);
  const tasks: unknown[] = [];
  const seen = new Set<string>();
  let result = first;
  let requested = 0;
  for (let page = 1; page <= MAX_TASK_PAGES; page++) {
    const root = object(result.structured);
    if (!root || !Array.isArray(root.tasks)) throw invalidPage("任务列表分页缺少 tasks。");
    if (parseRevision(root.revision) !== revision) throw cursorStale();
    if (tasks.length + root.tasks.length > MAX_TASK_ITEMS) {
      throw new CliError("任务列表超过安全上限，请缩小筛选范围。", EXIT.REMOTE, { code: "task_list_too_large" });
    }
    for (const raw of root.tasks) {
      const task = object(raw);
      const id = task && typeof task.project === "string" && typeof task.key === "string" ? `${task.project}/${task.key}` : null;
      if (!id) throw invalidPage("任务列表分页包含无效任务。");
      if (seen.has(id)) throw invalidPage("任务列表分页返回了重复任务，请重新运行。");
      seen.add(id);
      tasks.push(task);
    }
    const next = root.next_offset;
    if (next === null || next === undefined) {
      return { structured: { ...firstRoot, tasks, next_offset: null, revision }, text: null };
    }
    if (!Number.isSafeInteger(next) || (next as number) <= requested) {
      throw invalidPage("任务列表分页游标未推进，请重新运行。");
    }
    requested = next as number;
    try {
      result = await fetchPage(requested, revision);
    } catch (error) {
      throw taskListError(error);
    }
  }
  throw new CliError("任务列表分页页数超过安全上限，请缩小筛选范围。", EXIT.REMOTE, { code: "task_list_too_large" });
}

export function taskListError(error: unknown): unknown {
  return /\bcursor_stale\b/.test(errorMessage(error)) ? cursorStale() : error;
}

function parseRevision(value: unknown): string {
  if (typeof value !== "string" || !/^[0-9a-f]{64}$/.test(value)) {
    throw invalidPage("任务列表分页缺少有效的 revision，请重新运行。");
  }
  return value;
}

function invalidPage(message: string): CliError {
  return new CliError(message, EXIT.REMOTE, { code: "task_list_pagination_invalid" });
}

function cursorStale(): CliError {
  return new CliError("任务列表在分页期间发生变化（cursor_stale），请重新运行 `codepi tasks`。", EXIT.REMOTE,
    { code: "task_list_cursor_stale" });
}

function object(value: unknown): JsonObject | null {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as JsonObject : null;
}
