import { argumentError } from "../errors.js";
import { callMcpTool, type McpToolResult } from "../mcp.js";
import { detectRepo } from "../repo.js";
import { renderFallback, renderOverview, renderProjectCard, renderProjectList, renderTasks, toJsonOutput } from "../render.js";
import { expandTaskPages, taskListError } from "../task-list.js";
import type { Io } from "./login.js";

export const TASK_STATUSES = ["decide", "doing", "bug", "verify", "idea"] as const;
export const NEED_KINDS = ["any", "none", "decide", "attend", "authorize", "confirm"] as const;

function print(io: Io, json: boolean, result: McpToolResult, render: (value: unknown) => string, empty: string) {
  if (json) io.stdout.write(`${toJsonOutput(result)}\n`);
  else {
    io.stdout.write(`${result.structured === undefined
      ? result.text ?? empty
      : render(result.structured) || renderFallback(result.structured)}\n`);
  }
}

async function projectRef(repo: string | undefined, cwd?: string): Promise<string> {
  const ref = (repo ?? await detectRepo(cwd))?.trim();
  if (!ref) throw argumentError("无法从 `git remote get-url origin` 识别项目；请传 --repo（项目 ID 或 owner/repo）。");
  if (ref.length > 200) throw argumentError("--repo 最多 200 字符。");
  return ref;
}

export interface ProjectOptions { server: string; json: boolean; list: boolean; repo?: string; cwd?: string }

/** `codepi project` reads one project card; `codepi project list` lists projects from the overview. */
export async function project(options: ProjectOptions, io: Io = process): Promise<void> {
  if (options.list) {
    if (options.repo) throw argumentError("`codepi project list` 不接受 --repo。");
    const result = await callMcpTool({ server: options.server, name: "work_overview", args: {} });
    print(io, options.json, result, renderProjectList, "没有项目");
    return;
  }
  const result = await callMcpTool({
    server: options.server,
    name: "project_get",
    args: { project: await projectRef(options.repo, options.cwd) },
  });
  print(io, options.json, result, renderProjectCard, "没有项目卡");
}

export async function work(options: { server: string; json: boolean }, io: Io = process): Promise<void> {
  const result = await callMcpTool({ server: options.server, name: "work_overview", args: {} });
  print(io, options.json, result, renderOverview, "没有待办");
}

export interface TasksOptions {
  server: string;
  json: boolean;
  repo?: string;
  status?: string;
  need?: string;
  includeDone?: boolean;
}

export async function tasks(options: TasksOptions, io: Io = process): Promise<void> {
  if (options.status !== undefined && !TASK_STATUSES.includes(options.status as typeof TASK_STATUSES[number])) {
    throw argumentError(`--status 必须是：${TASK_STATUSES.join(", ")}`);
  }
  if (options.need !== undefined && !NEED_KINDS.includes(options.need as typeof NEED_KINDS[number])) {
    throw argumentError(`--need 必须是：${NEED_KINDS.join(", ")}`);
  }
  const args: Record<string, unknown> = { limit: 100 };
  if (options.repo !== undefined) args.project = await projectRef(options.repo);
  if (options.status !== undefined) args.status = options.status;
  if (options.need !== undefined) args.need = options.need;
  if (options.includeDone) args.include_done = true;
  const fetchPage = async (offset?: number, revision?: string) => {
    try {
      return await callMcpTool({
        server: options.server,
        name: "task_list",
        args: { ...args, ...(offset === undefined ? {} : { offset }), ...(revision === undefined ? {} : { revision }) },
      });
    } catch (error) {
      throw taskListError(error);
    }
  };
  const result = await expandTaskPages(await fetchPage(), (offset, revision) => fetchPage(offset, revision));
  print(io, options.json, result, renderTasks, "没有待办");
}
