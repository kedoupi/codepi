# Cloudflare 项目级治理规范

本文件是 kdp.cool 仓库全部 Cloudflare 基础设施的规范：环境、命名、域名、密钥、发布、
迁移与退役。资源事实来源是 [cloudflare-resource-registry.md](./cloudflare-resource-registry.md)。
仓库内静态守门由 `node scripts/cloudflare/validate-governance.mjs` 执行（见第 8 节）。

单一账户：所有资源在 Cloudflare 账户 `Kedoupi` 下，不拆分账户；产品边界由独立服务、
数据库与最小发布凭证维护。平台保护是否生效以控制面证据为准。

## 1. 环境模型

项目采用单主干自动发布，常用环境只有 `local` 和 `production`：

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

`service` 是稳定逻辑边界：`www`、`auth`、`gu`、`gzh`、`health`、`desk`。
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

## 6. 发布路径（唯一入口）

- 受控发布的唯一入口是 GitHub Actions `.github/workflows/deploy-platform.yml`：
  Auth、Web、GU、GZH、Health 全部经它发布（`deploy-product-apps.yml` 已删除，
  无其它受控入口）。这是仓库约束，workflow 文件存在不代表运行成功；实际 run 与
  线上版本见资源登记表及对应任务记录。
- workflow 支持 `push`（main）、`pull_request`（只构建测试，不
  migrate/deploy）与 `workflow_dispatch`（`target=production`、
  `app=all|auth|web|gu|gzh|health`）。一个 affected 判定 job 先标记受影响服务：
  `services/auth/**`、`packages/shared/auth/**`、`packages/shared/email/**`、`packages/shared/brand.ts`、
  `packages/shared/styles/**`、`scripts/cloudflare/**`、workflow 文件本身标记全部五个
  服务；根 `package.json`、`pnpm-lock.yaml`、`pnpm-workspace.yaml`、`.npmrc` 也标记全部
  服务；否则只标记对应 app 路径。pnpm 版本从根 packageManager 读取，所有 job 从根目录
  frozen install，发布使用 lockfile 中的 Wrangler。
- DAG：governance gate → auth build/migrate/deploy/smoke → web/gu/gzh
  Worker build/migrate/deploy/smoke → health API build/migrate/deploy/contract
  smoke → health Pages build/deploy/smoke。下游 job 只在 predecessor success 或
  skipped 时继续（`!failure() && !cancelled()`），failure 必须停止。
- 禁用所有 Pages Git 自动 production deploy；只保留 Actions direct upload。
  GU、GZH 自 2026-10-17 起以 Workers Static Assets 架构经 `wrangler deploy` 发布
  （`run_worker_first = true`，全站请求先进 Worker 鉴权），首页同样使用 Workers Static Assets，但仅 `/api/*` 与 `/desk` 路径优先进入 Worker，公开页面由资产服务直出；Health 前端自 2026-10-18 起为 Workers Static Assets SPA（`codepi-health`），API/MCP/OAuth 经其 WORKER service binding 转发到 `codepi-health-api`，前端不持有 DB、AUTH 或 vars。
  当前控制面状态见资源登记表。
- production deploy/migrate step 同时有 job 级与 step 级
  `github.ref == 'refs/heads/main'` guard。合并 PR 即授权自动发布，不增加逐次 Environment
  approval。GitHub `production` Environment 应仅允许 main，并配置发布凭证；`environment:`
  声明不能证明平台保护和 scoped secrets 已生效。2026-10-16 rulesets API 返回私有仓库
  套餐限制，GitHub CLI 凭证也失效；这些控制面配置仍待处理，不改变仓库可见性。
- 并发控制：整条 main workflow 共用 `platform-refs/heads/main` 并发组，
  `cancel-in-progress: false`；服务级锁作为额外保护。PR 可以取消过期检查。
  发布前拒绝已落后于 main 的 run；每次 main 更新（包括仅文档变更）都启动 workflow，
  保证新 run 接管未完成发布。push 的 affected 范围取最近一次成功的 main push release
  之后所有提交触及的路径，不能只看净 diff，否则失败后的 revert 会遗漏已部分上线的服务。
  无成功记录或成功 SHA 不在当前祖先链时发布全部服务；仅文档且无积压改动时不部署应用。
  手动 dispatch 也包含相同积压范围，再额外加入指定应用；不能让单应用 dispatch
  替换 pending push 后遗漏它尚未发布的应用。
- 每次部署传入并记录 `GITHUB_SHA`；deploy 步骤必须解析真实 provider 标识
  （Pages deployment id 经 Cloudflare API 只读解析，Worker Current Version ID
  从 wrangler 输出解析，解析失败即失败），连同 service/target/smoke 结果由
  `scripts/cloudflare/deployment-evidence.mjs` 写入 JSONL 证据并上传为
  GitHub artifact（不含 secret）；登记表 `last_verified` 必须能关联同一 SHA。
- 部署前运行 `validate-governance.mjs`；部署后做匿名 smoke、预期登录跳转、
  匿名私有 API 拒绝和 Health OAuth discovery content-type 检查。
- 紧急 break-glass 仅允许使用同一 workflow 的明确 SHA；如不得不在本机操作，
  必须在登记表写入执行人、目标、SHA、原因、验证与后续 workflow 回填记录。

### 发布依赖顺序

Auth migration/deploy/smoke → Web/GU/GZH migrations/deploy/smoke →
Health API migration/deploy/contract smoke → Health Pages。
任何 SSO/shared-auth 改动都纳入 Auth、Web、GU、GZH、Health 的受影响检查与对应
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
  SSO callback 同环境精确匹配、登出、Health `/api/*`、`/mcp`、两个
  `/.well-known/*` 返回 JSON 而非 SPA HTML。正式生产路径不得返回 522。

## 8. 静态守门

`scripts/cloudflare/validate-governance.mjs` 读取全部 Wrangler 配置（web、gu、
gzh、auth、health-api、health-pages）与登记表，对每个 declared service 强制：

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
   Auth SSO callback registry）缺失即违规。

该守门只读取仓库文件，绝不访问 Cloudflare 或迁移远程数据库。改动任一 Wrangler
配置、`scripts/cloudflare/**`、登记表或本规范时，由 `scripts/agent/check.mjs`
自动选择执行。
