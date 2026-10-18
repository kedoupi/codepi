# Cloudflare 项目级治理规范

本文件是 kdp.cool 仓库全部 Cloudflare 基础设施的规范：环境、命名、域名、密钥、发布、
迁移与退役。资源事实来源是 [cloudflare-resource-registry.md](./cloudflare-resource-registry.md)。
仓库内静态守门由 `node scripts/cloudflare/validate-governance.mjs` 执行（见第 8 节）。

单一账户：所有资源在 Cloudflare 账户 `Kedoupi` 下，不拆分账户；产品边界由独立服务、
数据库与最小发布凭证维护。平台保护是否生效以控制面证据为准。

## 1. 环境模型

项目采用单主干、本地执行发布，常用环境只有 `local` 和 `production`：

| 环境 | 语义 | 数据 | 凭证 |
|---|---|---|---|
| `local` | 开发者本机 | 默认本地 D1；显式联调可连接产品共用的远程业务 D1 | 自动测试用合成配置；联调凭证不入 Git、不输出 |
| `production` | 日常使用与外部集成 | 各产品生产 D1 | Worker/Pages runtime secrets 与 CI 发布凭证分开管理 |

`staging` 已于 2026-10-18 全面退役：仓库内所有 `[env.staging]` 配置、云端 staging
Workers/D1/域名与残留 routes 均已删除（证据见资源登记表）。环境模型收敛为
`local` + `production` 两档；云端联调直接在 production 上以合成数据或显式授权方式
进行，不维护第二套长期环境。守门 fail-closed 拒绝任何 staging 段、staging 主机名或
`-staging` 资源名再次出现。

业务数据不要求环境隔离，这是当前阶段的有意决策：所有数据均为个人测试数据，可重建。
现有开发命令默认本地 D1；接入远程业务数据需显式配置并验证运行方式支持的 binding，
不复制数据来维持第二套业务环境。自动测试使用本地合成数据。共享业务数据不等于共享
认证会话、OAuth 凭证或外部副作用；远程 migration 和批量写入由单一任务负责。

## 2. 资源命名

物理名称规则（静态守门强制）：

- production：`codepi-<service>[-<role>]`（无环境后缀）
- staging 已退役：`codepi-<service>[-<role>]-staging` 命名保留为历史记录，新增即违规
- 临时：`codepi-<service>[-<role>]-pr-<number>`

`service` 是稳定逻辑边界：`www`、`auth`、`gu`、`gzh`、`health`、`desk`、`mcp`。
`role` 只用于独立组件：`api`、`sync`、`assets`、`cache`、`uploads`、`mcp`。

禁止把分支全文、secret、邮箱、用户名、供应商凭证放进资源名。

现有 `codepi-*` production 资源（不带 `-prod` 后缀）是规范合法存量，不为补后缀搬迁
数据。若存量资源名无法满足规则，在登记表登记例外与目标迁移。

## 3. 域名契约

- production：`codepi.app`、`www.codepi.app`、`<service>.codepi.app`；
  `auth.codepi.app` 为 Workers custom domain。
- staging 域名（`staging.codepi.app` 与 `<service>-staging.codepi.app`）已随 staging
  退役全部删除，重新出现即违规。
- 生产 API 默认附着在对应服务的 `/api/*`；没有明确独立 API 边界时不得新增
  `api.codepi.app`。
- PR 默认使用 Pages/Workers provider URL（`*.pages.dev` / `*.workers.dev`），
  不分配 `codepi.app` wildcard host。
- 同一 hostname 不得同时映射到 production 与 staging。

## 4. staging 已退役

2026-10-18 起 staging 不再是平台的一部分：仓库配置、云端 Workers/D1/custom domain、
zone routes 与 DNS 中的 staging 条目均已删除。治理守门会拒绝重新引入任何 staging
named environment、staging 主机名或 `-staging` 资源名。

历史背景：staging 曾以 Pages preview 环境与 Workers named environment 承载，仅含
synthetic fixture；删除不涉及真实业务数据。若未来确需云端联调环境，须作为新的架构
决策重新设计（例如按 PR 的临时 preview Worker），而不是恢复 staging。

## 5. 密钥与数据

- 所有云端 secret 通过 Cloudflare secret store（`wrangler secret put` /
  `wrangler pages secret put`）设置；Git 只声明 required secret 名，禁止提交
  secret 值或真实 `.dev.vars`。
- session/OTP/SSO client-secret registry 只有 production 一套；staging registry 已随
  staging 退役删除。共享业务数据按第 1 节显式联调。
- 数据分级：`public-dns`、`synthetic`、`auth-session-data`、`private-user-data`、
  `private-health-data`、`legacy`、`unknown`。公开首页与私有健康/投资/稿件数据不得
  混入同一数据边界。
