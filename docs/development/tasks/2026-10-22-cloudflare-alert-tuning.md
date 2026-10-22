# Cloudflare 告警优化与漂移发布
- 状态：已完成。云端巡检 05:30/06:00 两个自然周期 complete；全部 active issue 已清零；三次发布（`6cf89f57849b` 九服务、`120a8279231d` MCP 补发、`a49ba23db7b1` MCP 403 修正）均 smoke 通过。
- 日期与执行人：2026-10-22，omp 会话，单一协调者、写入者与发布者，无并行写入。
- 基线：开发基线 `57318989b37e3e1bdf2c80fe11231f7d9959c979`；发布源码 `6cf89f57849b6c0a495e6cd1b7a22c0f2fc08851`（PR #145 squash 合并后的远程 main，发布时经 `git ls-remote` 实时核对一致）。
- worktree：开发 `/Users/codepi/orca/workspaces/kdp.cool/cloudflare告警优化`（分支 `kedoupi/cloudflare告警优化`）；发布 `/Users/codepi/.worktrees/kdp.cool/release-alert-optimization`（detached HEAD，干净且等于远程 main）。主 checkout `/Users/codepi/Coding/kdp.cool` 存在用户未提交改动，未触碰。
- 授权：用户在本会话明确选择并授权四项操作——WAF 边缘拦截、MCP 日志降级 + Always Use HTTPS、按发布流重发漂移 Worker（含 PR 合并）、禁用 incident 通知策略。
- 发布锁：`codepi-production-release.lock` 由本会话在 Git common directory 持有，覆盖全部远程写入。

## 根因（通知历史 API 实测，2026-10-15 → 10-22 共 211 封邮件）

| 来源 | 数量 | 处置 |
| --- | --- | --- |
| Workers Issues「Potential vulnerability scan」（互联网扫描器探测 `.env`/`.git`/`wp-*`/`phpinfo` 等，Worker 本已返回 404/401） | ~185 封 | WAF 边缘拦截 + 38 个存量 security issue 全部 resolved |
| `incident_alert` 平台事件（Dashboard/Zero Trust/DNS 等与本账户无关组件） | ~22 封 | 策略已删除 |
| `codepi-mcp` `mcp_not_configured` 503（611 次，全部为 `http://mcp.codepi.app/*` 明文探测） | 16 封 | 代码降级为 `console.warn(mcp_rejected_origin)` + 503 `canonical_origin_required`（PR #145），不再产生 Issue |
| `codepi-ops` 巡检断言失败（81 次异常，每 30 分钟一次） | 4 封 | 根因为 9 个 Worker 版本漂移（PR #140 shared 品牌资产 + #142–#144 web 修复未发布）；本轮全部重发后本地巡检 31/31 通过 |
| `codepi-health-api` `https_required` / D1_ERROR、`codepi-www` 503 | 4 封 | 低频，观察；health-api `https_required` 与 MCP 同类（明文探测） |

规则侧结论：Issues 自动规则（`afterOccurrences=1` / `afterInactivitySeconds=3600`）schema 与官方文档均不支持按 issue 类型过滤，扫描器指纹每个都是新 issue，属结构性噪音；WAF 边缘拦截使请求不到达 Worker，从源头消除。

## 已执行的远程变更

1. **WAF 自定义规则**（zone `codepi.app` `268a0acf9bae4e2e2cbc4d8a0ba2c342`）：ruleset `8cc34f9e40d54621aff068b2ee37dd9b`，规则 `9d1cf91b6e6e49679e627fd1c3be7d6d`，action=block，覆盖 `/.git`、`/.env`、`/.svn`、`phpinfo`、`.php`、`/wp-`、`wp-includes`、`/wordpress/`、`/_profiler`、`/actuator/`、`/telescope/`、`/debug/`、`trace.axd` 及 url_decode 后的 `/.git`。路径清单来自 38 个 security issue 的实际 occurrence 采样。验证：`/.git/config`、`/wp-admin/setup.php`、`/api/.env`、`/phpinfo.php` 均边缘 403；`/`、`/about/`、MCP 两个 `/.well-known/*` 与 `/api/health` 均 200。
2. **incident 通知策略删除**：`11766abf994c4e61adf7d19e7b956697`（kdp platform incident）已 DELETE；剩余策略为预算告警与 Workers Issues 策略。PUT 更新因账户掩码邮箱目的地 ID 不可得（`Invalid recipient`），删除经用户授权；如需恢复在 Dashboard 重建即可。
3. **Issues 清理**：`codepi-mcp` 的 `mcp_not_configured` issue 与全部 38 个 security issue 已通过 API 标为 resolved。剩余 active：`codepi-mcp` 一个 HTTP 503 exception（观察）、`codepi-ops` 巡检断言（待云端转绿后 resolve）。
4. **Always Use HTTPS 未执行**：当前 API token 无 Zone Settings Write（10000）与 Single Redirects 权限。MCP 代码降级已消除该告警源；zone 级 `Always Use HTTPS` 建议由用户在 Dashboard（SSL/TLS → Edge Certificates）手动开启，或换用具备权限的 token 后补做。

