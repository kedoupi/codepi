import { callMcpTool } from "../mcp.js";
import { renderContext, renderFallback, toJsonOutput } from "../render.js";
import type { Io } from "./login.js";

export interface ContextOptions {
  server: string;
  json: boolean;
  cwd?: string;
}

export async function context(options: ContextOptions, io: Io = process): Promise<void> {
  const result = await callMcpTool({
    server: options.server,
    name: "get_context",
    args: {},
  });
  if (options.json) {
    io.stdout.write(`${toJsonOutput(result)}\n`);
  } else {
    io.stdout.write(`${result.structured === undefined
      ? result.text ?? "无可显示内容"
      : renderContext(result.structured) || renderFallback(result.structured)}\n`);
  }
}
