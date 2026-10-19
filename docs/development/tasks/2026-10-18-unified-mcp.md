# CodePi 统一 MCP / Health 首期

- 状态：PR #99 已合并并完成生产部署、匿名契约与控制面验收；真实 AI 客户端授权待所有者验收。
- Worktree：`<workspace>/.worktrees/kdp.cool/codex/unified-mcp`；实施分支 `codex/unified-mcp`，发布使用合并后 main 的 detached HEAD，证据分支 `codex/unified-mcp-release-evidence`。
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
  已发布源码为 `767fb0b3d63a43aed8f2ca0a78a7b7a9271cabe4`；生产证据见本记录下方。
- 审查：当前实现者已按完整 diff 自行审查；没有独立 Agent 审查。生产服务器验收已完成，真实 AI 客户端流程未验收。

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

上列发布、资源创建、SSO 配对和旧入口退役已完成，MCP 登记已转为 `managed`。
剩余验收是各实际 AI 客户端的授权、查询、统计和撤销，不能用服务器 smoke 替代。

## 2026-10-19 发布集成

- 保留 main 的 Oura 同账号修复、回调诊断、加密授权错误处理和迁移 0012。
  旧 Health MCP 测试删除，但原账号防误绑定测试和设置页修复入口保留。
- 遵循 main 已实施的本地发布决策：CI 仅新增 MCP 检查，不恢复 Actions 部署。
  生产发布顺序补充为 Auth / 共享消费者 → Health API → MCP → Health 前端。
- 新 MCP 配置补齐持久日志、查询串脱敏和 Issues；迁移扫描包含独立 MCP D1。
- 现有五个 D1 的定时备份不变；MCP 仅保存可通过重新授权恢复的会话/授权状态。
  此为首发决策；随后按所有者要求将 MCP 纳入六库加密备份，见
  [2026-10-19 运维补齐](2026-10-19-mcp-operations.md)，启用状态以该任务为准。
- 本轮全部远程变更由当前 Codex 串行执行，其他 worktree 均保持原样。
  实际 PR、source SHA、provider version 和验收结果见下方生产记录。
- `pnpm install --frozen-lockfile` 和针对 `96516ab` 的完整受影响检查通过：
  **31/31**（全产品、Auth、MCP、shared auth、治理、迁移与 lint）。
  初次治理测试暴露新 MCP fixture 未接入持久日志配置，复用现有 OBSERVABILITY
  fixture 修复后完整重跑通过；未降低守门要求。
- MCP 的 18 项集成/发布测试及桌面/手机授权、同意/拒绝、管理/撤销浏览器验收通过；
  Health 正常与 SSO 浏览器回归通过，保留 main 的显式原账号修复用例。
  日志：`/tmp/codepi-unified-mcp-integrated-checks.log`；
  MCP 截图：`/var/folders/tf/by849xr51djfhx_x0fw2rqth0000gn/T/codepi-mcp-browser-2QF12D`。
- 发布前控制面快照：`/tmp/codepi-mcp-release-before.json`（仅资源元数据）。
  Cloudflare API 确认 `mcp.codepi.app` 没有既有 DNS/custom-domain 冲突；
  本机凭证不含 DNS 读取权限，此项通过已连接 Cloudflare API 核实。

## 2026-10-19 生产发布记录

- PR #99 由 GitHub API 创建并 squash 合并，source SHA：`767fb0b3d63a43aed8f2ca0a78a7b7a9271cabe4`。
  合并树与通过 31 项检查的 `8bf669b` 完全一致；从实时远程 main 获取该提交后发布。
- 执行者：当前 Codex，本机 `<workspace>`；在任务 worktree 从干净源码执行，
  每阶段前检查 HEAD、工作区和远程 main，持有 Git common directory 的发布锁。
  UTC 开始 `2026-10-18T16:31:19.800Z`，完成 `2026-10-18T16:36:41.754Z`。
- 顺序：新 MCP 凭证配对 → Auth → Web → GU → GZH → Health API → MCP → Health 前端。
  Auth/各原产品迁移均无待应用项；新 MCP D1 应用 `0001_mcp.sql`。
  所有服务记录同一个 source SHA；未删除 Health 历史或旧表，未轮换 Oura/既有 SSO 凭证。

