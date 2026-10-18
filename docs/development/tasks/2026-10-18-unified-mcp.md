# CodePi 统一 MCP / Health 首期

- 状态：用户已授权上线；正在集成最新 main、重新验证并按本地发布流程上线。
- Worktree：`/Users/codepi/.worktrees/kdp.cool/codex/unified-mcp`，分支 `codex/unified-mcp`。
- 基线：`3d86d3e5449c3097da3ce1073c71e4d5837f4a6d`。
- 协调者、写入者、共享契约负责人和集成负责人：当前 Codex 会话；无并行写入者。
- 允许修改：`services/mcp/`、Health、共享 MCP/SSO 契约、Auth 注册、workspace
  依赖与 lockfile、检查与发布接线、Desk 测试打包适配及相关文档。
- 用户决策：一个 CodePi 入口，先做 Health；SDK 依赖已批准；查询自动持久化入队刷新，
  可读全部已保存历史，自动补齐限近 90 天；最新决定不保留旧 Health MCP，
  同版本直接删除，客户端改连统一地址并重新授权。
- 架构与数据语义：[统一 MCP](../../architecture/unified-mcp.md)。
- 原始实现提交 `1a8ef82`；集成基线为远程 main
  `96516ab354877c2802650974092e8eefe616b548`。发布授权包括提交、PR 合并及本地部署。
  已只读核对 Cloudflare 账户、现行版本、绑定、secret 名称与 Cron；尚未部署或创建资源。
- 审查：当前实现者已按完整 diff 自行审查；没有独立 Agent 审查或生产验收。

## 已实现

- `services/mcp/`：官方 SDK 的无状态 Streamable HTTP、OAuth discovery/动态注册、
  S256 PKCE、资源绑定、授权码原子兑换、refresh rotation/replay detection 与连接撤销。
  MCP D1 只保存独立的登录和客户端授权状态。
- 新增 SSO client `mcp`，通过 `SSO_CLIENT_SECRET_MCP` opt-in；
  shared auth client 识别新客户端，原有四个客户端不轮换。健康检查通过 Auth binding
  对不存在的会话引用进行无副作用探测，缺少/不匹配凭证或 Auth 故障时返回 503。
- 五个工具：`list_data_sources`、`health_get_catalog`、`health_query_records`、
  `health_aggregate`、`health_get_sync_status`。模块注册保存工具和调用函数；
  不放尚未实现的产品占位工具。
- Health named RPC `HealthMcp`；可信统一主体映射到 Health owner；
  无内部公网 HTTP 接口，无工具自选 `user_id`，MCP 不绑定 Health D1/Oura 凭证。
- 字段/单位/统计规则白名单、独立评分缓存集合、真实分页、全区间统计、
  每日加权规则与明确覆盖/缺失/权限状态。
- 查询追加持久同步任务，复用既有 lease/cron；保留集合拒绝、OAuth block、
  provider rate limit 和写入配额等待，不等待提供方请求。
- Health 设置页只提供统一入口与授权管理地址，移除原连接列表及其网络调用。
  删除 Health 的旧 MCP transport、工具、OAuth 服务、连接管理 API、专用测试和 CSS
  打包支持；Oura 授权不再保留旧 MCP consent 返回路径。前端不再转发或重写旧连接器 URL，
  直接返回 404 JSON，Health API 中对应路由也删除，无兼容开关。
- 发布探针验证旧 Health MCP/发现/授权 API 为 404；新的发现和匿名拒绝由 MCP
  `check:live` 独立检查。历史 migration 和旧表保留，定时维护不再操作旧 MCP 表；
  不删除健康记录或 Oura 凭证。
- MCP 首发按精确数据库名解析/创建独立 D1，用同一份临时配置迁移后部署，
  拒绝脏源码和错误 SHA。发布 DAG 为 Auth → Health API → MCP → Health 前端；
  使用 `pnpm run deploy` 避免命中 pnpm 内置命令。
- 授权页使用共享品牌/tokens，客户端文本转义；Origin/CSRF 和 CSP 均经真实浏览器
  流程验证。`same-origin` referrer policy 保留 POST Origin 且不向跨域回调泄漏 URL；
  CSP 仅额外允许已校验的客户端 callback origin。

## 验证证据（2026-10-18，直接切换后）

