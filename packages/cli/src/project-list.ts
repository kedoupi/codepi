import { CliError, EXIT, errorMessage } from "./errors.js";
import type { McpToolResult } from "./mcp.js";

export const MAX_PROJECT_LIST_PAGES = 128;
export const MAX_PROJECT_LIST_ITEMS = 5000;

type JsonObject = Record<string, unknown>;
type FetchProjectListPage = (offset: number, revision: string) => Promise<McpToolResult>;

/**
 * Follow offset pagination to completion before rendering a project list.
 * A repeated or non-advancing offset means the server did not make progress.
 */
export async function expandProjectListPages(
  first: McpToolResult,
  fetchPage: FetchProjectListPage,
): Promise<McpToolResult> {
  const firstRoot = object(first.structured);
  if (!firstRoot) throw invalidPage("项目列表响应缺少结构化内容。");

  const firstAsOf = firstRoot.as_of;
  if (firstAsOf !== undefined && firstAsOf !== null && typeof firstAsOf !== "string") {
    throw invalidPage("项目列表的 as_of 类型无效。");
  }
  const firstRevision = parseRevision(firstRoot.revision);
  if (!Object.hasOwn(firstRoot, "next_offset")) {
    return {
      structured: { ...firstRoot, revision: firstRevision },
      text: first.text,
    };
  }

  const projects: unknown[] = [];
  const seenProjects = new Set<string>();
  const seenOffsets = new Set<number>([0]);
  let result = first;
  let requestedOffset = 0;

  for (let pageNumber = 1; pageNumber <= MAX_PROJECT_LIST_PAGES; pageNumber += 1) {
    const root = object(result.structured);
    if (!root) throw invalidPage("项目列表分页响应缺少结构化内容。");
    if (pageNumber > 1 && !Object.hasOwn(root, "next_offset")) {
      throw invalidPage("项目列表后续分页缺少 next_offset。");
    }
    const revision = parseRevision(root.revision);
    if (revision !== firstRevision) {
      throw cursorStale("项目列表在分页期间发生变化（cursor_stale），请重新运行 `codepi project list`。");
    }
    if (!Array.isArray(root.projects)) {
      throw invalidPage("项目列表分页响应缺少 projects。");
    }
    if (projects.length + root.projects.length > MAX_PROJECT_LIST_ITEMS) {
      throw new CliError(
        "项目列表超过安全上限，请缩小筛选范围后重试。",
        EXIT.REMOTE,
        { code: "project_list_too_large" },
      );
    }

    for (const rawProject of root.projects) {
      const project = object(rawProject);
      if (!project) throw invalidPage("项目列表分页包含无效项目。");
      const keys = projectKeys(project);
      if (keys.length === 0) throw invalidPage("项目列表分页项目缺少 id 和 repo。");
      for (const key of keys) {
        if (seenProjects.has(key)) {
          throw new CliError(
            "项目列表分页返回了重复项目，列表可能在分页期间发生变化；请重新运行 `codepi project list`。",
            EXIT.REMOTE,
            { code: "project_list_pagination_invalid" },
          );
        }
      }
      for (const key of keys) seenProjects.add(key);
      projects.push(project);
    }

    const nextOffset = parseNextOffset(root.next_offset);
    if (nextOffset === null) {
      return {
        structured: {
          ...firstRoot,
          as_of: firstAsOf ?? null,
          projects,
          next_offset: null,
          revision: firstRevision,
        },
        text: null,
      };
    }
    if (nextOffset <= requestedOffset) {
      throw new CliError(
        "项目列表分页游标未推进，请重新运行 `codepi project list`。",
        EXIT.REMOTE,
        { code: "project_list_pagination_invalid" },
      );
    }
    if (seenOffsets.has(nextOffset)) {
      throw new CliError(
        "项目列表分页游标重复，请重新运行 `codepi project list`。",
        EXIT.REMOTE,
        { code: "project_list_pagination_invalid" },
      );
    }
    if (pageNumber === MAX_PROJECT_LIST_PAGES) {
      throw new CliError(
        "项目列表分页页数超过安全上限，请缩小筛选范围后重试。",
        EXIT.REMOTE,
        { code: "project_list_too_large" },
      );
    }

    seenOffsets.add(nextOffset);
    requestedOffset = nextOffset;
    try {
      result = await fetchPage(nextOffset, firstRevision);
    } catch (error) {
      throw projectListError(error);
    }
  }

  throw new CliError(
    "项目列表分页页数超过安全上限，请缩小筛选范围后重试。",
    EXIT.REMOTE,
    { code: "project_list_too_large" },
  );
}

export function projectListError(error: unknown): unknown {
  const message = errorMessage(error);
  if (/\bcursor_stale\b/.test(message)) {
    return cursorStale("项目列表在分页期间发生变化（cursor_stale），请重新运行 `codepi project list`。");
  }
  return error;
}

function parseNextOffset(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    throw invalidPage("项目列表分页的 next_offset 类型无效。");
  }
  return value as number;
}

function parseRevision(value: unknown): string {
  if (typeof value !== "string" || !/^[0-9a-f]{64}$/.test(value)) {
    throw invalidPage("项目列表分页缺少有效的 revision，请重新运行 `codepi project list`。");
  }
  return value;
}

function projectKeys(project: JsonObject): string[] {
  const keys: string[] = [];
  if (typeof project.id === "string" && project.id.length > 0) {
    keys.push(`id:${project.id.toLowerCase()}`);
  }
  if (typeof project.repo === "string" && project.repo.length > 0) {
    keys.push(`repo:${project.repo.toLowerCase()}`);
  }
  return keys;
}

function invalidPage(message: string): CliError {
  return new CliError(message, EXIT.REMOTE, { code: "project_list_pagination_invalid" });
}

function cursorStale(message: string): CliError {
  return new CliError(message, EXIT.REMOTE, { code: "project_list_cursor_stale" });
}

function object(value: unknown): JsonObject | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as JsonObject
    : null;
}