| 服务 | 前一 version | 本次 version |
| --- | --- | --- |
| auth | `b2374503-7d0d-4221-8c6a-5e98bf3acd32` | `5d44973d-b23d-460f-9b7f-c0cd27c5ce74` |
| www | `948b8f0c-e52d-4fac-9a07-4aa88496a854` | `6924e315-5ddd-4867-88eb-9dd289186511` |
| gu | `b0a41961-9174-4bf0-a872-4b4468fd5c37` | `c83f0adc-e415-42dd-b3b7-eac519a563a7` |
| gzh | `a7e04cbf-f261-470f-8595-c3e8fd85f0eb` | `24011868-67ec-44ce-97b4-1997d412f59a` |
| health-api | `3a78e935-726f-408a-9da3-0bbe210b8587` | `601e1ddf-eff9-40ee-8d14-b50787240e82` |
| mcp | `首次发布` | `dabf3c40-2360-40ec-b603-50c1d317ec13` |
| health-pages | `a4bca3a2-872f-4e90-922f-980dd1edea75` | `cd1759eb-755e-4f77-b25c-cbe1c076ae91` |

MCP D1：`codepi-mcp` / `73c6ef4e-e2a0-41c2-9bce-ab41c7391caa`；custom domain：
`mcp.codepi.app` / `cf99c579c8892106812f136fed9fa7943674a5f2`，Workers 管理的
AAAA DNS 为 `35b070e16d8d629f3111c9a6cc922819`，无旧记录冲突，workers.dev 已关闭。
控制面核验只有独立 DB、AUTH 和 HEALTH#HealthMcp 绑定；不包含 Health D1/Oura secret。

验证与边界：

- Web/GU/GZH 的 `check-pages.mjs`、运行时 secret 名称检查通过；Auth health 200。
- Health 正式域名 **18/18** API 契约通过，build `767fb0b3d63a`；前端 `check:branding` 通过。
- MCP `check:live` 通过，build `767fb0b3d63a`；Auth 凭证配对、OAuth discovery、匿名 401 和连接管理登录跳转均符合契约。
- 七个 Worker 的活跃 version、100% 流量、绑定、Cron、持久日志、查询串脱敏和 Issues 均通过控制面核验。
- MCP 首次探针 TLS 连接中断后停止后续阶段；控制面确认新域名后，在同一 version 复测通过，再继续发布前端。没有重发代码来掩盖失败。
- 本机 D1 迁移元数据读取两次超时；通过已连接 Cloudflare API 的同一 SELECT 核实 `0001_mcp.sql`，HTTP 200、0 写入。
- PR CI run `39145221146` / `39145221157` 失败，首批 job 无 steps，日志返回 404，构建 job skipped。没有取得步骤执行证据，不记为 CI 通过，也不以它替代本地验证。
- 新 MCP 登录入口返回 302，中央 Auth 页面返回 200，正确识别 `mcp` 与精确 callback；
  全部九个旧 Health GET/POST 探针为 404 JSON。补充探针最初误将原 API 的
  `error: "not found"` 写成前端退役路径的 `error: "not_found"`，按双方现有实现
  修正精确断言后重新验证；没有修改产品或降低 404/JSON 标准。
- 补充登录检查期间出现一次约 11 秒后的 HTTP 500；后续新旧 D1 的 `SELECT 1`
  都在约一秒内成功，登录入口连续三次 302（1261/1071/366ms），完整入口/退役路径
  检查再次通过。本轮未为该故障修改业务代码，也未确认 500 的具体根因；保留记录，
  后续真实客户端验收需留意是否复现，不能声称已通过代码修复。
- 通用生产巡检 **10/11** 通过，旧 `api.xiaotaozi.cc/oura/daily` 仍拒绝匿名访问。
  Health 最后完整同步成功为 `2026-10-15T15:16:55.898Z`（检查时约 73 小时）；
  既有任务在本次发布前 `2026-10-18T09:04:37.417Z` 已以 `partial/upstream_unavailable` 结束。
  同步上游问题仍需处理；不以 MCP 可访问声称健康数据已全部刷新。
- 未发送邮件、重新连接 Oura或使用真实 AI 客户端授权。AI 客户端需改用新地址重新授权，
  再验收真实数据查询、统计、后台刷新和撤销。
- 证据文档更新后受影响检查 **4/4** 通过：Cloudflare 脚本、治理、Agent 映射和 lint。

本机证据：`/tmp/codepi-unified-mcp-release-state.json`、
`/tmp/codepi-unified-mcp-release-evidence.jsonl`、`/tmp/codepi-mcp-release-before.json`、
`/tmp/codepi-unified-mcp-production-acceptance-retry.log`（控制面部分通过；D1 读取超时保留）、
`/tmp/codepi-unified-mcp-endpoint-acceptance-recovery.log`（完整检查通过）、
`/tmp/codepi-mcp-login-repro.log`、`/tmp/codepi-unified-mcp-production-monitor.log`。
这些文件不含凭证或健康记录。

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