全部使用合成数据和本地状态；未读取真实 Health 数据，未发送邮件或调用真实 Oura。

| 检查 | 结果与覆盖 |
| --- | --- |
| 根目录 `pnpm install --frozen-lockfile` | 前轮已通过；本轮清理未改变依赖或 lockfile |
| `node scripts/agent/check.mjs --base 3d86d3e5449c3097da3ce1073c71e4d5837f4a6d --run` | **28/28 通过**；Web、Auth、GU、GZH、Health、MCP、shared auth、CF 治理和发布脚本 |
| `services/mcp: pnpm test` | **18/18 通过**；SDK client、真实本地多 Worker/D1/RPC、OAuth/code/refresh 并发与重放、撤销、网站登出/中央 Auth 故障下的独立授权、日期/字段/SQL 边界、分页/统计、覆盖/刷新、旧入口 404 与旧 token 拒绝、首发脚本 |
| `services/mcp: pnpm typecheck / pnpm build` | 通过；Worker dry-run，无远程发布 |
| `services/mcp: pnpm test:browser:built` | Chrome 桌面/390px 手机、允许/拒绝、不同 origin 的真实表单回调、文本转义、管理/撤销及跨域无 referrer 均通过，无脚本或 CSP 错误 |
| Auth / shared auth | **21 + 10 项通过**；既有客户端、跨产品登录与登出以及 opt-in 注册 |
| Health | 脚本 **27**、前端逻辑 **50**、API 单元 **48**、API 集成 **83** 项通过；类型、构建、资产、正常与 SSO 浏览器回归通过；旧 MCP GET/POST/refresh 和旧连接管理 API 为 404，保留数据与 Oura 重连覆盖不变 |
| Health 设置页补充验收 | 使用本地 SSO、未连接 Oura 的合成 owner，在 1440px 桌面、390px 手机核对新地址、授权管理链接和无旧列表；英文文案、页面宽度及控制台检查通过，已查看两张截图 |
| CF governance / deploy workflow / agent check regression | 通过；MCP 只允许独立 D1 与精确 named RPC，生产发布有 main guard 和版本证据接线 |
| 首发临时配置 | 前轮已用合成 UUID 对 release 脚本同等结构的绝对路径配置运行真实 Wrangler dry-run，通过；本轮未改该部署脚本、未分配或使用真实云端 UUID |
| `git diff --check` | 通过 |

全量检查日志：`/tmp/codepi-unified-mcp-direct-cutover-checks.log`。
MCP 最终浏览器证据：
`/var/folders/tf/by849xr51djfhx_x0fw2rqth0000gn/T/codepi-mcp-browser-nJVcsb`；
包含桌面/手机授权、同意/拒绝与连接管理流程。Health 浏览器证据：
`/var/folders/tf/by849xr51djfhx_x0fw2rqth0000gn/T/health-browser-artifacts-VdY9hL`。
设置页专项截图：
`/var/folders/tf/by849xr51djfhx_x0fw2rqth0000gn/T/codepi-mcp-settings-qyndnY`。
补充脚本首次误等未连接 Oura 页面不存在的 `#dash-view` 导致超时，改为确认正确的
“连接你的 Oura”状态后再进入设置，重新验证通过；未因此修改产品代码或放宽断言。
这些是本地临时证据，不是线上客户端的验收记录。

## 发布与后续验收

1. 按已有授权与仓库发布规范审查、提交、集成，记录实际交付 SHA。
2. 发布兼容 Auth 与 Health named RPC；经授权渠道单独配对 Auth/MCP 凭证。
3. 从干净审查版本发布 MCP，登记实际 D1 UUID、Worker version、源码 SHA 和匿名探针。
4. 发布 Health 前端；在 ChatGPT、Claude 和实际 Agent CLI 分别重新授权，
   验收查询、统计、缺失、后台刷新与撤销。SDK 和本地 Chrome 通过不替代此步骤。
5. 验证旧 Health 连接器地址均为 404 JSON；旧 token 在统一入口拒绝，
   各客户端重新完成统一授权。旧实现已随此版本删除，没有额外开关或兼容期。
   保留 Health 历史、提供方授权和旧表；不顺带删除业务数据。

Cloudflare MCP 登记仍为 `planned`。未验证新服务生产 SSO 配对、远程绑定、域名或真实客户端，
不能把配置存在、匿名探针脚本存在或本地测试通过写成“已上线可用”。

