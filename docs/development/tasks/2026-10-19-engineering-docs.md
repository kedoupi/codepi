# 工程文档与 Agent 规范整理

- 状态：文档整理与本地验证完成，交付入口为 PR #106；主干状态以 PR 合并记录核实。
- 目标：新 Agent 能找到当前架构、目标目录规则、适用 skill、检查入口及剩余任务；
  旧方案不再覆盖现行实现。
- Worktree：`/Users/codepi/.worktrees/kdp.cool/codex/unified-mcp`，
  分支 `codex/engineering-docs`，从原 detached HEAD 保留全部改动建立。
- 起始 SHA：`77705e7d1ed8729316dbfa0dc025006e62fad530`；
  2026-10-19 集成前经 GitHub API 和 `git ls-remote` 核实远程 main 仍为同一 SHA。
- 协调者、唯一写入者、文档契约负责人：当前 Codex 会话；无并行写入。
- 允许修改：根/应用说明、`AGENTS.md`、项目 skills、`docs/`；不修改业务代码、
  依赖、数据库、凭证或云端配置。
- 开始时已有本会话四份文档改动：根 README、统一 MCP 架构、MCP 任务、Ops 任务，
  分别记录 Claude 手机端实际使用和 GitHub 凭证 TODO，全部保留。
- 授权范围：本地整理完成后，用户回复“继续”，本轮继续正常提交、推送、PR 与合并；
  不扩大为凭证配置、数据操作或业务生产发布。

## 调查发现

- `architecture-baseline.md` 与 P1 计划仍把旧工具站、独立 lockfile、Pages 和
  “不引入 workspace/Workers”写成有效约束，缺少明确的替代入口。
- 开发导航、根/局部规则和审查 skill 漏列 MCP、Ops 或 Desk 消费者。
- 共享设计规范仍包含旧 `oura/`、`shared/` 路径、旧域名及六个静态站。
- Agent 工作流的 Web 检查仍列 `build:functions`，当前 manifest 已无此命令。
- 发布/认证说明仍混用 Pages、staging、Actions 自动部署与现行本地发布方式。
- 各轮任务中的阶段性阻塞没有接续索引，容易把已经恢复的 Health 同步或已部署的
  Desk 重新当成未完成实现。

## 处理原则

复用四个 `kdp-*` skill，不增加同义 skill；保留历史文件位置及原始证据。
现行规则、工作流、任务状态各有归属，索引负责指路。不同 Agent 共用同一套规则，
工具入口不复制流程；已授权动作与剩余权限按对话事实记录。

## 已完成

- 新增工程文档总入口和任务索引，区分现行规则、带日期的验收记录及历史方案。
- 校正工程架构与技术栈：四产品、Auth/MCP/Ops 支撑层、八个 Worker 和六个 D1，
  明确数据归属、SSO/提供方/MCP 授权生命周期及 Health named RPC 边界。
- 补齐 Web 局部 AGENTS，更新根、Auth、shared 规则与四个 skill，覆盖 Desk/MCP/Ops。
- 校正实际检查命令、local + production 环境、本地持锁发布及 Actions 仅验证的说明；
  检查范围与发布范围分别引用现有脚本，不另造一份依赖图。
- 给被替代的旧架构、Pages、广告、工具站及阶段性故障记录增加历史标记和接续入口，
  保留原始验证证据；恢复手册改为引用当前 Ops 验收。
- 将旧生产 SSO 验收脚本的退役 Pages 目标记录为后续独立修复项，本轮没有修改或执行
  该脚本。保留 GitHub 凭证、告警送达和恢复演练等尚未完成的运维事项。

## 验证与交付

- `git diff --check` 通过。
- 从上述 worktree 执行
  `node scripts/agent/check.mjs --base 77705e7d1ed8729316dbfa0dc025006e62fad530 --run`：
  **2/2** 选定检查通过，包含工作流回归 **25/25**、119 个脚本与 18 份 JSON lint。
  本批 40 个文件均为文档/规则，不触发业务应用构建。
- 一次性只读脚本核对 43 份变更文档与共享/Claude skill 文件中的 225 个本地链接
  （含 8 个 heading anchor），以及 8 份 skill frontmatter，均通过。
