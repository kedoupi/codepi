# Health API Hono 迁移

- 状态：进行中。目标、边界与验收已锁定；实现与验证未完成。
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
- Hono 会按方法匹配路由（未注册方法 404 或回退 notFound）。为保持 405 契约，涉及断言的路径一律用 `app.all()` 注册，把方法守卫留在 handler 内，与现状一致。`handleHealthRecords` 三个路径共享 handler 且内部区分方法；Hono 不支持单注册多路径，拆三行 `app.all` 指同一 handler。
- `new Hono({ getPath: request => new URL(request.url).pathname })` 保留原始 pathname 匹配，沿用 GU 写法。
- Hono 对 HEAD 会自动回退到 GET handler；现状同样如此（路由匹配不看方法，handler 内部仅按 GET 处理），行为等价，无需 getApi 包装。
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

## PR 与自动发布（回填）

## 生产版本与线上核验（回填）

## 继续工作（回填）
