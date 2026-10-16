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

`staging` 资源（wrangler named environment、staging D1、staging secrets）保留但不自动部署。
仅在需要云端联调（统一登录、MCP、跨应用调用）时再启用。目前 workflow 不提供 staging
入口，不能把保留配置视为可用环境。staging 不再作为发布的必经路径。

业务数据不要求环境隔离，这是当前阶段的有意决策：所有数据均为个人测试数据，可重建。
现有开发命令默认本地 D1；接入远程业务数据需显式配置并验证运行方式支持的 binding，
不复制数据来维持第二套业务环境。自动测试使用本地合成数据。共享业务数据不等于共享
认证会话、OAuth 凭证或外部副作用；远程 migration 和批量写入由单一任务负责。

## 2. 资源命名

物理名称规则（静态守门强制）：

- production：`codepi-<service>[-<role>]`（无环境后缀）
- staging：`codepi-<service>[-<role>]-staging`
- 临时：`codepi-<service>[-<role>]-pr-<number>`

`service` 是稳定逻辑边界：`www`、`auth`、`gu`、`gzh`、`health`、`desk`。
`role` 只用于独立组件：`api`、`sync`、`assets`、`cache`、`uploads`、`mcp`。

禁止把分支全文、secret、邮箱、用户名、供应商凭证放进资源名。

现有 `codepi-*` production 资源（不带 `-prod` 后缀）是规范合法存量，不为补后缀搬迁
数据。若存量资源名无法满足规则，在登记表登记例外与目标迁移。

## 3. 域名契约

- production：`codepi.app`、`www.codepi.app`、`<service>.codepi.app`；
  `auth.codepi.app` 为 Workers custom domain。
- staging：`staging.codepi.app`（首页/Desk）与 `<service>-staging.codepi.app`。
- 生产 API 默认附着在对应服务的 `/api/*`；没有明确独立 API 边界时不得新增
  `api.codepi.app`。
- PR 默认使用 Pages/Workers provider URL（`*.pages.dev` / `*.workers.dev`），
  不分配 `codepi.app` wildcard host。
- 同一 hostname 不得同时映射到 production 与 staging。

## 4. 保留的 staging 配置

以下是未启用的存量配置边界，用于防止误部署接入生产资源，不是日常发布要求。
重新启用时必须先完成独立认证、域名与发布入口核验；不得为此建立第二条长期 Git 分支。

### Pages

Pages 只有 production/preview 两级配置，preview bindings 不按分支隔离。因此：

- 每个 Pages 项目的 `preview` 环境即 staging runtime：`ENVIRONMENT="staging"`，
  绑定 staging D1 与 `codepi-auth-staging`。
- 保留的 `staging` Pages deployment alias 是 provider 路由标签，不要求仓库存在同名
  长期分支；启用时须明确其 source SHA。
- 该 alias 对应 `<service>-staging.codepi.app`；启用前验证 Cloudflare Access 或等效的
  访问限制，当前不能声称 Access 已配置。
- 非 staging 的 PR 不发布有状态 Pages preview，避免所有 preview 共享一套 binding
  时写入 staging 数据。

### Workers

- staging 使用 Wrangler named environment：`codepi-auth-staging`、
  `codepi-health-api-staging` 等。
- 每个 `[env.staging]` 显式声明 route、vars、D1、service binding、Cron 与 secret 名，
  不依赖顶层 bindings 继承。
- 所有 staging service binding 只能连接 `*-staging` Worker。
- staging 不得配置生产副作用：`AUTO_SYNC_ENABLED="0"`、`ALLOW_DEV_LOGIN="0"`、
  不配置 production provider credentials 或 production Cron side effects。

### SSO 隔离

- staging Auth 只登记 staging GU/GZH/Health/Desk 的精确 `/api/auth/callback` URL。
- production Auth 不得登记任何 `*-staging.codepi.app` callback；staging Auth 不得
  登记任何 production callback。
- 同环境精确匹配：跨环境使用 callback 必须被拒绝。

## 5. 密钥与数据

- 所有云端 secret 通过 Cloudflare secret store（`wrangler secret put` /
  `wrangler pages secret put`）设置；Git 只声明 required secret 名，禁止提交
  secret 值或真实 `.dev.vars`。
