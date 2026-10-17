# Health API Hono 迁移

- 状态：已发布。目标、边界与验收已锁定；实现、验证、合并与生产核验完成。
- 目标与验收：把 `apps/oura/workers/api`（`src/index.ts`，184 行手写 switch 路由）迁移到 Hono 4，与 `apps/gu/worker`、`apps/gzh/worker` 保持同一套写法；路由表、405 语义、CORS、安全响应头、错误响应逐字节保持现有契约，`check-api` 16 项与全部集成测试不改语义继续通过。
- 不在范围内：业务规则、D1 schema、自动同步逻辑、MCP/OAuth 协议、部署载体（仍是独立 Worker + routes）、Auth Worker（下一个独立任务）、`check-api` 探针语义。
- worktree：`/Users/codepi/.worktrees/kdp.cool/codex/health-hono-api`
- 分支：`codex/health-hono-api`
- 起始 SHA / 审查基线：`d45dcec63a08d9042003dacb3a4439b47bd6e4ff`，开工时本地工作区干净。
- 协调者 / 实施者 / 集成者：本任务 Codex；审查者为独立 Codex subagent（只读冻结工作区）。
- 唯一分配记录：本文，由本任务 Codex 维护。
- 允许写入：`apps/oura/workers/api/`、`pnpm-lock.yaml`、本文。
- 相关先例：[GU Hono 迁移记录](./2026-10-17-gu-hono-router.md)、[GZH Svelte 迁移](./2026-10-17-gzh-svelte-frontend.md)。

## 设计约束（开工前从代码核实）

- 现入口在 `src/index.ts` 做三件事：MCP 路径（`/mcp`、`/.well-known/*`、`/oauth/*`）放行跨源（Bearer 客户端），其余路径跨源 403；OPTIONS 分流；switch 路由后统一补 `Cache-Control: no-store`、`X-Request-ID`、MCP `Access-Control-Allow-Origin: *` 与 CORS 头；异常经 `normalizeApiError` 输出 `{ error, requestId }`，配额错误带 `retryAt` / `Retry-After`。
- 405 语义由路由内方法守卫承担，集成测试断言：`/api/me/prefs` GET→405（check-api 亦探）、`/mcp`、`/oauth/register`、`/oauth/token` GET→405、`/api/me/health-records/automatic` PUT→405、`/api/auth/logout` GET→405。`/api/auth/logout` 的 405 来自 `logoutSso`；dev（非 SSO）分支对 GET 返回 302 重定向（线上探针已按 SSO 形态验收，dev 行为沿用现状，见 sso.test 覆盖）。
- Hono 会按方法匹配路由（未注册方法 404 或回退 notFound）。为保持 405 契约，涉及断言的路径一律用 `app.all()` 注册，把方法守卫留在 handler 内，与现状一致。`handleHealthRecords` 三个路径共享 handler 且内部区分方法；Hono 不支持单注册多路径，拆三行 `app.all` 指同一 handler。实际路由表为 **28 条**（独立审查核对，非早先估计的 27）。
- `new Hono({ getPath: request => new URL(request.url).pathname })` 保留原始 pathname 匹配，沿用 GU 写法。
- Hono 对 HEAD 会自动回退到 GET handler，并**清空成功响应的 body**（符合 HTTP HEAD 语义）；旧版在直接以模块方式调用 `fetch()` 时 HEAD 会返回 JSON body。差异只存在于直接模块调用形态，生产 HTTP 层 HEAD 本就不带 body，状态码与响应头不变；不视为契约回归，在此明确记录，"逐字节保持"不含 HEAD 直接模块调用的 body。
- 定时触发器 `scheduled` 与入口形态不变：`fetch` 委托 `app.fetch` 外层套现有错误兜底。

## 验证证据

- `apps/oura/workers/api`：`tsc --noEmit` 0 错误；`node --experimental-strip-types --test test/*.test.ts` 全过；`wrangler deploy --dry-run` 构建通过；`node --test test/integration/*.test.mjs` **116 项全过**。
- `apps/oura` 全量：`pnpm test` 四段（scripts 27、web 50、api 47、integration 116）全过。
- 全仓 `node scripts/agent/check.mjs --base d45dcec… --run`：23 项全部通过（含 web/auth/gu/gzh/oura 构建与 Health 浏览器检查、shared/auth 客户端 10 项）。
- 迁移中发现并修复两处 Hono 差异，均有集成测试失败→通过佐证：
  - handler 内抛出的 `ApiError` 被 Hono 默认 `onError` 压成 500；改为 `app.onError(e => { throw e })` 冒泡到入口统一 catch，保持日志、requestId、`Retry-After` 单点处理。
  - 集成测试把构建产物当 ESM 模块 import 后调 `fetch(request, bindings)` 不传 ExecutionContext；Hono 的 `c.executionCtx` 此时抛 `This context has no ExecutionContext`（迁移前 `ctx` 为 `undefined`，走"无 ctx"分支）。改为在首个中间件 `try/catch` 解析一次存入 `c.get("executionCtx")`，保持旧的可选语义。
- 405 契约保持不变：所有路由用 `app.all` 注册，方法守卫留在 handler 内（`/api/me/prefs` GET→405、`/mcp`·`/oauth/register`·`/oauth/token` GET→405、`/api/me/health-records/automatic` PUT→405、`/api/auth/logout` GET→405 均有集成断言）。
- 未覆盖：线上真实 Oura 提供方授权与同步、真实 MCP 客户端授权、`/api/auth/logout` 的 dev（非 SSO）形态差异（沿用现状）。