- 重构允许重建项目自有凭证：在授权 API 执行环境中生成随机值并配对写入服务端与消费者，
  不要求恢复旧值，不输出或落地。第三方凭证不能用随机值代替。初始化/轮换与日常部署分开，
  轮换时明确旧登录态、外部上传客户端及回退版本的影响。

## 6. 发布路径（本地执行）

2026-10-18 所有者决定：本地检查与审查后通过 PR 合入 `main`，再由获授权的
agent/开发者在本机执行构建、迁移、Cloudflare API 发布和线上验收。
操作入口为 [本地发布操作](local-release.md)，复用各应用的 workspace-locked
Wrangler 和 Health `deploy:api` 脚本，不引入新依赖。用户已授权本次合并与部署时
不重复询问；普通开发任务仍不隐含合并或生产变更权限。

- 发布源必须为干净、已合并且与实时远程 main 一致的 SHA；串行单一发布者，
  每次远程变更前复核源码与 main，拒绝陈旧或并发发布。
- 发布前执行冻结 lockfile 安装、受影响检查、治理与迁移守门，并审查完整差异。
  CI runner 启动故障不再阻塞已完成本地验证的合并/发布；真实检查失败仍必须解决。
- `.github/workflows/deploy-platform.yml` 保留历史文件名，名称改为 Validate platform：
  push(main)、PR 和手动触发都只做验证，无生产 Environment、发布凭证、迁移或部署 job。
  删除自动重跑旧部署的 `retry-health-deploy.yml` 及其脚本，防止意外重放旧版本。
  GitHub Actions 不再是发布入口；不恢复 Pages Git 自动发布。
- 以各服务最后成功发布的 SHA 为基线，检查其后所有提交触及的路径；包括发布失败后的
  revert，不能只看最后提交或 CI 状态。无可信基线、共享依赖变化时扩大应用范围。
  仅文档/验证流程改动不要求重发无业务改动服务，Health API/前端分别登记版本。
- 部署前核对同环境 Auth、精确 callback、D1、service binding、runtime secret 名称、
  routes 和 Cron；禁止复制或轮换生产 secrets 来完成普通发布。现行 Worker/SPA 架构不变。
- 迁移在兼容代码发布前执行，失败停止；Health API 使用现有脚本预检、上传、切流及
  Cron 验证。执行人需记录前一版本以便兼容时回退。
- 每个服务记录实际 source SHA、provider version ID、smoke 结果和时间到
  `deployment-evidence.mjs` JSONL（Git 外），再在资源登记表和任务回填证据。
  无真实 version ID 或 smoke 失败不标成功；登录、提供方授权和数据同步独立验收。
- `production-monitor.yml` 与 `d1-backup.yml` 仍是独立的定时任务，不参与发布。
  Actions 不可用时它们仍可能受阻，本地发布成功不等于自动巡检/备份已恢复。
- 非 main 紧急发布须有明确例外授权和独立记录；本地执行已是正常路径，不再视为
  break-glass，也不要求日后补一条 Actions 部署。

### 发布依赖顺序

Auth migration/deploy/smoke → Web/GU/GZH migrations/deploy/smoke →
Health API migration/deploy/contract smoke → MCP migration/deploy/smoke → Health frontend。
任何 SSO/shared-auth 改动都纳入 Auth、Web、GU、GZH、Health、MCP 的受影响检查与对应
环境发布。

## 7. 迁移与退役

- schema 改动坚持 expand → deploy compatible code → verify → later contract；
  绝不把代码回滚视为数据回滚。Worker rollback 只在数据库 schema 仍向后兼容时执行。
- 旧资源退役条件（全部满足才执行）：替代资源 active、同路径 smoke 通过、
  回滚窗口结束、登记表标记无消费者。
- D1/KV/R2 的数据删除不与计算资源退役绑定；无单独用户授权不得删除任何数据资源。
- `unknown` 资源不得重命名、迁移或删除。
- 域名切换顺序：Pages 间切换先使 Pages custom domain `active`，再切 zone CNAME 到对应
  `*.pages.dev`；Pages → Worker 切换按以下顺序执行：新 Worker version 探针通过、
  当前方案所需 secrets 经授权渠道配置并验证配对（可生成新值）→ 删除 zone 内指向 `*.pages.dev` 的旧 CNAME（Workers
  custom domain 绑定要求 hostname 无冲突记录，必须先移除旧记录）→ 为 Worker 绑定
  custom domain → 探针通过后移除 Pages 项目的 custom domain 绑定（Pages 项目与
  deployment 保留）。只有运行配置仍兼容时，恢复 Pages 绑定与旧 CNAME 才是可用回退；
  已轮换凭证时需同时恢复配对配置或修复新 Worker。除本步骤明确
  授权的迁移 CNAME 删除外，domain pending 时不得删除旧项目或 DNS。切换后按顺序验证：
  匿名首页/登录页 200 或预期 302、Auth health 200 JSON、未登录私有接口 401/302、
  SSO callback 同环境精确匹配、登出、Health `/api/*` 正常且旧 `/mcp`、
  `/oauth/token`、两个 `/.well-known/*` 返回 404 JSON；统一 MCP 域名的发现与
  未授权 `/mcp` challenge 另行验收。正式生产路径不得返回 522。

