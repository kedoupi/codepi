# 工程流程简化

- 状态：已实施、合并并通过本地验证
- 目标：减少普通开发的规则、命令和文档负担，同时保留跨应用、认证、迁移和发布的完整验证边界。
- 范围：工作流文档、检查器、声明式影响配置、根命令和任务导航；不修改业务实现、生产资源或既有 Blog/CLI 诊断文件。
- 基线：`c7217a1305dabff9d280ecba4ccc6c7c29df5205`（接续已有工作流整理）；本轮实际 HEAD 起点为 `13ceea88666fe32448878aaf2193a7a3b1cefc8c`。
- worktree：`/Users/codepi/Coding/codepi` / `main`；保留已有未提交改动。

## 实施

- 普通开发默认 `pnpm check`，不再要求每个任务先运行 `task:base`；完整任务、全仓和显式基线检查继续可用。
- 新增 `scripts/agent/check-plan.mjs`，集中维护应用命令、quick/full 分层、跨服务消费者、治理和文档映射。
- 所有应用命令统一为根目录 `pnpm --filter <package> <script>`；检查器最多四路并行执行，同包的构建产物检查等待构建成功，并汇总所有失败。
- 新增 `check:quick`、`check:full`、`check:task`、`check:all`；兼容 `check:run` 与显式 `--base`。
- 日常开发文档从 166 行压缩到 56 行；任务索引只列当前事项，已完成证据通过年度档案导航查找，不移动历史文件或破坏链接。

## 验证

- 合并前 `node --test scripts/agent/check.test.mjs scripts/agent/task-base.test.mjs`：23 项通过；`pnpm check`：24 项快速检查通过；`pnpm check:task`：41 项完整检查通过。
- 合并 `origin/main` 后的完整检查发现 Web `test:assets` 早于构建读取产物；已声明构建依赖并补充执行顺序、失败阻断测试。
- 合并后 `node --test scripts/agent/check.test.mjs`：19 项通过；`node scripts/agent/lint.mjs`：196 个脚本、29 个 JSON、181 个 Markdown 通过；`git diff --check` 通过。
- 合并后 `node scripts/agent/check.mjs --base 13ceea88666fe32448878aaf2193a7a3b1cefc8c --run`：41 项完整检查通过，含全部构建、资产、Health/MCP 浏览器、Ops 原生 runtime、shared Auth 11 项。
- 真实 OAuth、生产数据、远程发布不在本次范围。

## 边界

- 已按明确要求提交并合并 `origin/main`；没有推送、发布、迁移或远程资源操作。
- 既有 `docs/development/cloudflare-resource-registry.md`、Blog 任务和 `packages/cli/blogdiag.mjs`、`bloglegacy.mjs` 不是本轮实现内容，但会纳入真实变更集检查。