## 独立审查与修复

- 审查者 Dirac（独立 Codex subagent，只读），绑定 `c9c049732b9c9fadd3d1f70d04c45a4ec0650c39`。路由表 28/28、405、ctx、错误冒泡、类型、依赖、副作用面均通过；用内存打包 + 1120 组路径/方法/Origin 新旧入口对照发现两处差异：
  - **P1 跨源 403 丢失 JSON `requestId`**：初版把跨源拒绝放在中间件，未带 `requestId`。修复：跨源判定与 OPTIONS 分流移回 `dispatch()` 顶部、在后处理之前提前返回，恢复旧边界。
  - **P2 提前返回被纳入统一后处理**：403/OPTIONS 旧版不带 `no-store`/`X-Request-ID`，MCP OPTIONS 不带 `Vary`/`Allow-Credentials` 回填。同一修复恢复。
  - **P3 HEAD 直接模块调用 body 差异**：Hono 清空 HEAD 成功响应 body（正确语义），记录为已知差异而非回归（见"设计约束"）。
- 修复后用同样方法复刻对照探针（esbuild 内存打包基线 `d45dcec` 旧入口 vs 新入口，UUID 归一化）：42 组 7 路径 × GET/OPTIONS × 3 Origin 全部一致（status + headers + body），探针为一次性脚本未入库。
- 修复后重跑：typecheck 0 错误、116 项集成测试全过。审查者的 build/integration 失败是其只读沙箱 EPERM 所致，非代码问题；本任务环境已实际通过。

## PR 与自动发布

- PR #65 平台 CI run `39009723930`：`health-build` 的「Browser regression (normal and SSO)」步骤两次失败。第一次（attempt 1）在 `write budget defers details` 用例等待「数据库写入额度」告警 15 秒超时；第二次（attempt 2）`Browser normal` 场景 Chrome 冷启动 15 秒超时。两次失败点不固定，且均在环境侧。
- 判断为既有测试稳定性 flake 而非迁移回归：本 PR diff 只覆盖 `apps/oura/workers/api/`（API Worker 源码）+ 本文 + 根锁文件，`apps/oura/scripts/`（冒烟脚本）与 `apps/oura/apps/web/`（Pages 构建产物来源）零变化；冒烟 fixture server 不读 `workers/api` 源码。CI 上 116 项集成测试跑 44 秒（本地约 26 秒，慢约 1.7 倍），机器负载敏感。
- 第三次重跑（attempt 3）同一步骤全绿，`health-build` 与其余 12 个 job 全部 success；SSO/GU 专项 run `39009723888` success。
- 合并前核对 PR head 仍为 `5d13b91a800b61356bf099bed21a386884af8278`，合并 API 使用完整 expected head SHA；squash 合并为 `c9354e05b7bac9d2353ae57cc0dd7ba77bbae3e0`。
- main 自动发布 run `39011019991`：全 19 个 job `completed/success`，2026-10-17 14:48（上海时间）完成；validate run `39011019982` 亦 success。根锁文件变更触发全部产品重发，属预期。

## 生产版本与线上核验（2026-10-17）

Cloudflare API 核对四个 Pages canonical deployment：均为 production、完整 source SHA `c9354e05b7bac9d2353ae57cc0dd7ba77bbae3e0` 且 `commit_dirty=false`、branch=main、latest stage success。

| Pages 项目 | canonical deployment URL |
| --- | --- |
| `codepi-www` | `https://d4e59ddb.codepi-www.pages.dev` |
| `codepi-gu` | `https://fe92ada6.codepi-gu.pages.dev` |
| `codepi-gzh` | `https://b5f379ce.codepi-gzh.pages.dev` |
| `codepi-health` | `https://fa6cc156.codepi-health.pages.dev` |

- `node scripts/cloudflare/check-pages.mjs <web|gu|gzh> production` 三项通过：匿名 root 状态、私有 API 401 JSON、登录跳同环境 Auth PKCE。
- Auth `https://auth.codepi.app/api/health` 返回 200、JSON。
- `OURA_EXPECT_BUILD=c9354e05b7ba node apps/oura/scripts/check-api.mjs`：16 项全部通过；Health `/api/health` 返回 `build=c9354e05b7ba`（发布脚本取 GITHUB_SHA 前 12 位），证明线上跑的就是 Hono 版 Worker。
- 以上为匿名运行时证据，不代表已验收真实邮件、账号登录 / 退出、私人数据读取、真实 Oura 提供方授权/同步或真实 MCP 客户端授权。

## 继续工作

- 本次迁移把 Health API 服务端补齐到 Hono；`apps/gu`、`apps/gzh`、`apps/oura` 三个私有应用服务端栈已统一（GU Pages bundle、GZH/oura 独立 Worker）。后续迁移候选：Auth Worker 的 Hono 化（`services/auth/`，317 行 `index.ts`，独立任务）、Pages → Workers Static Assets（注意 `run_worker_first` 鉴权顺序），均需单独任务与用户确认。
- 既有问题记账（非本次引入、不阻塞）：CI 浏览器冒烟对机器负载敏感（见「PR 与自动发布」段），`write budget` 用例 15 秒等待与 Chrome 冷启动 15 秒超时在慢机器上可能耗尽，值得单独加固。