## 发布记录（source SHA `6cf89f57849b`）

前置：`pnpm install --frozen-lockfile`、`check.mjs --base 0184542e3711 --run` 41 项通过、治理守门、migration 守门、`git diff --check` 通过。各服务 D1 migration 均为「No migrations to apply」（Project/Me 由 deploy-domain 内置执行）。回退基线版本见证据目录 `codepi-release-before-20261022.json`。

| 顺序 | 服务 | 新 version | smoke |
| --- | --- | --- | --- |
| 1 | auth | `4a02d868-59db-45cb-b5a3-7a303655b666` | `/api/health` 200 `ok=true` |
| 2 | gu | `93151462-614a-4714-8dd6-810b0e4ddbca` | `check-pages.mjs gu production` 通过 |
| 3 | gzh | `e53d439c-d746-44fa-8c59-223fbf95a209` | `check-pages.mjs gzh production` 通过 |
| 4 | project | `e5fa9ae8-d6e7-4f0e-abec-7adbf3807e3c` | `/api/health` 200、私有接口 401 |
| 5 | me | `d2cd7b02-c064-4f85-8281-bd64d346502a` | `/api/health` 200、`sso_ready=true` |
| 6 | health-api | `04b34fe6-7e12-4bc6-99aa-0df482d60829` | `check:api` 全过（build 精确匹配、旧 MCP/OAuth 404） |
| 7 | mcp | `ca619ece-4562-4a41-b417-b02f3b7f706b` | `check:live` 5 项通过；`http://mcp.codepi.app/` 实测返回 503 `canonical_origin_required` |
| 8 | health-web | `30557e8d-ed1f-4400-8709-c5d1e6d2ed4c` | `check:branding` 通过 |
| 9 | ops | `bbdad4c3-8268-4178-a1b1-7dc86e33ad32` | 无公网入口；云端 monitor 05:30/06:00 两周期 complete（见后续复核） |

发布后本地巡检 `production-monitor.mjs --require-d1 --require-versions` 31/31 全部通过（9 个版本漂移项转 PASS）。逐服务 JSONL 证据：Git 外 `codepi-deployment-evidence-20261022.jsonl`。

## 2026-10-22 后续复核与补发

1. **首轮云端复核（05:00 前）仍为红**：等待期间另一会话合并 PR #147（Health 同步批处理）并从
   `120a8279231d` 发布了 Health；其变更按保守依赖映射波及 MCP，巡检剩余 1 项失败
   （`codepi-mcp` 漂移）。该会话清理了本会话的发布锁与发布 worktree；锁空闲后本会话重新获取，
   从 `120a8279231d` 补发 MCP（version `5720186a-bd73-420a-bf55-18dda2236f4f`，check:live 通过）。
2. **5xx 响应同样建 Issue**：`canonical_origin_required` 的 503 仍触发 `HttpServerError` issue
   （10-22 04:16 occurrence 实测）。改为 403（PR #149），从 `a49ba23db7b1fcc79a549e944914d3198c96b98c`
   发布 MCP version `294bdd1f-ad61-4913-ab88-85ed5fe8ec49`；`http://mcp.codepi.app/` 实测返回
   403 `canonical_origin_required`，仅 warn 日志。
3. **WAF 规则扩展**：复核发现 `/.aws/credentials` 与双重编码 `/%2f%2eenv` 绕过首版规则；
   规则增加 `/.aws` 与 `url_decode(path) contains "/.env"`，两路径实测边缘 403。
4. **最终状态**：云端 monitor 05:30、06:00 两个实例 complete；本地巡检 32/32 通过
   （main=`a49ba23db7b1`）；`codepi-ops` AssertionError、`codepi-mcp` HttpServerError 与两个
   复发的 security issue 全部 resolved，账户无 active issue。

## 剩余风险

- Always Use HTTPS 未开启（当前 token 无 Zone Settings Write），明文探测仍会到达 Worker 并返回
  4xx/403，不产生 Issue；建议用户在 Dashboard（SSL/TLS → Edge Certificates）手动开启。
- 扫描器若改用本规则未覆盖的路径族，会产生新的 security issue 邮件；按 occurrence 路径扩充
  WAF 表达式即可，规则维护在登记表 `waf-block-scanner-paths`。
- 真实登录、Oura 同步、MCP 真实客户端调用未在本轮重新验收（无相关代码变更；SSO/凭证未改动）。

## 证据

Git 外：`/Users/codepi/.local/state/kdp.cool/operations/2026-10-22-cloudflare-alert-tuning/`，含通知历史三页（211 条）、issues/automations 快照、发布前后版本清单、deployment evidence JSONL。