- 用现有脚本抽查检查/发布映射：SSO 覆盖全部应用和八个 Worker；Health API 覆盖
  Health/MCP 检查和 API/MCP 发布；本轮文档改动无业务 Worker 发布范围。断言通过。
- 当前实现者完成完整差异自审；未另起独立审查 Agent。本轮未启动其他编码 CLI
  验收自动加载，未复测生产、真实邮件、OAuth 或其他 AI 客户端。
- 上述证据来自 2026-10-19 的本地静态检查、合成回归和人工核对。Claude 手机端的使用
  确认沿用用户反馈；生产状态沿用带日期的既有任务证据，没有冒充本轮实时探针。

## 交付文件

交付绑定上述 worktree、基线和下列 40 个文件；包含开工前保留的四份文档改动。
`apps/web/AGENTS.md`、`docs/README.md`、本任务记录与任务索引是新增文件，其余为修改。
PR 的完整差异为固定审查范围，提交和最终合并版本以实际 Git/PR 记录为准；
检查通过不单独证明已经进入 main。

```text
.agents/skills/kdp-dev/SKILL.md
.agents/skills/kdp-handoff/SKILL.md
.agents/skills/kdp-release/SKILL.md
.agents/skills/kdp-review/SKILL.md
.claude/skills/kdp-dev/SKILL.md
AGENTS.md
README.md
apps/gu/README.md
apps/gzh/README.md
apps/health/README.md
apps/web/AGENTS.md
apps/web/README.md
docs/README.md
docs/architecture/adsense-review-hardening-record.md
docs/architecture/architecture-baseline.md
docs/architecture/p1-implementation-plan.md
docs/architecture/personal-design-system.md
docs/architecture/phase1-delivery-record.md
docs/architecture/product-apps-monorepo-migration.md
docs/architecture/unified-mcp.md
docs/architecture/wechat-desk-unification.md
docs/architecture/workspace-and-deployment.md
docs/development/README.md
docs/development/agent-compatibility.md
docs/development/agent-workflow.md
docs/development/cloudflare-backup-restore.md
docs/development/integration-release.md
docs/development/local-release.md
docs/development/tasks/2026-10-18-platform-reliability.md
docs/development/tasks/2026-10-18-unified-mcp.md
docs/development/tasks/2026-10-19-cloudflare-operations.md
docs/development/tasks/2026-10-19-engineering-docs.md
docs/development/tasks/2026-10-19-mcp-operations.md
docs/development/tasks/README.md
docs/development/tasks/p6-personal-desk.md
docs/superpowers/plans/2026-10-15-personal-digital-space-roadmap.md
packages/shared/AGENTS.md
packages/shared/auth/README.md
services/auth/AGENTS.md
services/auth/README.md
```

## 继续工作

本轮按用户的“继续”进入正常集成流程，已提交并推送完整整理提交
`167ad52e1b09c15abff277f4f1a416496b709507`，通过 GitHub API 创建
[PR #106](https://github.com/kedoupi/kdp.cool/pull/106)。此后只回填本任务和索引的交付记录；
最终 PR head、合并 SHA 和时间由 PR 记录保留，避免文档引用尚不存在的自身提交。
提交前已重新执行上述 2/2 检查；相对实时 main 无额外组合差异。

按仓库已记录的七个 Worker 发布基线 `67f13bb85e7e287074190481487cdd64ed162451`
与 Ops 发布基线 `da3324db27bf3562cf5515237f1f5b6dfe197488` 累计核对改动，
各服务待发布范围均为空。本轮没有重新查询生产控制面，也没有执行部署或迁移。

合并后，新任务使用包含规范的 main 基线；
其他在途 worktree 先保护改动，再按授权同步所需版本，不假定它们自动获得更新。
文档更新本身不要求重新发布业务 Worker，累积发布范围仍需按各服务上次成功发布
SHA 判断。

Ops GitHub 运行凭证继续等待所有者方便时配置；其他剩余项由任务索引接续，不把它们
附带进本次文档整理或要求用户重复已完成的 MCP 连接。
