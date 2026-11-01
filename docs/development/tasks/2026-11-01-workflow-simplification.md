# Agent 工作流精简与真实客户端接入验收

- 状态：已交付；本地未提交
- 目标与验收：将普通开发收敛为单 agent、按需协作/审查/发布；保留安全与验证底线；确认 omp、Codex、Claude Code 能读取同一套规则并给出正确的开发入口。
- 不在范围内：Git 提交/推送/合并、生产发布、远程资源变更、Cursor/Gemini/Copilot 客户端验收、既有 Blog/CLI 文件的内容审查。
- worktree / 分支：`/Users/codepi/Coding/codepi` / `main`；普通单 agent 任务，无任务分配表。
- 起始 SHA / 审查基线：`c7217a1305dabff9d280ecba4ccc6c7c29df5205`。
- 当前交付：本 worktree 已停止写入后的下方文件清单；无交付提交 SHA。
- 实施 / 本地验证 / 审查 / 实际客户端验收：已完成，证据见下文。
- 合并 / 推送 / 部署：未执行，未获授权。
- 协调者 / 实施者 / 验证者：当前 Codex 会话；三个客户端另开临时只读会话验收。
- 允许修改的路径：本记录及 `docs/development/agent-compatibility.md`、`docs/development/tasks/README.md`；既有工作流优化保留在 `AGENTS.md`、`.agents/skills/kdp-dev/SKILL.md`、`docs/README.md`、`docs/development/README.md`、`docs/development/agent-workflow.md`。

## 工作流文件清单

以下文件共同属于本次工作流优化与交付证据；不含同 worktree 中已有的 Blog/CLI 改动：

- `.agents/skills/kdp-dev/SKILL.md`：精简开发步骤，保留基线、隔离、共享契约、检查和交付边界。
- `AGENTS.md`：保留项目边界、安全底线及检查/发布入口。
- `docs/README.md`：更新开发与工具入口说明。
- `docs/development/README.md`：明确规则归属和按任务选路。
- `docs/development/agent-workflow.md`：默认单 agent；协作、独立审查和发布按需；保留检查映射与任务模板。
- `docs/development/agent-compatibility.md`：限定 omp/Codex/Claude Code 的入口与实际验收证据。
- `docs/development/tasks/README.md`：提供本记录入口。
- `docs/development/tasks/2026-11-01-workflow-simplification.md`：本记录。

`docs/development/cloudflare-resource-registry.md`、`docs/development/tasks/2026-10-28-blog-mcp-followup.md`、`packages/cli/blogdiag.mjs`、`packages/cli/bloglegacy.mjs` 是既有的其他工作，不属于上述交付。检查时它们仍参与真实变更集映射，因此 CLI 与 Cloudflare 检查也被执行。

## 真实客户端接入验收

日期：2026-11-01（Asia/Shanghai）。版本：omp `18.14.1`、Codex CLI `0.166.0-alpha.5.1`、Claude Code `2.1.316`。

验收对象是上述 worktree 中尚未提交的工作流文件，不是基线提交中的旧版本。三个临时会话均只读，不提交、不部署，要求返回实际 checkout、SHA、普通任务是否需要分配表、开发 skill 路径、检查命令和已读取文件。三者的回答与规则一致：checkout 为 `/Users/codepi/Coding/codepi`，基线为 `c7217a1305dabff9d280ecba4ccc6c7c29df5205`，普通任务无需分配表，开发 skill 为 `.agents/skills/kdp-dev/SKILL.md`，检查入口为：

```bash
node scripts/agent/check.mjs --base c7217a1305dabff9d280ecba4ccc6c7c29df5205
node scripts/agent/check.mjs --base c7217a1305dabff9d280ecba4ccc6c7c29df5205 --run
```

| 客户端 | 执行方式与结果 | 读取证据及边界 |
| --- | --- | --- |
| omp | `omp --cwd <repo> -p --no-session --tools read,bash --approval-mode always-ask --max-time 5m`；退出 `0`，通过 | 读取根规则、开发导航、工作流和 `kdp-dev`；通过只读 Git 元数据确认分支/SHA。bash 需要交互批准而未使用，不影响本次文件读取与流程回答。 |
| Codex CLI | `codex exec --ephemeral -s read-only -C <repo>`；退出 `0`，通过 | 读取根规则、开发导航、工作流、`kdp-dev`、CLI 局部规则和检查映射；正确展开本次七项检查。个人 SessionStart/PostToolUse/Stop hook 报告失败，但不阻止仓库读取或回答；不作为仓库接入失败。 |
| Claude Code | `claude -p --permission-mode plan --no-session-persistence`；退出 `0`，通过 | 读取 `CLAUDE.md` 导入的根规则、开发导航、工作流、兼容页、共享 `kdp-dev` 和 `.claude` 轻量入口；正确区分工作区规则与 HEAD。 |

本次证明当前本机三个 CLI 在各自当前配置下能读取并应用规则。它不是持续兼容性保证；客户端升级、配置/缓存变化或换 worktree 后需要重新验收。未验收其他客户端。

## 本地验证证据

运行目录均为 `/Users/codepi/Coding/codepi`，基线为上述 SHA：

- `node --test scripts/agent/check.test.mjs`：35/35 通过。
- `node scripts/agent/lint.mjs`：通过；193 个脚本、29 个 JSON 文件、176 个 Markdown 文件无 lint 错误。
- `node scripts/agent/check.mjs --base HEAD --run`：选中的 7 项本地检查全部通过。包括 Cloudflare 测试 190/190、治理校验、工作流回归 35/35、lint、CLI 测试 54/54、CLI typecheck 与 build。
- 本证据页和索引补充后，重新运行 `node scripts/agent/check.mjs --base c7217a1305dabff9d280ecba4ccc6c7c29df5205 --run`：选中的 7 项检查全部通过，结果见下方最终复核。

## 最终复核

- `git diff --check`：通过。
- 最终完整检查：Cloudflare 测试 190/190、治理校验、工作流回归 35/35、CLI 测试 54/54、CLI typecheck/build 全部通过；lint 覆盖 193 个脚本、29 个 JSON 文件、177 个 Markdown 文件。
- 最终复核后仅将本节的结果写入记录；再运行 `node scripts/agent/lint.mjs` 和 `git diff --check`，确认证据页变更未引入格式或链接问题。

## 继续工作

- 本次只交付本地可审查文件；提交、推送或合并需要单独授权。
- 本地 `main` 在验收时比本地记录的 `origin/main` 落后 6 个提交；不能把本记录解释为主干已同步或已部署。
- 后续客户端版本或配置变化时，按同一问题集复测；不要以本记录永久替代实际接入验收。
