import { argumentError } from "../errors.js";
import { callMcpTool, type McpToolResult } from "../mcp.js";
import { expandProjectCardPages, projectCardError } from "../project-card.js";
import { expandProjectListPages, projectListError } from "../project-list.js";
import { detectRepo } from "../repo.js";
import {
  renderFallback,
  renderProjectCard,
  renderProjectList,
  toJsonOutput,
} from "../render.js";
import type { Io } from "./login.js";

export interface ProjectOptions {
  server: string;
  json: boolean;
  repo?: string;
  cursor?: string;
  taskId?: string;
  handoffs?: number;
  status?: "active" | "paused" | "archived";
  list: boolean;
  cwd?: string;
}

export async function project(options: ProjectOptions, io: Io = process): Promise<void> {
  if (options.list) {
    if (options.repo || options.cursor || options.taskId || options.handoffs !== undefined) {
      throw argumentError("`codepi project list` 不接受 --repo、--cursor、--task-id 或 --handoffs");
    }
    const listArgs: Record<string, unknown> = {};
    if (options.status !== undefined) listArgs.status = options.status;
    const fetchPage = async (offset?: number, revision?: string): Promise<McpToolResult> => {
      try {
        return await callMcpTool({
          server: options.server,
          name: "projects_list",
          args: {
            ...listArgs,
            ...(offset === undefined ? {} : { offset }),
            ...(revision === undefined ? {} : { revision }),
          },
        });
      } catch (error) {
        throw projectListError(error);
      }
    };
    const first = await fetchPage();
    const result = await expandProjectListPages(
      first,
      (offset, revision) => fetchPage(offset, revision),
    );
    if (options.json) io.stdout.write(`${toJsonOutput(result)}\n`);
    else {
      io.stdout.write(`${result.structured === undefined
        ? result.text ?? "没有项目"
        : renderProjectList(result.structured) || renderFallback(result.structured)}\n`);
    }
    return;
  }
  if (options.status !== undefined) {
    throw argumentError("`--status` 仅用于 `codepi project list`。");
  }
  const repo = (options.repo ?? await detectRepo(options.cwd))?.trim();
  if (!repo) {
    throw argumentError("无法从 `git remote get-url origin` 识别 owner/repo；请传 --repo。");
  }
  if (repo.length > 200) throw argumentError("--repo 最多 200 字符。");
  const args: Record<string, unknown> = { project: repo };
  if (options.cursor !== undefined) args.cursor = options.cursor;
  if (options.taskId !== undefined) args.task_id = options.taskId;
  if (options.handoffs !== undefined) args.handoffs = options.handoffs;
  const fetchPage = (cursor?: string) => callMcpTool({
    server: options.server,
    name: "project_get",
    args: cursor === undefined ? args : { ...args, cursor },
  });
  let first: McpToolResult;
  try {
    first = await fetchPage(options.cursor);
  } catch (error) {
    throw projectCardError(error);
  }
  const result = await expandProjectCardPages(
    first,
    cursor => fetchPage(cursor),
    options.cursor ?? null,
  );
  if (options.json) io.stdout.write(`${toJsonOutput(result)}\n`);
  else {
    io.stdout.write(`${result.structured === undefined
      ? result.text ?? "没有项目卡"
      : renderProjectCard(result.structured) || renderFallback(result.structured)}\n`);
  }
}
