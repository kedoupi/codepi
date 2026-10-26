# 工程架构与部署模型

本文档记录 kedoupi（codepi）个人数字空间的工程架构和部署决策。
2026-10-16 起生效，替代此前的多环境双分支方案；2026-10-20 起按当前源码补齐 MCP 领域扩展、
Project/Me 与 CLI，后续 Blog 与 Ops v4 变化见任务记录。本文描述当前实现与配置；
日期化发布证据、运行时状态和剩余验收见[任务索引](../development/tasks/README.md)，
不由本文或本地配置推定实时线上状态。
本文是现行架构入口，旧 `architecture-baseline.md` 是历史记录。

## 工程结构

单一仓库，统一 pnpm workspace。产品目录、独立支撑服务和共享层：

```
codepi/
├── apps/
│   ├── web/      → 首页 + Desk（Astro）
│   ├── gu/       → 投资工作台（Svelte + Vite + Hono）
│   ├── gzh/      → 公众号工作台（Svelte + Vite + Hono）
│   ├── project/  → 项目卡与任务交接（Svelte + Vite + Hono）
│   ├── me/       → 记忆确认区、背景与经历（Svelte + Vite + Hono）
│   └── health/   → Health（Svelte + Vite，前端 Worker + Hono API）
├── services/
│   ├── auth/     → 统一登录 Worker
│   ├── mcp/      → CodePi 统一 MCP（逐工具授权、领域 RPC）
│   └── ops/      → 私有 Cron/Workflows 巡检与加密备份
├── packages/
│   ├── cli/      → 官方 MCP SDK 客户端、跨 Agent 项目交接
│   └── shared/   → 共享契约、样式、认证客户端、邮件模板
├── scripts/      → Agent 检查与 Cloudflare 治理
└── docs/         → 架构与流程文档
```

### 为什么统一 workspace

解决的问题：

1. **依赖版本不统一**。四个应用各自管理 lockfile，同一包（如 wrangler、esbuild）
   可能出现不同版本，导致行为和构建结果不一致。
2. **共享代码引用脆弱**。`shared/` 没有包管理，各应用用相对路径直接引用源码，
   移动文件或增加层级就会导致难以发现的构建失败。
3. **安装和构建入口分散**。每个应用有自己的 npm/pnpm 安装方式，新 Agent 或
   CI 需要分别理解每个应用的安装要求。
4. **交叉测试依赖 hack**。Web 的 Desk 集成测试需要安装 Auth、GU、GZH、Health
   的依赖，在 CI 里用 `npm --prefix ../auth ci` 等命令逐个安装，维护成本高。

统一后：根目录一次 `pnpm install --frozen-lockfile` 安装所有依赖，lockfile 只有一个。
共享源码已统一通过 `@kedoupi/shared/<subpath>` 导入，各消费包声明
`@kedoupi/shared: workspace:*`。共享包使用严格 `exports` 白名单，没有 `./*` 兜底；
新增公共模块需要显式登记。schema 读取、Tailwind content 扫描等文件系统路径不属于
模块导入，仍使用文件路径。同一依赖的版本范围仍由各 package.json 声明。

### 共享原则

- `packages/shared/` 只放跨应用契约：auth client、desk contract、样式 tokens、
  品牌信息、邮件模板和内部 MCP RPC 类型。业务逻辑留在各产品目录。
- 共享包不依赖应用源码。依赖方向是 app/service → packages/shared；
  Ops 还复用 `scripts/cloudflare/` 中的运维实现，不复制另一套备份格式或巡检断言。
- `apps/health/shared/` 是 Health 内部共享（日期工具等），不进 `packages/shared/`。

2026-10-18 起 Health 应用目录统一为 `apps/health/`，workspace 包使用 `health-kdp`、
`@health-kdp/web` 与 `@health-kdp/api`。Oura 是数据提供方；提供方协议与现有会话标识
不随应用目录改名。此前任务记录中的旧目录和包名表示当时的实际路径，见
[命名调整记录](../development/tasks/2026-10-18-health-naming.md)。

### 运行时与数据归属

| 单元 | 拥有的数据 / 职责 | 跨服务调用 |
| --- | --- | --- |
| Web / Desk | 公开静态内容；独立 Desk D1 只存网站登录状态 | AUTH Service Binding；三应用摘要通过固定 HTTP 地址和独立摘要凭证读取 |
| GU / GZH | 各自业务 D1、网站登录状态和业务逻辑 | AUTH Service Binding；受保护的 Desk 摘要；GU 另有只读 `GuMcp` 与 `GuMaterialsBackup` |
| Health 前端 Worker | 静态资产和 `/api/*` 代理，无业务 D1 / AUTH / Oura 凭证 | WORKER Service Binding → Health API |
| Health API | Health D1、Oura 授权、同步、查询和统计 | AUTH Service Binding；`HealthMcp` named RPC 供 MCP 调用 |
| Auth | 中央身份、OTP 和网站会话 D1 | 客户端以 shared/auth/clients.ts 为准 |
| Project / Me | 各自业务 D1；Me 的导入原文存独立私有 R2 | AUTH Service Binding；仅向 MCP/Ops 提供明确的 named RPC |
| MCP | 独立 D1 保存网站会话与 AI 客户端 grants/tokens，管理协议与工具目录 | AUTH Service Binding；Health/Project/Me/GU/Blog named RPC；不直接绑定业务库或原件 |
| Ops | 无业务 D1、无公网入口；私有 R2 保存密文和运维元数据 | 经受限 Cloudflare API 导出九库；经 GU/Me/Blog named RPC 只读原件；GitHub API 仅用于版本监控/通知，不复制备份密文 |

