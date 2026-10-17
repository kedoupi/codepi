# 工程架构与部署模型

本文档记录 kedoupi（codepi）个人数字空间的工程架构和部署决策。
2026-10-16 起生效，替代此前的多环境双分支方案。

## 工程结构

单一仓库，统一 pnpm workspace。四个产品和两个支撑层：

```
kdp.cool/
├── apps/
│   ├── web/      → 首页 + Desk（Astro）
│   ├── gu/       → 投资工作台（Vite + Worker）
│   ├── gzh/      → 公众号工作台（Vite + Worker）
│   └── oura/     → Health（Svelte + Workers）
├── services/
│   └── auth/     → 统一登录 Worker
├── packages/
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
  品牌信息、邮件模板。业务逻辑留在各产品目录。
- 共享包不依赖应用源码。依赖方向永远是 app → packages/shared。
- `apps/oura/shared/` 是 Health 内部共享（日期工具等），不进 `packages/shared/`。

## 部署模型

### 单主干自动发布

- `main` 是唯一长期分支。功能在短期任务分支开发，通过 PR 合入。
- 合入 `main` 后 GitHub Actions 自动发布受影响的应用。
- 整条生产发布串行执行；每次 main 更新都会触发检查，按最近成功发布之后所有提交触及的
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

staging 资源（wrangler named environment、staging D1、staging secrets）作为旧配置保留，
目前未接入发布 workflow，也不是发布的必经路径。保留资源不代表 staging 已可用。
需要云端联调（统一登录改造、MCP 客户端连接、跨应用调用验证）时再落实临时发布入口、
域名与认证配置；不创建长期 staging Git 分支。旧 preview 数据库继续隔离以避免意外写入，
不代表日常流程要求维护第二套业务数据。

### 故障处理

接受短暂线上中断。发现问题后：
1. 修复代码并提交新 PR 合入（自动发布修复版本）
2. 或回退到上一个可用版本

数据库变更（migration）需要保持向后兼容——旧代码回滚不等于数据库回滚。

## Agent 开发模式

### 基本原则

- 一个独立写入任务对应一个短期分支和一个 worktree。
- 不同 CLI 工具、同一工具的不同窗口可以并行开发不同任务。
- 换工具继续同一个任务时，接手原来的 worktree。
- PR 是统一的集成入口，默认 squash merge。

### 审查与合并

- Agent 实现，多 Agent 审查，用户负责 UI/交互验收。
- 审查重点：功能边界、跨应用影响、验证缺口。
- 合并条件：所有审查无阻塞问题 + 用户确认。
- 合并后自动发布，不需要额外审批。
- GitHub 平台强制规则需要独立核验。2026-10-16 rulesets API 返回私有仓库套餐限制，
  本地 GitHub CLI 凭证也已失效；当前不能声称 PR、审批或禁止直推已由平台强制执行。
  不为启用规则将仓库改为公开。仓库内检查与人工合并约定仍照常执行。

### 并行开发注意事项

- 应用间业务开发可以并行；共享接口（auth、shared）由一个任务负责。
- worktree 不隔离端口、浏览器会话和远程数据；并行任务分配独立端口。
- 共享数据库的结构迁移和批量操作集中安排，避免多任务并发修改。

## 技术栈方向

当前状态（2026-10-17）：

| 应用 | 前端 | 服务端 | 包管理 |
|---|---|---|---|
| web | Astro 6 + Tailwind v3 | Pages Functions (desk) | pnpm workspace |
| gu | Svelte 5 + Vite | Hono Worker（Workers Static Assets） | pnpm workspace |
| gzh | Svelte 5 + Vite | Hono Worker（Pages bundle） | pnpm workspace |
| oura | Svelte 5 + Vite | Hono Worker | pnpm workspace |
| auth | — | Hono Worker | pnpm workspace |

目标方向（逐步迁移，不强制时间表）：

- 私有应用前端逐步统一 Svelte + Vite
- 服务端统一 TypeScript + Hono + Cloudflare Workers
- 内部调用逐步迁移到 Service Binding
- 不引入 Turborepo/Nx、ORM、SSR 全栈框架、完整组件库

GU 先迁移服务端路由，再独立迁移 Svelte 前端；业务接口和部署载体在路由迁移中保持不变。实施与验收状态见 [GU Hono 迁移记录](../development/tasks/2026-10-17-gu-hono-router.md)。三个私有应用前端已统一到 Svelte 5 + Vite（GU、GZH 迁移验收分别见 `2026-10-17-gu-svelte-frontend.md`、`2026-10-17-gzh-svelte-frontend.md`）；Health API 与 Auth 服务端已迁 Hono（验收分别见 `2026-10-17-health-hono-api.md`、[Auth Hono 迁移记录](../development/tasks/2026-10-17-auth-hono.md)）。

部署载体统一按 GU → GZH → 首页/Desk → Health 的顺序推进：GU 已迁移为 Workers Static Assets 架构的 Worker（`run_worker_first = true`，全部请求先进 Hono 鉴权链；staging 从 Pages preview 环境迁移为 named environment `codepi-gu-staging`，保留未启用），实施与切换验收见 [GU Static Assets 迁移记录](../development/tasks/2026-10-17-gu-static-assets.md)。GZH、首页/Desk、Health 仍部署在 Pages，按同样方式逐个评估迁移：先核实 Worker 与静态文件的请求顺序、运行时 secrets 的安全来源、现有 Service Binding 和域名切换/回退步骤，每个产品独立验证后再切换。
