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

`service` 是稳定逻辑边界：`www`、`auth`、`gu`、`gzh`、`health`、`desk`、`mcp`、`ops`、`project`、`me`、`blog`。
`role` 只用于独立组件：`api`、`sync`、`assets`、`cache`、`uploads`、`imports`、`mcp`、`backups`。

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
- MCP 的双端 SSO secret 使用 `scripts/cloudflare/pair-mcp-secret.mjs --rotate`
  一次生成并配对，通过运行时 readiness 验收；只在获授权的初始化/轮换时运行，
  不再把分别手填两端作为正常流程。跨 Worker 更新并非原子操作，部分失败必须中止发布。

### 回滚写权限隔离与观察报告边界

回滚是独立高风险能力：必须使用专用 secret `CLOUDFLARE_ROLLBACK_TOKEN` 和独立 token，最小权限仅 `Workers Scripts Write`；由 `node scripts/cloudflare/provision-ops.mjs rollback-credential` 创建。现有 `CLOUDFLARE_API_TOKEN` 的权限与用途不变，不得被回滚脚本复用。`rollback-worker.mjs` 禁止 force，只接受回滚前已核对的 expected active version、单一 100% 流量版本，并在 percentage deployment 后重新读取校验。

release manifest 的 `rollback_allowed` 必须由 schema/迁移、secret、binding 和 external side effect 字段及 previous version 自动推导。任一 migration、secret、binding 或外部副作用变更，或缺少 previous version，均自动阻断回滚；文档、调用者和人工通知不得覆盖该结果。

Observer 报告属于私有运维元数据：仅允许 release/version 身份、服务名、轮询指标、基线比较、severity、状态、事件 ID 和脱敏错误摘要。不得包含任何 token/secret 值、私钥、SQL、请求 query、业务正文、健康/财务/稿件内容或可恢复会话数据；R2 报告沿用运维桶的私有访问和生命周期边界。

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
- 登记的 Worker 的活跃版本均须带 `BUILD_SHA`。普通 Worker 通过
  `scripts/cloudflare/deploy-worker.mjs` 注入，Health API/MCP 由专用脚本注入；
  Health 前端允许这一构建元数据，但不恢复业务 vars。MCP deploy 自动执行配对和匿名
  契约 smoke，失败不能进入下一发布阶段。
- 自动巡检与备份由 `services/ops` 的 Cron/Workflows 调度；原两条 Actions 只保留
  手动应急入口。真实实例、R2 完整备份和跨平台回执分别验收，见[定时运维](cloudflare-operations.md)。
- 非 main 紧急发布须有明确例外授权和独立记录；本地执行已是正常路径，不再视为
  break-glass，也不要求日后补一条 Actions 部署。

### 发布依赖顺序

Auth migration/deploy/smoke → 受影响的 Web/GU/GZH/Project/Me
migrations/deploy/smoke → Health API migration/deploy/contract smoke →
MCP migration/deploy/smoke → Health frontend / Ops。Project/Me 首次上传先于各自 secret
配对；配对与 readiness 成功之前不进入 MCP/Ops 阶段，具体顺序见本地发布操作。
任何 SSO/shared-auth 改动都按 shared/auth/clients.ts 纳入全部消费者的受影响检查与对应
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
gzh、auth、mcp、ops、health-api、health-pages）与登记表，对每个 declared service 强制：

1. production 资源名不含环境后缀且 `ENVIRONMENT` 为 `production`（Health 前端
   纯代理除外：它不得声明 ENVIRONMENT 等业务 vars，仅发布时注入 BUILD_SHA 元数据）；
2. staging 已退役：任何 `[env.staging]` 段、staging 主机名或 `-staging` 资源名
   出现即违规（fail-closed）；
3. 每个有状态服务恰好声明一个 D1 `DB` binding；`www` 是唯一例外，必须精确声明
   `DB → codepi-desk` 与 `BLOG → codepi-blog` 两个 name-pinned D1 bindings；重复/冲突的
   D1 或 service binding 即违规；Health 前端不得声明 D1；
4. 每个服务必需的 service binding 必须精确等于约定的 production 目标
   （www/gu/gzh/health-api 的 `AUTH` → `codepi-auth`；mcp 的 `BLOG` →
   `codepi-www#BlogMcp`；health 前端的 `WORKER` →
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
10. 登记的生产 Worker 必须显式开启持久化调用日志和查询串脱敏，避免 OAuth 回跳参数
    进入调用日志。应用日志仍不得自行输出凭证或私人数据。
11. Ops 必须关闭公网入口，仅声明约定的两个 Cron、独立 R2、Workflow 与
    `GU → codepi-gu#GuMaterialsBackup`、`ME → codepi-me#MeImportsBackup`、
    `BLOG → codepi-www#BlogMediaBackup` 三个只读原件能力；任一 binding 缺失、目标错误、
    entrypoint 缺失或错误均违规。不得新增业务 D1、Auth、业务 R2 或其他 service binding。
12. GU 资料仅允许 `MATERIALS → codepi-gu-uploads`，Me 原文仅允许
    `IMPORTS → codepi-me-imports`，博客媒体仅允许 `BLOG_MEDIA → codepi-blog-uploads`，
    三者都不与备份桶共用。
