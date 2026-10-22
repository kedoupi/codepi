# Cloudflare 告警优化与漂移发布
- 状态：已完成并闭环。云端 monitor 连续 complete、零 active issue；九库加密备份回执通过；流量监控两项检查已上线并在生产 PASS；Health 间歇 500 已修复发布；TLS 1.2/Full Strict/Always Use HTTPS 生效。
- 日期与执行人：2026-10-22，omp 会话。注意：当日另一会话并行开发并合并了 PR #147/#152/#153/#155 等并自行发布了部分 Worker（www/mcp、health 首轮）；本会话负责告警治理与其余 Worker 的漂移发布，冲突点见第二、三轮复核。
- 基线：开发基线 `57318989b37e3e1bdf2c80fe11231f7d9959c979`；发布源码 `6cf89f57849b6c0a495e6cd1b7a22c0f2fc08851`（PR #145 squash 合并后的远程 main，发布时经 `git ls-remote` 实时核对一致）。
- worktree：开发 `<workspace>/orca/workspaces/kdp.cool/cloudflare告警优化`（分支 `kedoupi/cloudflare告警优化`）；发布 `<workspace>/.worktrees/kdp.cool/release-alert-optimization`（detached HEAD，干净且等于远程 main）。主 checkout `<workspace>/Coding/kdp.cool` 存在用户未提交改动，未触碰。
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

1. **WAF 自定义规则**（zone `codepi.app` `268a0acf9bae4e2e2cbc4d8a0ba2c342`）：ruleset `8cc34f9e40d54621aff068b2ee37dd9b`，规则 `9d1cf91b6e6e49679e627fd1c3be7d6d`，action=block，覆盖 `/.git`、`/.env`、`/.svn`、`/.aws`、`phpinfo`、`.php`、`/wp-`、`wp-includes`、`/wordpress/`、`/_profiler`、`/actuator/`、`/telescope/`、`/debug/`、`trace.axd` 及 url_decode 后的 `/.git`、`/.env`（编码变体）。路径清单来自 security issue 的实际 occurrence 采样及复核补漏。验证：`/.git/config`、`/wp-admin/setup.php`、`/api/.env`、`/phpinfo.php`、`/.aws/credentials`、`/%2f%2eenv` 均边缘 403；`/`、`/about/`、MCP 两个 `/.well-known/*` 与 `/api/health` 均 200。
2. **incident 通知策略删除**：`11766abf994c4e61adf7d19e7b956697`（kdp platform incident）已 DELETE；剩余策略为预算告警与 Workers Issues 策略。PUT 更新因账户掩码邮箱目的地 ID 不可得（`Invalid recipient`），删除经用户授权；如需恢复在 Dashboard 重建即可。
3. **Issues 清理**：38 个 security issue、`codepi-mcp` 的 `mcp_not_configured`/HttpServerError issue、`codepi-ops` 巡检断言 issue 及两个复发 security issue 均已通过 API 标为 resolved；2026-10-22 07:35 复读账户无 active issue。
4. **Always Use HTTPS**：2026-10-22 08:02 UTC 由用户在 Dashboard 手动开启（当前 API token 无 Zone Settings Write）；控制面复读 `always_use_https=on`，`http://codepi.app/` 与 `http://mcp.codepi.app/` 实测边缘 301 到 https。

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
4. **第一轮转绿（06:00）后被后续合并打破**：云端 monitor 05:30–07:00 连续 4 次 complete；
   `codepi-ops` AssertionError、`codepi-mcp` HttpServerError 与复发的 security issue 全部 resolved。

## 2026-10-22 第二、三轮复核（并行开发期）

5. **巡检 423 修复**：腾讯云 CloudBase 对已停用环境改返回 `423 Locked`，`monitor-core.mjs` 的
   退役路由检查只接受 401/403/404 → 07:30 起每周期失败。按既有契约（任何 2xx 才是泄露）放宽为
   接受任意 4xx/5xx（PR #151，含 423 回归测试），Ops 从 `9a72d9197eb5` 重发
   （version `f4f05e81-9bf6-4353-9c29-0a5cf7ad3f14`）。
