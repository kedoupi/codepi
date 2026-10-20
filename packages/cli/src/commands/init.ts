import { argumentError } from "../errors.js";
import { initAgentsFile } from "../init.js";
import { gitRoot } from "../repo.js";
import type { Io } from "./login.js";

export interface InitCommandOptions {
  yes: boolean;
  json: boolean;
  cwd?: string;
}

export async function init(options: InitCommandOptions, io: Io = process): Promise<void> {
  const cwd = options.cwd ?? process.cwd();
  const root = await gitRoot(cwd);
  if (!root) throw argumentError("当前目录不是 Git 仓库；请先进入仓库根目录。");
  const result = await initAgentsFile({ cwd, root, yes: options.yes });
  if (options.json) {
    io.stdout.write(`${JSON.stringify({
      path: result.path,
      status: result.status,
      content: result.content,
    }, null, 2)}\n`);
    return;
  }
  if (result.status === "already_initialized") {
    io.stdout.write(
      `已存在 CodePi managed marker，不会自动修改或覆盖：${result.path}\n\n` +
      "当前版本的管理块如下。如确需更新，请先备份 AGENTS.md，再手动替换 marker 之间的内容，" +
      "并检查 marker 之外的用户内容没有被改动：\n\n" +
      `${result.content}\n`,
    );
    return;
  }
  io.stdout.write(`将追加到 ${result.path}：\n\n${result.content}\n`);
  if (result.status === "would_write") {
    io.stdout.write("\n未写入；确认后运行 `codepi init --yes`。\n");
  } else {
    io.stdout.write("\n已写入。\n");
  }
}
