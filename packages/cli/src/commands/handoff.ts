import { randomUUID } from "node:crypto";
import { argumentError } from "../errors.js";
import { callMcpTool } from "../mcp.js";
import { renderFallback, renderHandoff, toJsonOutput } from "../render.js";
import { currentBranch, defaultBaseSha, detectRepo } from "../repo.js";
import type { Io } from "./login.js";

export const HANDOFF_STATUSES = [
  "in_progress",
  "blocked",
  "ready_for_review",
  "done",
] as const;

export type HandoffStatus = (typeof HANDOFF_STATUSES)[number];

export interface HandoffOptions {
  server: string;
  json: boolean;
  summary: string;
  next: string;
  task?: string;
  status?: string;
  blockers?: string;
  files: string[];
  branch?: string;
  base?: string;
  commit?: string;
  pr?: string;
  repo?: string;
  requestId?: string;
  cwd?: string;
}

export async function handoff(options: HandoffOptions, io: Io = process): Promise<void> {
  const taskId = options.task?.trim();
  if (!taskId) throw argumentError("handoff 必须传 --task。");
  if (taskId.length > 200) throw argumentError("--task 最多 200 字符。");
  if (!HANDOFF_STATUSES.includes(options.status as HandoffStatus)) {
    throw argumentError(`--status 必须是：${HANDOFF_STATUSES.join(", ")}`);
  }
  const summary = options.summary.trim();
  const next = options.next.trim();
  if (!summary) throw argumentError("handoff 必须传非空 --summary。");
  if (!next) throw argumentError("handoff 必须传非空 --next（done 时可说明完成情况）。");
  if (summary.length > 2000) throw argumentError("--summary 最多 2000 字符。");
  if (next.length > 2000) throw argumentError("--next 最多 2000 字符。");
  if (options.blockers && options.blockers.length > 2000) {
    throw argumentError("--blockers 最多 2000 字符。");
  }
  const files = [...new Set(options.files
    .flatMap((value) => value.split(","))
    .map((value) => value.trim())
    .filter(Boolean))];
  if (files.length > 50) throw argumentError("--files 最多 50 项。");
  if (files.some((file) => file.length > 300)) throw argumentError("每个 file 最多 300 字符。");

  const repo = (options.repo ?? await detectRepo(options.cwd))?.trim();
  if (!repo) throw argumentError("无法识别项目；请传 --repo（项目 ID 或 owner/repo）。");
  if (repo.length > 200) throw argumentError("--repo 最多 200 字符。");
  // Branch and base are context, not identity: repositories without a remote still record handoffs.
  const branch = options.branch?.trim() || await currentBranch(options.cwd);
  if (branch && branch.length > 200) throw argumentError("--branch 最多 200 字符。");
  const baseSha = (options.base?.trim() || await defaultBaseSha(options.cwd))?.toLowerCase();
  if (options.base !== undefined && !baseSha) throw argumentError("--base 不能为空。");
  if (baseSha && !/^[0-9a-f]{40}$/.test(baseSha)) {
    throw argumentError("--base 必须是完整 40 位十六进制 Git SHA。");
  }
  if (options.commit) assertSha(options.commit, "--commit");
  const pr = options.pr?.trim();
  if (pr !== undefined && (pr.length === 0 || pr.length > 500)) {
    throw argumentError("--pr 必须是非空字符串，最多 500 字符。");
  }

  const requestIdInput = options.requestId?.trim();
  if (options.requestId !== undefined && !requestIdInput) {
    throw argumentError("--request-id 不能为空。");
  }
  const requestId = requestIdInput || randomUUID();
  if (requestId.length > 100) {
    throw argumentError("--request-id 最多 100 字符。");
  }
  const args: Record<string, unknown> = {
    project: repo,
    task: taskId,
    status: options.status,
    summary,
    next,
    files,
    request_id: requestId,
  };
  if (branch) args.branch = branch;
  if (baseSha) args.base_sha = baseSha;
  if (options.blockers?.trim()) args.blockers = options.blockers.trim();
  if (options.commit) args.commit = options.commit.toLowerCase();
  if (pr) args.pr = pr;

  const result = await callMcpTool({
    server: options.server,
    name: "project_handoff_save",
    args,
  });
  if (options.json) io.stdout.write(`${toJsonOutput(result)}\n`);
  else {
    io.stdout.write(`${result.structured === undefined
      ? result.text ?? "交接已写入。"
      : renderHandoff(result.structured) || renderFallback(result.structured)}\n`);
  }
}

function assertSha(value: string, label: string): void {
  if (!/^[0-9a-f]{7,40}$/i.test(value)) {
    throw argumentError(`${label} 必须是 7-40 位十六进制 Git SHA。`);
  }
}