## 8. 静态守门

`scripts/cloudflare/validate-governance.mjs` 读取全部 Wrangler 配置（web、gu、
gzh、auth、mcp、health-api、health-pages）与登记表，对每个 declared service 强制：

1. production 资源名不含环境后缀且 `ENVIRONMENT` 为 `production`（Health 前端
   纯代理除外：它不得声明 ENVIRONMENT 等 vars）；
2. staging 已退役：任何 `[env.staging]` 段、staging 主机名或 `-staging` 资源名
   出现即违规（fail-closed）；
3. 每个有状态服务恰好声明一个 D1 `DB` binding；重复/冲突的 D1 或 service binding
   即违规；Health 前端不得声明 D1；
4. 每个服务必需的 service binding 必须精确等于约定的 production 目标
   （www/gu/gzh/health-api 的 `AUTH` → `codepi-auth`；health 前端的 `WORKER` →
   `codepi-health-api`，且不得再有 `AUTH`）；
5. Health API 的 `AUTH_ORIGIN`、`FRONTEND_ORIGIN(S)`、`OURA_REDIRECT_URI` 必须是
   精确的 `https://(auth|health).codepi.app` 形态；`ALLOW_DEV_LOGIN="0"`；Health API
   不得声明公网 routes（流量由前端 Worker 经 service binding 转发）；
6. 所有 public hostname 符合第 3 节域名规则；
7. 运行配置引用的 Worker、D1、custom domain 都有登记表 `managed` 记录，
   且 environment 与 resource_type 兼容；
8. `legacy-pending-retirement`、`legacy-preview` 或 `unknown` 项不得被当前运行
   配置引用；
9. 必需声明（Auth custom-domain route、Auth/Health API 的 cron triggers、
   Auth SSO callback registry）缺失即违规；
10. 六个生产 Worker 必须显式开启持久化调用日志和查询串脱敏，避免 OAuth 回跳参数
    进入调用日志。应用日志仍不得自行输出凭证或私人数据。

该守门只读取仓库文件，绝不访问 Cloudflare 或迁移远程数据库。改动任一 Wrangler
配置、`scripts/cloudflare/**`、登记表或本规范时，由 `scripts/agent/check.mjs`
自动选择执行。

## CodePi MCP 首次发布补充（2026-10-18）

`services/mcp/` 是统一入口支撑服务，绑定 `AUTH → codepi-auth` 和
`HEALTH → codepi-health-api#HealthMcp`，不绑定 Health D1。
`mcp.codepi.app` 仅映射 `codepi-mcp`。新服务在登记表中先记为 `planned`；
此状态是代码预留，不能用作已上线证据。只有 MCP 的新 Worker/D1/域名引用允许
这种预留，已有服务的 managed/UUID 校验不放宽。

首发配置省略尚不存在的 D1 ID；发布脚本按精确名称解析或创建 `codepi-mcp`，
在忽略目录生成带真实 UUID 的临时配置，先迁移再部署，且不改已审查源码。
首发后登记真实 UUID、Worker version、源码 SHA 和探针证据。Auth 的
`SSO_CLIENT_SECRET_MCP` 与 MCP 的 `AUTH_CLIENT_SECRET` 单独配对，既有客户端不轮换。
Health API 必须先发布命名 RPC，统一 MCP 后发布；用户决定此版本直接删除旧 Health
MCP 实现，不保留兼容开关。旧授权不迁移，新客户端改连统一入口并重新授权；
Health 历史、既有 migration/旧表与 Oura 授权保留。CI 增加 MCP 检查，本地发布流程增加 MCP 阶段。

## 9. 日常监控与恢复

- `production-monitor.yml` 每 30 分钟执行只读探针，检查统一登录契约、私有 API
  匿名拒绝、旧泄漏入口保持关闭及 Health 自动同步新鲜度。D1 凭证缺失必须使
  定时任务失败；本地排查可显式接受跳过 D1 的结果。
- `d1-backup.yml` 每日导出五个生产 D1；加密格式、14 天 artifact 保留、私钥
  保管及恢复演练遵循 [备份 runbook](cloudflare-backup-restore.md)。
- 两个工作流只在 main 的 production Environment 运行，复用现有生产凭证。
  监控调用只读，但当前使用的 token 仍有发布权限；专用只读 token 尚未单独配置。
- GitHub Actions 失败通知依赖所有者的通知设置；Cloudflare 通知策略配置和日志
  持久化存在，也不等于告警邮件已实际送达。
- 发布治理 job 同时执行脚本回归、迁移追加守门及语法/JSON lint。
  依赖更新由 Dependabot 提 PR，仍经过项目的正常审核和合并流程。