Health 前后端独立部署；各应用各自拥有 D1，统一 workspace 不等于合库。
Project/Me、Blog 与 CLI 的新增边界见[领域扩展](mcp-domains.md)和任务记录；资源登记区分
日期化快照与实时控制面。
网站 SSO、Oura 授权和 AI 客户端授权保持各自生命周期，不能相互替代或透传 token。
具体域名、资源 ID 与部署证据由根 README、任务记录和资源登记表维护，不在本表复制。

GU 线上工作台第一阶段已于 2026-10-19 经 PR #107 发布：账户、交易、规则与报告以 GU D1 的确认版本为准，
原件由 GU 经鉴权访问独立私有 R2；首次确认前可预览旧快照，启用后旧上传不能覆盖账户。
业务逻辑仍归 GU，不抽到 MCP 或共享层。私有 R2 与 GU → Ops 原件备份 binding 已核验，
真实投资资料现已迁入 revision 1，外部本机目录保留为迁移来源；
2026-10-20 已通过真实 GU D1 与 112 份非空资料的隔离恢复和鉴权下载验收。
六库与 GU 原件的 GitHub 跨平台复制是 2026-10-20 的历史验收记录，不是当前自动备份链路。
当前 v4 标准以私有 R2 完整清单、回执及九库、GU/Me/Blog 三组原件为准；实际跨账户灾备与新的
生产隔离恢复须另行授权和核验。证据见 [Cloudflare 定时运维](../development/cloudflare-operations.md)
与[备份恢复 runbook](../development/cloudflare-backup-restore.md)。

## 部署模型

### 单主干、本地发布

- `main` 是唯一长期分支。功能在短期任务分支开发，通过 PR 合入。
- 本地检查与审查完成后合入 `main`，再由本机发布受影响应用；GitHub Actions 只做附加验证。
- 整条生产发布由一个协调者串行执行；按各服务最近成功发布之后所有提交触及的
  路径决定应用范围，覆盖连续合并和失败后的回退。仅文档且无积压改动时不部署应用。
- 不要求每次发布前经过 staging 验收。

### 环境

| 环境 | 用途 | 数据 |
|---|---|---|
| 本地 | 开发、调试、测试 | 本地 D1 / remote bindings 连远程 D1 |
| 生产 | 日常使用 | 生产 D1 |

业务数据不要求按环境隔离。所有数据是个人测试数据，可重建。
当前本地配置默认使用 Wrangler 本地 D1；共享远程业务数据是允许的联调方式，
不是已有配置自动实现的行为。需要时单独配置所用运行方式支持的 remote binding，
明确目标数据库，并将 schema migration 和批量写入集中安排。自动测试仍用本地合成数据。

### staging 的定位

2026-10-18 staging 已全面退役，仓库配置与云端资源均已移除，具体证据见资源登记表。
统一登录和 MCP 等联调先做本地合成数据验收，再做明确授权的生产集成验收。
不维护长期 staging 分支、域名或第二套业务数据。

### 故障处理

接受短暂线上中断。发现问题后：
1. 修复代码并提交新 PR 合入，再从合并后的 main 本地发布修复版本
2. 或回退到上一个可用版本

数据库变更（migration）需要保持向后兼容——旧代码回滚不等于数据库回滚。

### 重构期间的存量处理

2026-10-17 用户确认：当前版本尚处于重构和个人测试阶段，以最终架构为准，不以保留
旧测试数据、登录态或旧实现为迁移条件。自有内部凭证可以生成新值并同步更新消费者，
无需找回旧 secret；日常发布不轮换凭证。生产启用统一登录时，不再为旧 OTP
方案配置无用密钥。第三方授权和资源标识按各自接入流程处理，未接入须明确显示未连接。
可重建不代表每次发布清库，也不将业务数据删除、第三方 token 轮换附带在普通发布中。

## Agent 开发模式

### 基本原则

- 一个独立写入任务对应一个 worktree；短期分支和明确 SHA 的 detached HEAD 均可，
  不为加载规范擅自切换或重置在途任务。
- 不同 CLI 工具、同一工具的不同窗口可以并行开发不同任务。
- 换工具继续同一个任务时，接手原来的 worktree。
- PR 是统一的集成入口，默认 squash merge。

### 审查与合并

