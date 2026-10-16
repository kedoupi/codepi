# 多工具入口与兼容范围

流程与规则总入口见 [规范导航](README.md)。本文件仅维护工具适配和验证边界，不复制产品约束与操作步骤。

项目规则和流程只维护一份，coding agent 与底层模型可替换。无论使用哪种工具，先读取根 `AGENTS.md`、目标目录的局部 `AGENTS.md` 和适用的 `.agents/skills/<name>/SKILL.md`。本地检查仅依赖 Node、Git 及各应用已有包管理器，不依赖某家模型 API。

## 仓库入口

| 工具 | 项目规则入口 | 项目 skill 入口 |
| --- | --- | --- |
| Codex | 根 `AGENTS.md` | `.agents/skills/`；可使用 `$kdp-dev` 等 |
| Claude Code | `CLAUDE.md` 导入根 `AGENTS.md` | `.claude/skills/` 的轻量入口读取共享 skill；可使用 `/kdp-dev` 等 |
| Cursor | `.cursor/rules/project.mdc` 指引读取根和局部 `AGENTS.md` | 按任务读取 `.agents/skills/` 的对应文件 |
| Gemini CLI | `GEMINI.md` 导入根 `AGENTS.md` | `.agents/skills/`；如当前版本未发现则直接读取文件 |
| GitHub Copilot | `.github/copilot-instructions.md` 指引读取根和局部 `AGENTS.md` | 在具备仓库读取能力的 agent 模式中读取共享 skill |
| 其他 coding agent | 显式要求读取根与目标目录的 `AGENTS.md` | 使用下面的通用指令；不假设自动发现或专用命令存在 |

Claude 的 skill 入口只有名称、触发描述和共享文件路径，不复制实现步骤。规则修改写入 `AGENTS.md`，流程修改写入共享 `SKILL.md`；不要把整份规则复制到每种工具的专用目录。`agents/openai.yaml` 只影响 Codex 显示，其他工具无需解析它。

工具中选择的模型名称不决定它支持哪些文件格式：同一模型运行在不同客户端时，入口能力可能不同。以实际客户端及版本为准。

## 不依赖专用语法的任务指令

```text
在分配给本任务的工作目录操作。
先读取 AGENTS.md，再读取 .agents/skills/kdp-dev/SKILL.md，
修改目标目录前读取它的局部 AGENTS.md。
任务：……
验收：……
允许修改：……
任务基线：……
协调者及任务分配记录：……（仅多 agent 并行时需要）
```

审查、集成发布和交接分别替换为 `kdp-review`、`kdp-release`、`kdp-handoff`。`kdp-release` 也用于只读核对旧分支/worktree，使用它不自动授权合并或部署。入口未加载时使用这段指令，不要求安装新的工具或同步个人全局配置。

## 接入验收

每种工具第一次进入本项目，在开始写代码前确认：

1. 能说出当前 worktree、任务基线和写入范围。
2. 已读取当前项目规则，知道产品是个人数字空间、已停用广告。
3. 能定位目标目录的局部规范和适用的共享 skill。
4. 能运行 `node scripts/agent/check.mjs --base <基线SHA>`，明确这是预览而非已完成验证。

这些是读取与行为验收，不只是询问 agent “是否支持”。若它没有仓库读取或执行权限，可提供对应内容和检查结果供讨论，但不能声称已经在工作区完成开发或验证。

## 当前验证边界

入口格式按官方文档核对于 2026-10-15。该日期不是之后新增 skill 的客户端验收日期。本地文件引用、共享 skill 格式与脚本回归检查不能替代端到端会话测试；未逐一启动 Claude Code、Cursor、Gemini CLI 或 Copilot 验收。自动发现还受安装版本、项目可信状态与用户配置影响，首次使用按上面的步骤验收。Copilot 不同界面及模式的指令支持也可能不同。

规范通过 Git 版本管理分发。新任务应从包含这组规范的基线开始；已有 worktree 或远程 checkout 不会自动跟随主分支更新。继续已有任务时，先检查当前改动，再按用户授权同步所需版本，不能为了加载规范而覆盖在途工作。工具若缓存项目指令，需要刷新或重新启动会话，并重新执行上面的接入验收。

官方依据：

- Codex skills：https://developers.openai.com/codex/skills/
- Codex 项目规则：https://developers.openai.com/codex/guides/agents-md/
- Claude Code 项目记忆和导入：https://code.claude.com/docs/en/memory
- Claude Code skills：https://code.claude.com/docs/en/skills
- Cursor project rules：https://cursor.com/docs/context/rules
- Gemini CLI 项目上下文：https://geminicli.com/docs/cli/gemini-md/
- Gemini CLI skills：https://geminicli.com/docs/cli/skills/
- Copilot 仓库指令：https://docs.github.com/en/copilot/how-tos/configure-custom-instructions/add-repository-instructions