13. Durable Object 目前不在上述自动校验范围内。新增 DO 必须先在资源登记表写明
    planned/managed 状态、binding 和 migration；MCP 的 `LegacySse` 已于 PR #195 发布并核对 namespace。
    GU 上传桶、Me 导入桶和博客媒体桶的首次登记允许 `planned`，不放宽对应 Worker/D1 校验；
    发布前需创建并核验无公开域名、无公开 r2.dev 入口。静态配置不证明存储已就绪。
    原件元数据随各自 D1 备份，原件字节单独加密；全部已登记 D1 与原件均成功才有完整回执，
    恢复到隔离 D1/R2 后核对读取，不能以 D1 导出代替原件验收。

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

- `services/ops` 的私有 Cron/Workflows 每 30 分钟巡检，UTC 18:00 导出备份清单中的全部 D1；
  失败步骤最多重试两次，不重新执行已成功的库。旧 Actions 仅保留手动应急入口。
- 必需备份数据库由 `scripts/cloudflare/backup-core.mjs` 的 `DATABASE_NAMES` 唯一维护，
  当前包含 `codepi-blog`；所有库均须进入加密日备与恢复覆盖。
- 巡检共用本地 HTTP/SSO/MCP/Health 断言，通过 GitHub API 对照登记的 Worker 的活跃
  `BUILD_SHA` 和逐提交历史；文档或无关应用更新不报警。历史缺失、分流、凭证缺失
  和备份过期均失败，不降低既有 30 小时门槛。
- Ops 不绑定业务 D1/Auth，不开放公网 URL；绑定独立私有 R2、自身 Workflow 与
  精确的 GU、Me、博客只读原件 RPC，不直接绑定业务 bucket，不增加需要两侧同步的 secret。
  专用账户 token 仅有 D1 Write（导出要求）、Workers Scripts Read 与 Zone Analytics Read；
  后者只用于 `codepi.app` zone 的 GraphQL Analytics 查询。R2 使用 binding。
- 备份在内存中公钥加密，R2 按前缀保留 14 天；Cloudflare 之外的密文经 GitHub API
  存私有 Release，独立记录回执。没有 GitHub 凭证时保留 R2 副本，跨平台状态失败。
  不把同账户 R2 当成异地恢复保障。格式、私钥及恢复演练见[备份 runbook](cloudflare-backup-restore.md)。
- 原件清单在 D1 导出后冻结，只包含追加式资料索引；每件核对大小和 SHA-256，
  缺失或损坏使本次完整备份失败。单件 8 MiB、每次最多 1000 件，超过明确失败；
  不得截断清单并称成功。扩大上限或增加资料删除/改写须同步验证恢复一致性。
- Workflow 保存非敏感报告并保持失败；Cron 检查上一份报告的失败和停滞，以调用错误
  触发现有 Issues 通知。策略启用、日志存在和实际邮件送达分别验收。
- 发布治理执行脚本回归、迁移追加守门及语法/JSON lint；CI 增加 Ops 单测与真实本地
  Workflows/R2 合成执行。依赖更新仍由 Dependabot 提 PR 后正常审核。

操作、凭证初始化和运行边界见[定时运维](cloudflare-operations.md)。

## 2026-10-20 领域扩展配置

本地实现新增 `codepi-project`、`codepi-me` Worker/D1、对应 custom domain，以及
私有 `codepi-me-imports` R2。仅这些明确的新资源允许 planned 状态与未填 D1 UUID；
既有 managed 资源校验不放宽。planned 是待创建，不是已上线证据。

MCP 增加 `PROJECT -> codepi-project#ProjectMcp`、`ME -> codepi-me#MeMcp`、
`GU -> codepi-gu#GuMcp`；Ops 增加 `ME -> codepi-me#MeImportsBackup`，与原
`GU -> codepi-gu#GuMaterialsBackup` 同为只读原件能力。博客媒体另增计划中的
`BLOG -> codepi-www#BlogMediaBackup` 与 `BLOG_MEDIA -> codepi-blog-uploads`。
第 8 节旧的“仅 GU”限制由此精确扩展，仍禁止 Ops 直接绑定业务 D1、Auth、业务 R2
或其他任意服务。

备份必需库名见 `backup-core.mjs` 的 `DATABASE_NAMES`，既有 UUID 仍用 `DATABASES`
校验，新库按精确名称解析，缺失/歧义时失败。原件集合由 `ORIGINAL_COLLECTIONS`
登记。新写出的完成清单是 v4，必须覆盖全部库以及 GU 原件、Me 原文和博客媒体；
v3 只覆盖 GU+Me，v2 只覆盖 GU，二者仅可用于恢复旧副本，不能证明新覆盖已完成。
博客媒体桶与 Ops BLOG binding 仍是 planned，不是已部署证据。不上线新 Ops 到尚不存在的绑定。

新增产品 SSO 与各自 Auth opt-in secret 用配对脚本一次完成；不手填两侧不同值。
新增 Worker 的 Issues 自动规则、生产登录、非空原文备份/恢复和真实 MCP 客户端必须
在获授权发布时单独验收。代码与本地合成测试不等于这些远程步骤完成。