6. **并行会话连续合并 #152/#153/#155/b67daa4 产生新漂移**：两轮追逐发布，最终把 project、me、
   health-api、health-web、ops 从 `b67daa4d9684` 重发（health-api `db5a929e-857c-4074-958c-38a3266636e2`、
   health-web `1d4fa24d-666f-413e-a7cb-67dae435fa20`、project `8918641d-43e6-4dfc-b53f-6ad20e90cb4f`、
   me `99197b4f-0ce9-4120-a22e-913965535d77`、ops `195fc485-f559-46e1-8a79-5827275eaf69`，
   auth/gu/gzh 在 `969a58fee701` 已覆盖），逐项 smoke 通过，本地巡检全绿。
7. **WAF 第三轮补漏**：`/credentials.json`（gu/gzh occurrence 实测）加入拦截规则，实测边缘 403，
   两个复发 security issue resolved。
8. **备份覆盖缺口**：PR #152 把 `codepi-blog` 加入 `DATABASE_NAMES`（9 库），而 10-21 的日备只有 8 库，
   两个 backupFreshness 检查失败（「backup database coverage is incomplete」）。经用户确认上线完成后，
   手动触发 backup Workflow 实例 `cf_f2d9614b10ea262003857863bb013cd00b6b38598b7b371973e2f49ca200739b`：
   9 库加密导出（含 codepi-blog）、GU/Me 114 份原件、R2 manifest 与 GitHub 跨平台回执全部成功。
9. **最终状态（10:35 UTC 复核）**：monitor 10:00、10:30 两周期 complete；09:40 后零告警邮件；
   `codepi-ops` issue resolved；账户无 active issue。教训：开发活跃期合并共享代码即产生漂移告警，
   应由同一发布者随合并节奏发布，或接受巡检红到下次发布。

## 2026-10-22 下午：流量监控上线与 Health 500 修复

10. **流量监控上线（PR #157）**：ops 30 分钟 monitor 新增 `zone traffic threats exceed threshold` 与
    `zone traffic requests surge` 两项检查：GraphQL `httpRequests1hGroups` 按 UTC 整小时采样
    （最近 2 小时窗口 upsert），基线存 `reports/traffic/samples.json`（7 天滚动、ETag 条件写、
    损坏 fail-closed），冷启动 <24h 样本仅用绝对阈值（threats 25/h、requests 1000/h）。
    `codepi-ops-runtime` token 的 Zone Analytics Read 最终经 Account API Tokens API 直接写入
    （Dashboard 用户令牌与账户令牌混淆两轮未果）；16:33 手动 monitor 实例验证两项 PASS
    （threats 9/h、requests 749/h），基线开始累积。审查中拦截初版实现两处缺陷：backupFreshness
    被替换（已恢复并加钉线测试）、R2 读取误用无 body 的 `bucket.head()`（改 `get()`）。
11. **Health /api/me 间歇 500（PR #160）**：D1 平台瞬时错误直达处理器且全库零重试。
    新增 `withD1Retry`（仅瞬时错误重试一次、150ms 退避、配额/约束类确定性错误不重试），
    覆盖 session/locale/connection/sync-state/lease 路径；Health API `100efebf`、
    前端 `ad4586bd`、MCP `fb3a2eca` 从 `5719487ed1be` 发布，check:api/check:branding/check:live
    与本地巡检全绿，两个 Health 500 issue 已 resolve。
12. **TLS/SSL 加固（用户 Dashboard）**：Minimum TLS Version 1.2、加密模式 Full (Strict)、
    Always Use HTTPS 均经控制面复读生效。

## 剩余风险

- Always Use HTTPS 已开启（2026-10-22 08:02 UTC，用户 Dashboard 操作；控制面 `always_use_https=on` 与边缘 301 均已复读），明文探测不再到达 Worker。
- 扫描器若改用本规则未覆盖的路径族，会产生新的 security issue 邮件；按 occurrence 路径扩充
  WAF 表达式即可，规则维护在登记表 `waf-block-scanner-paths`。
- 真实登录、Oura 同步、MCP 真实客户端调用未在本轮重新验收（无相关代码变更；SSO/凭证未改动）。

## 证据

Git 外：`<workspace>/.local/state/kdp.cool/operations/2026-10-22-cloudflare-alert-tuning/`，含通知历史三页（211 条）、issues/automations 快照、发布前后版本清单、deployment evidence JSONL。