- staging 与 production 使用相互独立的 session/OTP/SSO client-secret registry。
- 保留的 staging D1 仅作 synthetic fixture 使用，不复制生产会话或 provider token，
  也不作为强制维护的第二份业务数据。日常共享业务数据按第 1 节显式联调。
- 数据分级：`public-dns`、`synthetic`、`auth-session-data`、`private-user-data`、
  `private-health-data`、`legacy`、`unknown`。公开首页与私有健康/投资/稿件数据不得
  混入同一数据边界。

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
- DAG：governance gate → auth build/migrate/deploy/smoke → web/gu/gzh Pages
  build/migrate/deploy/smoke → health API build/migrate/deploy/contract smoke →
  health Pages build/deploy/smoke。下游 job 只在 predecessor success 或 skipped
  时继续（`!failure() && !cancelled()`），failure 必须停止。
- 禁用所有 Pages Git 自动 production deploy；只保留 Actions direct upload。
- production deploy/migrate step 同时有 job 级与 step 级
  `github.ref == 'refs/heads/main'` guard。合并 PR 即授权自动发布，不增加逐次 Environment
  approval。GitHub `production` Environment 应仅允许 main，并配置发布凭证；`environment:`
  声明不能证明平台保护和 scoped secrets 已生效。2026-10-16 rulesets API 返回私有仓库
  套餐限制，GitHub CLI 凭证也失效；这些控制面配置仍待处理，不改变仓库可见性。
- 并发控制：整条 main workflow 共用 `platform-refs/heads/main` 并发组，
  `cancel-in-progress: false`；服务级锁作为额外保护。PR 可以取消过期检查。
  发布前拒绝已落后于 main 的 run；push 的 affected 范围从最近一次成功的 main push
  release 计算，首次无成功记录则发布全部服务，覆盖失败或被队列替换的中间提交。
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
- 域名切换顺序：先使 Pages custom domain `active`，再切 zone CNAME 到对应
  `*.pages.dev`；domain pending 时不得删除旧项目或 DNS。切换后按顺序验证：
  匿名首页/登录页 200 或预期 302、Auth health 200 JSON、未登录私有接口 401/302、
  SSO callback 同环境精确匹配、登出、Health `/api/*`、`/mcp`、两个
  `/.well-known/*` 返回 JSON 而非 SPA HTML。正式生产路径不得返回 522。

## 8. 静态守门

`scripts/cloudflare/validate-governance.mjs` 读取全部 Wrangler 配置（web、gu、
gzh、auth、health-api、health-pages）与登记表，对每个 declared service 强制：

1. production 资源名不含环境后缀且 `ENVIRONMENT` 为 `production`；
2. non-production 资源名以 `-staging` 或 `-pr-<number>` 收尾；
3. production 与 preview/staging 的 D1 `database_id` 不同，且任一环境缺失 D1
   声明即违规（fail-closed）；重复/冲突的 D1 或 service binding 即违规；
4. preview/staging 的 `AUTH` service、`AUTH_ORIGIN`、frontend origin 与环境同名；
   每个服务必需的 service binding（Pages 与各 health 组件的 `AUTH`、
   health-pages 的 `WORKER`）必须精确等于约定的 production/staging 目标；
5. Health（API 与 Pages）staging 的 routes、`AUTH_ORIGIN`、`FRONTEND_ORIGIN(S)`、
   `OURA_REDIRECT_URI` 不得出现任何生产 hostname；Health API staging 必须
   `AUTO_SYNC_ENABLED="0"`、`ALLOW_DEV_LOGIN="0"`，且 routes 必须是精确的服务
   边界集合（`/api/*`、`/mcp`、`/oauth*`、`/.well-known*`）；
6. 所有 public hostname 符合第 3 节域名规则；
7. 运行配置引用的 Pages、Worker、D1、custom domain 都有登记表 `managed` 记录，
   且 environment 与 resource_type 兼容（production 引用 production 行、staging
   引用 staging 行）；
8. `legacy-pending-retirement`、`legacy-preview` 或 `unknown` 项不得被当前运行
   配置引用；
9. 必需声明（worker routes、staging cron triggers、Auth SSO callback registry）
   缺失即违规。

该守门只读取仓库文件，绝不访问 Cloudflare 或迁移远程数据库。改动任一 Wrangler
配置、`scripts/cloudflare/**`、登记表或本规范时，由 `scripts/agent/check.mjs`
自动选择执行。