## 2026-10-19 发布集成

- 保留 main 的 Oura 同账号修复、回调诊断、加密授权错误处理和迁移 0012。
  旧 Health MCP 测试删除，但原账号防误绑定测试和设置页修复入口保留。
- 遵循 main 已实施的本地发布决策：CI 仅新增 MCP 检查，不恢复 Actions 部署。
  生产发布顺序补充为 Auth / 共享消费者 → Health API → MCP → Health 前端。
- 新 MCP 配置补齐持久日志、查询串脱敏和 Issues；迁移扫描包含独立 MCP D1。
- 现有五个 D1 的定时备份不变；MCP 仅保存可通过重新授权恢复的会话/授权状态。
- 本轮全部远程变更由当前 Codex 串行执行，其他 worktree 均保持原样。
  合并后检查、实际 PR、source SHA、provider version 和验收结果待执行后回填。

## 交付文件

以下为基线以来的已跟踪修改与未跟踪文件；生成产物、依赖和本地模拟数据库不在交付内。

```text
.github/workflows/deploy-platform.yml
AGENTS.md
README.md
apps/health/.env.example
apps/health/AGENTS.md
apps/health/README.md
apps/health/apps/web/scripts/assets.test.mjs
apps/health/apps/web/src/components/SettingsPage.svelte
apps/health/apps/web/worker/index.ts
apps/health/apps/web/wrangler.toml
apps/health/scripts/browser-fixture.mjs
apps/health/scripts/browser-smoke.mjs
apps/health/scripts/check-api.mjs
apps/health/scripts/tests/check-api.test.mjs
apps/health/workers/api/src/app.ts
apps/health/workers/api/src/index.ts
apps/health/workers/api/src/lib/auto-sync.ts
apps/health/workers/api/src/lib/health-catalog.ts
apps/health/workers/api/src/lib/health-data.ts
apps/health/workers/api/src/lib/mcp-store.ts
apps/health/workers/api/src/lib/mcp-tools.ts
apps/health/workers/api/src/routes/auth.ts
apps/health/workers/api/src/routes/mcp-oauth.ts
apps/health/workers/api/src/routes/mcp.ts
apps/health/workers/api/src/styles.d.ts
apps/health/workers/api/test/integration/health-domain.test.mjs
apps/health/workers/api/test/integration/mcp-hardening.test.mjs
apps/health/workers/api/test/integration/mcp.test.mjs
apps/health/workers/api/test/integration/node-worker.mjs
apps/health/workers/api/test/integration/runtime.mjs
apps/health/workers/api/test/integration/sso.test.mjs
apps/health/workers/api/wrangler.toml
apps/web/test/runtime.mjs
docs/architecture/health-domain-migration.md
docs/architecture/unified-mcp.md
docs/architecture/workspace-and-deployment.md
docs/development/agent-workflow.md
docs/development/cloudflare-governance.md
docs/development/cloudflare-resource-registry.md
docs/development/tasks/2026-10-18-unified-mcp.md
packages/shared/auth/README.md
packages/shared/auth/client.ts
packages/shared/mcp/contract.ts
packages/shared/package.json
pnpm-lock.yaml
pnpm-workspace.yaml
scripts/agent/check.mjs
scripts/agent/check.test.mjs
scripts/cloudflare/deploy-workflow.test.mjs
scripts/cloudflare/validate-governance.mjs
scripts/cloudflare/validate-governance.test.mjs
services/auth/src/app.ts
services/auth/test/auth.test.mjs
services/mcp/AGENTS.md
services/mcp/README.md
services/mcp/migrations/0001_mcp.sql
services/mcp/package.json
services/mcp/scripts/check-live.mjs
services/mcp/scripts/deploy.mjs
services/mcp/src/env.ts
services/mcp/src/http.ts
services/mcp/src/index.ts
services/mcp/src/modules.ts
services/mcp/src/oauth-store.ts
services/mcp/src/oauth.ts
services/mcp/src/pages.ts
services/mcp/src/protocol.ts
services/mcp/src/styles.d.ts
services/mcp/test/browser.mjs
services/mcp/test/connector.test.mjs
services/mcp/test/deploy.test.mjs
services/mcp/test/runtime.mjs
services/mcp/tsconfig.json
services/mcp/wrangler.toml
```
