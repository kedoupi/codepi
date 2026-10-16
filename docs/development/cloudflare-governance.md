# Cloudflare 项目级治理规范

本文件是 kdp.cool 仓库全部 Cloudflare 基础设施的规范：环境、命名、域名、密钥、发布、
迁移与退役。资源事实来源是 [cloudflare-resource-registry.md](./cloudflare-resource-registry.md)。
仓库内静态守门由 `node scripts/cloudflare/validate-governance.mjs` 执行（见第 8 节）。

单一账户：所有资源在 Cloudflare 账户 `Kedoupi` 下，不拆分账户；隔离由独立资源、
最小发布凭证与 CI 环境保护实现。

## 1. 环境模型

只有四种环境，不得新增长期 `dev` 或不带环境含义的 `preview` 资源：

| 环境 | 语义 | 数据 | 凭证 |
|---|---|---|---|
| `local` | 开发者本机 | Wrangler 本地 storage / 本地 D1 | `.dev.vars*` 合成配置，禁止真实 secret |
| `staging` | 唯一持久云端集成环境 | 独立 staging D1，仅 synthetic fixture | 独立 secret，与 production 完全分离 |
| `production` | 正式数据与正式外部集成 | 生产 D1 | 生产 secret，仅发布 workflow 可用 |
| `pr-<number>` | 临时 PR 环境 | 独立 `codepi-<service>-pr-<number>` 资源 | 独立；必须有 owner、`expires_on`、清理证据 |

PR 环境只在需要做带状态的完整云端验收时创建；PR 关闭后删除，登记表必须记录
`expires_on` 与 `cleanup_evidence`。临时资源不得连接 shared staging 或 production。

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

## 4. staging 拓扑

### Pages

Pages 只有 production/preview 两级配置，preview bindings 不按分支隔离。因此：

- 每个 Pages 项目的 `preview` 环境即 staging runtime：`ENVIRONMENT="staging"`，
  绑定 staging D1 与 `codepi-auth-staging`。
- staging 由稳定的 `staging` branch 承载，Actions 只允许 `staging` branch 上传
  staging Pages（branch alias `staging`）。
- staging branch alias 绑定到对应 `<service>-staging.codepi.app`，并用 Cloudflare
  Access 限制访问。
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
- staging D1 只应用仓库已提交的 migration 并写入 synthetic fixture；禁止复制生产
  健康、投资、稿件、会话或 provider token。
- 数据分级：`public-dns`、`synthetic`、`auth-session-data`、`private-user-data`、
  `private-health-data`、`legacy`、`unknown`。公开首页与私有健康/投资/稿件数据不得
  混入同一数据边界。

## 6. 发布路径（唯一入口）

- 受控发布的唯一入口是 GitHub Actions `.github/workflows/deploy-platform.yml`：
  Auth、Web、GU、GZH、Health 全部经它发布（`deploy-product-apps.yml` 已删除，
  无其它受控入口）。这是一项仓库约束；当前线上 direct-upload 历史状态与本次未运行
  workflow 的事实见资源登记表，不能据此声称新 workflow 已完成远程发布。
- workflow 支持 `push`（main/staging）、`pull_request`（只构建测试，不
  migrate/deploy）与 `workflow_dispatch`（`target=staging|production`、
  `app=all|auth|web|gu|gzh|health`）。一个 affected 判定 job 先标记受影响服务：
  `auth/**`、`shared/auth/**`、`shared/email/**`、`shared/brand.ts`、
  `shared/styles/**`、`scripts/cloudflare/**`、workflow 文件本身标记全部五个
  服务；否则只标记对应 app 路径。
- DAG：governance gate → auth build/migrate/deploy/smoke → web/gu/gzh Pages
  build/migrate/deploy/smoke → health API build/migrate/deploy/contract smoke →
  health Pages build/deploy/smoke。下游 job 只在 predecessor success 或 skipped
  时继续（`!failure() && !cancelled()`），failure 必须停止。
- 禁用所有 Pages Git 自动 production deploy；只保留 Actions direct upload。
- production deploy/migrate step 同时有 job 级与 step 级
  `github.ref == 'refs/heads/main'` guard；staging 为
  `github.ref == 'refs/heads/staging'`。GitHub `production`/`staging`
  Environment 的 approval 与 scoped secrets 是 provider 前提：workflow 已声明
  `environment:`，但保护规则是否已配置未经验证（本机 `gh` 未认证），
  不得声称已配置。
- 并发控制：production job `concurrency: <service>-production` 且
  `cancel-in-progress: false`；staging 为 `<service>-staging`。
- 每次部署传入并记录 `GITHUB_SHA`；deploy 步骤必须解析真实 provider 标识
  （Pages deployment id 经 Cloudflare API 只读解析，Worker Current Version ID
  从 wrangler 输出解析，解析失败即失败），连同 service/target/smoke 结果由
  `scripts/cloudflare/deployment-evidence.mjs` 写入 JSONL 证据并上传为
  GitHub artifact（不含 secret）；登记表 `last_verified` 必须能关联同一 SHA。
- 部署前运行 `validate-governance.mjs`；部署后做匿名 smoke、预期登录跳转、
  匿名私有 API 拒绝和 Health OAuth discovery content-type 检查。
- staging Auth 的 secret-name preflight 必须在任何远程 migration 或 deploy **之前**
  fail-closed：只通过 Cloudflare API 元数据校验 `OWNER_EMAIL`/`OTP_FROM`/
  `RESEND_API_KEY`（绝不读取值、不发送 OTP）。任一缺失即停止 release；
  配置完成后再要求 Auth health 为 200 JSON，503 `auth_not_configured` 是失败。
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