- Agent 实现，多 Agent 审查，用户负责 UI/交互验收。
- 审查重点：功能边界、跨应用影响、验证缺口。
- 合并条件：所有审查无阻塞问题 + 用户确认。
- 合并后按已授权范围在本机发布，不重复索取已获得的部署授权。
- GitHub 平台强制规则需要独立核验。2026-10-16 rulesets API 返回私有仓库套餐限制，
  本地 GitHub CLI 凭证也已失效；当前不能声称 PR、审批或禁止直推已由平台强制执行。
  不为启用规则将仓库改为公开。仓库内检查与人工合并约定仍照常执行。

### 并行开发注意事项

- 应用间业务开发可以并行；共享接口（Auth、shared、Health/MCP RPC）与 CI 由一个任务负责。
- worktree 不隔离端口、浏览器会话和远程数据；并行任务分配独立端口。
- 共享数据库的结构迁移和批量操作集中安排，避免多任务并发修改。

## 技术栈方向

当前源码技术栈（部署与验收使用日期化任务证据，不由此推定）：

| 应用 | 前端 | 服务端 | 包管理 |
|---|---|---|---|
| web | Astro 6 + Tailwind v3 | TypeScript Worker（Workers Static Assets + Desk） | pnpm workspace |
| gu | Svelte 5 + Vite | Hono Worker（Workers Static Assets） | pnpm workspace |
| gzh | Svelte 5 + Vite | Hono Worker（Workers Static Assets） | pnpm workspace |
| health | Svelte 5 + Vite | 前端资产/代理 Worker + Hono API Worker | pnpm workspace |
| project / me | Svelte 5 + Vite | Hono Worker（Workers Static Assets）+ 独立 D1；Me 使用私有 R2 | pnpm workspace |
| auth | — | Hono Worker | pnpm workspace |
| mcp | 授权与连接管理页 | TypeScript Worker + 官方 MCP SDK + 独立 D1 | pnpm workspace |
| ops | 无 | JavaScript ESM Worker + Cron/Workflows + R2；复用 Node 运维模块 | pnpm workspace |
| cli | 终端命令 | Node.js + 官方 MCP SDK，OAuth 凭证仅在本机 | pnpm workspace |

维护方向：

- 私有应用统一使用 Svelte + Vite，业务 HTTP API 与 Auth 使用 TypeScript + Hono
- Web 的 Desk handler、MCP SDK transport、Ops Workflows 保持各自必要的运行模型，
  不为形式统一额外包一层 Hono 或重写已复用的 JavaScript 运维模块
- 已有 SSO 和 Health MCP 使用 Service Binding；Desk 摘要仍用固定 HTTP 接口，
  迁移需单独确定收益、契约与验收，不能描述为已全面使用 binding
- 不引入 Turborepo/Nx、ORM、SSR 全栈框架、完整组件库

GU 服务端路由和 Svelte 前端已分批迁移；业务接口在路由迁移中保持不变。实施与验收状态见 [GU Hono 迁移记录](../development/tasks/2026-10-17-gu-hono-router.md)。三个私有应用前端已统一到 Svelte 5 + Vite（GU、GZH 迁移验收分别见 `2026-10-17-gu-svelte-frontend.md`、`2026-10-17-gzh-svelte-frontend.md`）；Health API 与 Auth 服务端已迁 Hono（验收分别见 `2026-10-17-health-hono-api.md`、[Auth Hono 迁移记录](../development/tasks/2026-10-17-auth-hono.md)）。

部署载体已统一为 Workers Static Assets：GU、GZH（2026-10-17，`run_worker_first = true`，全部请求先进 Hono 鉴权链）、首页/Desk（2026-10-17，公开资产直出，`/api/*` 与 `/desk` 优先进入 Worker）与 Health 前端（2026-10-18，SPA + WORKER service binding 转发 API，前端不持有 DB/AUTH/Oura 等业务配置，仅由发布脚本注入 `BUILD_SHA` 元数据）均已切换正式域名，旧 Pages 项目全部删除。staging 环境同步于 2026-10-18 全面退役（仓库配置与云端资源均已删除），环境模型收敛为 local + production。实施与切换验收见 [GU](../development/tasks/2026-10-17-gu-static-assets.md)、[GZH](../development/tasks/2026-10-17-gzh-static-assets.md)、[首页](../development/tasks/2026-10-17-web-static-assets.md) 迁移记录及资源登记表。

统一 CodePi MCP 的传输、授权与工具注册位于 `services/mcp/`，领域查询和写入仍由各所属应用持有。
MCP 通过 Health、Project、Me、GU 与 Blog 的 named RPC 调用，不直接绑定业务 D1/R2；
AI 写入 Me 只进入待确认区，GU 只读线上工作区，Blog 发布仍受 owner 审核。
见[统一 MCP 架构](unified-mcp.md)与[领域扩展契约](mcp-domains.md)。

Ops 的调度、凭证、流式备份与恢复边界见[定时运维](../development/cloudflare-operations.md)。
实现可用不等于所有远程依赖已配置，当前待办以任务证据为准。
