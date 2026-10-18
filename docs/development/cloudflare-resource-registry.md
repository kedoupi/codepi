# Cloudflare 资源登记表
2026-10-18 平台可靠性落地：旧 CloudBase 匿名泄漏路由 `api.xiaotaozi.cc/oura/daily`
已通过 CloudBase `ModifyHTTPServiceRoute` 置 `Enable=false` 并核实匿名请求返回 403，
其余路由不受影响。新增两条 Cloudflare 通知策略（`incident_alert`、
`workers_observability_real_time_issue`，均走账户邮箱机制）并登记于下表。
全部 6 个生产 Worker 已通过控制面 API 开启持久化调用日志并脱敏查询串，已查到
Health cron 的实际执行日志；相同配置写入 Wrangler 并由治理守门强制。
新增 `.github/workflows/production-monitor.yml`（30 分钟只读巡检）与
`.github/workflows/d1-backup.yml`（每日导出 5 个生产 D1，经 gzip/AES-256-GCM 与
RSA 公钥封装后保存为 GitHub Actions artifact，14 天到期删除）。
两者复用 production Environment 已有凭证；首次备份 run `39090056809` 已成功，
artifact 中五个库均通过完整性与私钥内存解密验证。巡检 run `39090056823`
如实报出 Health 同步不新鲜，故障恢复仍待验收。
Health API compatibility_date 已由 2025-01-01 升至 2026-10-15，
PR #81 发布后经控制面核实。备份/恢复约定及私钥保管见
[cloudflare-backup-restore.md](./cloudflare-backup-restore.md)，本轮格式的恢复演练和
验证边界见 [任务记录](tasks/2026-10-18-platform-reliability.md)。GU 迁移文件双 0002
与 git 历史中的真实数据按既定决策保留，迁移追加守门 `check-migrations.mjs`
仅容许原来的两个文件，不容许增加第三个同编号文件。
新格式恢复演练已通过：临时 D1 `codepi-health-pr-81`
（`7685ecb8-fa28-4a4a-81bb-743b1c1e97d4`，synthetic，期限 2026-10-18）
恢复 2 条合成记录并校验；非空目标再次导入被拒绝。演练后已删除该库，账户 D1
列表复查仅剩原来的五个生产库。PR #81 / #91 已合并并发布；
恢复私钥异机或离线保管仍待所有者完成。

2026-10-18 staging 全面退役与前端代理清理：仓库内全部 `[env.staging]` 配置已移除
（www/gu/gzh/auth/health-api/health-pages），治理守门改为 fail-closed 拒绝任何 staging
段、staging 主机或 `-staging` 资源名。云端同步删除：`codepi-auth-staging` 与
`codepi-health-api-staging` Workers、5 个 `-staging` D1 与 `codepi-health-preview`、
`auth-staging.codepi.app` workers domain，以及 zone 内残留的 8 条指向
`codepi-health-api(-staging)` 的 routes（zone routes 清零）。`codepi-health` 前端 Worker
绑定收敛为 ASSETS + WORKER（`codepi-health-api`），DB/AUTH/vars 全部移除；生产核验
`/api/health` 200 与 SPA root 200 不受影响；PR #80 合并后生产 build 为 `3a024e95216e`。环境模型收敛为
local + production 两档。staging D1 仅含 synthetic fixture，无真实数据损失。

2026-10-17 首页/Desk 切换完成：`codepi.app` 与 `www.codepi.app` 已由 `codepi-www`
Worker（Static Assets）服务，旧 Pages 正式域名绑定已移除。版本、凭证和域名切换证据见
[首页迁移记录](tasks/2026-10-17-web-static-assets.md)。

2026-10-17 GZH 切换核验：PR #72 合并为 `da06d1d`，main 发布 run `39034618586`
第二次执行成功，GZH Worker version 为 `8c6d3232-edf2-4252-b044-b2c20815ecb3`。
`gzh.codepi.app` 已切换为 Worker custom domain，旧 Pages 正式绑定已移除。
新 Worker 与正式域名的预览鉴权检查、线上资产逐字节比对、中央 Auth callback 检查通过；
完整生产登录、Desk 摘要与稿件流程未验收。staging named environment 未启用，
旧 Pages 项目及其 staging 绑定保留。版本、凭证重建、切换和保留入口的覆盖边界见

2026-10-18 Health 切换核验：PR #77 合并为 `ff6f767`，main 发布使 `codepi-health`
前端 SPA Worker 上线（`/api/health` 报告 `build=ff6f76748489`）。`health.codepi.app`
已切换为 Worker custom domain（`be31f1f926405444ba50479af2d3dfd4cc555568`），
旧 Pages 正式域名绑定已移除，`codepi-health-api` 不再持有公网 routes，API/MCP/OAuth
经前端 Worker 的 WORKER service binding 转发。预切换与正式域名探针通过：root 与 SPA
深链 200 HTML、`/api/me` 200 匿名 JSON、`/mcp` GET 405 JSON、`/.well-known/*` 与
`/well-known/*` 重写 200 JSON。完整生产登录与真实 Oura 同步未验收；staging 域名
`health-staging.codepi.app` 仍绑定旧 Pages，staging named environment 未启用。
[GZH 迁移记录](tasks/2026-10-17-gzh-static-assets.md)。

2026-10-18 旧 Pages 体系退役：四个旧 Pages 项目（`codepi-www`、`codepi-gu`、
`codepi-gzh`、`codepi-health`）连同各自 staging 自定义域名绑定与 zone 内
`staging`/`gu-staging`/`gzh-staging`/`health-staging` 四条 CNAME 已全部删除。
`auth-staging.codepi.app`（AAAA `100::`，`codepi-auth-staging` Worker custom domain）保留。
生产域名核验不受影响：`codepi.app`/`www.codepi.app` 200、`gu.codepi.app`/`gzh.codepi.app`
302、`health.codepi.app` 200、`auth.codepi.app` 根路径 404。staging 域名此后由仓库内
Workers named environment（`codepi-*-staging`）在需要时重新发布绑定；删除前这些 staging
域名指向的旧 Pages 均未启用。

账户：`Kedoupi`（`69f1de4c8f3c7411593613711207e7b3`）。本表是版本化登记记录；
实时状态以当次 Cloudflare 控制面核实为准。治理规则见 [cloudflare-governance.md](./cloudflare-governance.md)。

2026-10-17 GU 配置重建：执行者为当前 Codex，代码基线 `33207cd`。用户明确允许按最终
方案重建旧测试状态，因此通过 API 新生成并配对 GU SSO 与 Desk 摘要凭证，替代恢复旧值
的人工流程；仅失效 GU 的 6 条 SSO 会话与 2 条登录事务，业务数据未改。新 Worker
匿名探针与 2 个资产逐字节比对通过；PR #70 合并为 `953f4ad`，main run `39031855993`
的 GU/Auth/首页发布完成。`gu.codepi.app` 已改为 Worker custom domain，旧 Pages 正式绑定
已移除，staging 绑定和项目保留。范围、版本、验证和未接入的上传/日历见
[GU 运行配置重建](tasks/2026-10-17-gu-runtime-bootstrap.md)。这不是完整登录验收记录。

2026-10-17 Auth Hono 迁移核验：PR #67 合并为 `ad8352202ed406357afd0f3c140a1c84b6e67cf9`，
main 发布 run `39021027068` 的 13 个 job 全部成功。四个 Pages canonical deployment 均为该
干净 SHA；Auth 当前 version 与 CI 发布日志一致，Health API 线上 build 为 `ad8352202ed4`。
三产品 Pages smoke、Auth 5 项无邮件副作用探针与 Health 16 项接口检查通过。六个生产计算
资源的 provider 标识和真实流程未覆盖项见 [Auth Hono 发布记录](tasks/2026-10-17-auth-hono.md)。
本轮未重新审计数据库、staging、DNS 或 unknown 资源；下文 2026-10-16 记录保留为历史证据。

2026-10-17 GU 部署载体迁移登记：GU 从 Pages 项目迁移为 Workers Static Assets 架构的
Worker `codepi-gu`（`pages-gu` → `worker-gu`），staging 承载从 Pages preview 环境迁移为
named environment Worker `codepi-gu-staging`（`worker-gu-staging`，保留未启用、不接发布入口）。
本注记登记的是仓库配置侧的载体决策与治理形态；Worker 的 provider 标识、custom domain
切换结果与线上核验证据见 [GU Static Assets 迁移记录](tasks/2026-10-17-gu-static-assets.md) 及
[配置重建续作](tasks/2026-10-17-gu-runtime-bootstrap.md)。正式域名已切换，旧 Pages 单独登记保留。

2026-10-17 GU Hono 迁移核验：PR #59 合并为 `ffe762e`，main 发布 run `38991512923`
成功；四个 Pages canonical deployment 均为该干净 SHA，Auth / Health API 当前版本已核对。
GU 线上资源逐字节匹配与 10 项路由边界探测、三产品 Pages smoke、Auth health 和 Health
16 项接口检查通过。具体版本及真实账号 E2E 未覆盖范围见
[GU Hono 发布记录](tasks/2026-10-17-gu-hono-router.md)。本轮未重新审计数据库、staging 或 unknown 资源。

2026-10-17 后续核验：`158484c` 的 main 发布 run `38966431148` 成功；四个生产 Pages
均为该干净 SHA，Auth/Health API 的 deployment/version 已核对，匿名 smoke 与 Health
16 项接口检查通过。具体版本与未验收边界见
[shared 严格白名单发布记录](tasks/2026-10-17-shared-strict-exports.md)。
本次只更新六个生产计算资源的核验日期，不表示重新审计了数据库、staging 或 unknown 资源。

2026-10-16 后续核验：workspace 与单主干规则已合并，但 run `38883652043` 的构建失败、
部署跳过；GU 和 Desk 私有接口存在 503。诊断、GU 回退及恢复原版本的操作记录见
[Workspace 发布链修复](tasks/2026-10-16-workspace-release-repair.md)。下文较早的 smoke
结果保留为历史证据，不覆盖后续失败。

字段固定为：`logical_id`、`environment`、`resource_type`、`physical_name`、`owner`、`purpose`、
`data_classification`、`consumers`、`hostname_or_route`、`config_source`、`status`、`last_verified`。
临时资源另填 `expires_on` 与 `cleanup_evidence`。本表只存非敏感元数据：禁止写入 API token、
secret 值、个人数据或 OAuth refresh token。

`status` 取值：
- `managed`：仓库运行配置直接引用、受本治理约束的资源。
- `legacy-preview`：早期 preview 资源，确认无消费者后按退役规则处理。
- `legacy-pending-retirement`：旧体系资源，退役条件见治理文档第 6 节。
- `unknown`：不在当前仓库配置中、归属未确认。禁止重命名、迁移或删除。

## 资源表

<!-- registry-table:begin -->
| logical_id | environment | resource_type | physical_name | owner | purpose | data_classification | consumers | hostname_or_route | config_source | status | last_verified |
|---|---|---|---|---|---|---|---|---|---|---|---|
| zone-codepi-app | production | zone | codepi.app | kedoupi | 主站与产品域名 zone | public-dns | 全部产品 | codepi.app | Cloudflare 控制面 | managed | 2026-10-16 |
| zone-kdp-cool | production | zone | kdp.cool | kedoupi | 历史域名 zone | public-dns | 未审计 | kdp.cool | Cloudflare 控制面 | managed | 2026-10-16 |
| worker-www | production | worker | codepi-www | kedoupi | 首页与 Desk 摘要（已切换，100% 流量） | private-user-data(desk) | 终端用户 | codepi.app, www.codepi.app | apps/web/wrangler.toml | managed | 2026-10-18 |
| pages-www-legacy | production | pages | codepi-www | kedoupi | 旧首页 Pages（项目已删除） | private-user-data(desk) | 无 | - | 历史 Pages 配置 | retired | 2026-10-18 项目与 staging 域名已删除 |
| worker-gu | production | worker | codepi-gu | kedoupi | 投资追踪 GU | private-user-data | 终端用户、worker-www | gu.codepi.app (custom domain), codepi-gu.kedoupi.workers.dev | apps/gu/wrangler.toml、Cloudflare custom domain API | managed | 2026-10-18 |
| pages-gu-legacy | production | pages | codepi-gu | kedoupi | GU 旧 Pages 项目（项目已删除） | private-user-data | 无 | - | 历史 Pages 配置 | retired | 2026-10-18 项目与 staging 域名已删除 |
| worker-gzh | production | worker | codepi-gzh | kedoupi | 发稿台 GZH | private-user-data | 终端用户、worker-www | gzh.codepi.app (custom domain), codepi-gzh.kedoupi.workers.dev | apps/gzh/wrangler.toml、Cloudflare custom domain API | managed | 2026-10-18 |
| pages-gzh-legacy | production | pages | codepi-gzh | kedoupi | GZH 旧 Pages（项目已删除） | private-user-data | 无 | - | 历史 Pages 配置 | retired | 2026-10-18 项目与 staging 域名已删除 |
| worker-health | production | worker | codepi-health | kedoupi | Health 前端 SPA | private-health-data | 终端用户 | health.codepi.app (custom domain), codepi-health.kedoupi.workers.dev | apps/health/apps/web/wrangler.toml、Cloudflare custom domain API | managed | 2026-10-18 |
| pages-health-legacy | production | pages | codepi-health | kedoupi | 旧 Health Pages（项目已删除） | private-health-data | 无 | - | 历史 Pages 配置 | retired | 2026-10-18 项目与 staging 域名已删除 |
| worker-auth | production | worker | codepi-auth | kedoupi | 中央 SSO/OTP 认证 | auth-session-data | Pages、worker-gu、worker-gzh、worker-health-api | auth.codepi.app (custom domain), cron 17 3 * * * | services/auth/wrangler.jsonc | managed | 2026-10-18 |
| worker-health-api | production | worker | codepi-health-api | kedoupi | Health API / MCP / OAuth discovery | private-health-data | worker-health（service binding）、MCP 客户端 | 无公网 routes，经 worker-health service binding 转发 | apps/health/workers/api/wrangler.toml | managed | 2026-10-18 |
| d1-auth | production | d1 | codepi-auth (ecc90eed-e9ff-459d-99aa-4e7f4c6d6ef1) | kedoupi | 认证会话与用户 | auth-session-data | worker-auth | - | services/auth/wrangler.jsonc | managed | 2026-10-18 |
| d1-desk | production | d1 | codepi-desk (adfb0f6e-b776-471b-9f25-71982b53cbc4) | kedoupi | Desk 摘要数据 | private-user-data | worker-www | - | apps/web/wrangler.toml | managed | 2026-10-18 |
| d1-gu | production | d1 | codepi-gu (4d3b6713-85dd-4f61-ac55-9925db72394b) | kedoupi | GU 投资数据 | private-user-data | worker-gu | - | apps/gu/wrangler.toml | managed | 2026-10-18 |
| d1-gzh | production | d1 | codepi-gzh (acedb64c-d374-4e40-b61e-7df7f0766694) | kedoupi | GZH 稿件数据 | private-user-data | worker-gzh | - | apps/gzh/wrangler.toml | managed | 2026-10-18 |
| d1-health | production | d1 | codepi-health (2e35deaa-8066-49c1-b19a-afcd8706d58c) | kedoupi | Health 数据 | private-health-data | worker-health-api | - | apps/health/workers/api/wrangler.toml | managed | 2026-10-18 |
| d1-auth-staging | staging | d1 | codepi-auth-staging (fc9c02d7-96e3-48ea-a568-a2362fa198ea) | kedoupi | staging 认证数据（仅 synthetic fixture） | synthetic | worker-auth-staging | - | retired | 2026-10-18 已删除 | 2026-10-16 |
| d1-desk-staging | staging | d1 | codepi-desk-staging (cbbe0037-4132-4ec2-bf6b-2c1ff4363977) | kedoupi | staging Desk 数据（仅 synthetic fixture） | synthetic | worker-www-staging | - | retired | 2026-10-18 已删除 | 2026-10-16 |
| d1-gu-staging | staging | d1 | codepi-gu-staging (86d7d48c-ef12-4cd6-932c-38c0a53bcded) | kedoupi | staging GU 数据（仅 synthetic fixture） | synthetic | worker-gu-staging | - | retired | 2026-10-18 已删除 | 2026-10-16 |
| worker-gzh-staging | staging | worker | codepi-gzh-staging | kedoupi | staging GZH（配置保留未启用，不接发布入口） | synthetic | staging 访问者 | gzh-staging.codepi.app（待绑定） | retired | 2026-10-18 已删除 | 2026-10-17 |
| d1-gzh-staging | staging | d1 | codepi-gzh-staging (1a57d7d8-6d16-4f16-b9f6-b78f78b714ab) | kedoupi | staging GZH 数据（0001–0004 migration 与既有 demo seed） | synthetic | worker-gzh-staging（配置保留未启用） | - | retired | 2026-10-18 已删除 | 2026-10-16 |
| d1-health-staging | staging | d1 | codepi-health-staging (36430305-83df-4af6-961f-64abedca02fe) | kedoupi | staging Health 数据（仅 synthetic fixture） | synthetic | worker-health-api-staging | - | retired | 2026-10-18 已删除 | 2026-10-16 |
| worker-auth-staging | staging | worker | codepi-auth-staging | kedoupi | staging SSO/OTP 认证 | synthetic | staging Pages、worker-health-api-staging | auth-staging.codepi.app (custom domain), cron 17 3 * * * | retired | 2026-10-18 已删除 | 2026-10-16 |
| worker-www-staging | staging | worker | codepi-www-staging | kedoupi | staging 首页/Desk（配置保留未启用） | synthetic | staging 访问者 | staging.codepi.app（待绑定） | retired | 2026-10-18 已删除 | 2026-10-17 配置登记，未发布 |
| worker-gu-staging | staging | worker | codepi-gu-staging | kedoupi | staging GU（保留未启用，不接发布入口） | synthetic | staging 访问者 | gu-staging.codepi.app（待绑定） | retired | 2026-10-18 已删除 | 2026-10-17 |
| worker-health-staging | staging | worker | codepi-health-staging | kedoupi | staging Health 前端 SPA（配置保留未启用） | synthetic | staging 访问者 | health-staging.codepi.app (custom domain, 待绑定) | retired | 2026-10-18 已删除 | 2026-10-18 配置登记，未发布 |
| worker-health-api-staging | staging | worker | codepi-health-api-staging | kedoupi | staging Health API | synthetic | worker-health-staging（service binding） | 无公网 routes，经 worker-health-staging service binding 转发 | retired | 2026-10-18 已删除 | 2026-10-16 |
| pages-www-staging-host | staging | pages-domain | staging.codepi.app → staging.codepi-www.pages.dev | kedoupi | staging 首页/Desk 域名（已随旧 Pages 项目删除） | synthetic | 无 | - | 历史 Pages 配置 | retired | 2026-10-18 域名绑定与 DNS 已删除 |
| pages-gu-staging-host | staging | pages-domain | gu-staging.codepi.app → staging.codepi-gu.pages.dev | kedoupi | staging GU 域名（已随旧 Pages 项目删除） | synthetic | 无 | - | 历史 Pages 配置 | retired | 2026-10-18 域名绑定与 DNS 已删除 |
| pages-gzh-staging-host | staging | pages-domain | gzh-staging.codepi.app → staging.codepi-gzh.pages.dev | kedoupi | staging GZH 域名（已随旧 Pages 项目删除） | synthetic | 无 | - | 历史 Pages 配置 | retired | 2026-10-18 域名绑定与 DNS 已删除 |
| pages-health-staging-host | staging | pages-domain | health-staging.codepi.app → staging.codepi-health.pages.dev | kedoupi | staging Health 域名（已随旧 Pages 项目删除） | synthetic | 无 | - | 历史 Pages 配置 | retired | 2026-10-18 域名绑定与 DNS 已删除 |
| d1-health-preview | staging | d1 | codepi-health-preview (4a4ce46a-ff7e-4eda-b9f0-e0691b45e30b) | kedoupi | 早期 Health preview 库 | legacy | 无 | - | retired | 2026-10-18 已删除 | 2026-10-16 |
| worker-wechat-proxy | production | worker | wechat-proxy | kedoupi | 微信代理（不在本仓库） | unknown | 未审计 | - | 不在本仓库 | unknown | 2026-10-16 |
| kv-covers | production | kv | COVERS (4cbe9ae8f79e41bda85fa5bc391a77a4) | kedoupi | 未知（不在本仓库） | unknown | 未审计 | - | 不在本仓库 | unknown | 2026-10-16 |
| r2-sub2api-backups | production | r2 | sub2api-backups | kedoupi | 备份（不在本仓库） | unknown | 未审计 | - | 不在本仓库 | unknown | 2026-10-16 |
| tunnel-kdpmini | production | tunnel | kdpmini (1e1bfb4f-2b1b-4ede-8ce6-ef38d2487fbb) | kedoupi | 未审计 Tunnel | unknown | 未审计 | - | Cloudflare 控制面 | unknown | 2026-10-16 |
| tunnel-voyracloud | production | tunnel | voyracloud (193a7c34-81b4-4c50-87fd-0700faf07033) | kedoupi | 未审计 Tunnel | unknown | 未审计 | - | Cloudflare 控制面 | unknown | 2026-10-16 |
| tunnel-duoji-mini | production | tunnel | duoji_mini (5e9e0d79-e706-4619-b547-97b09aca5ce7) | kedoupi | 未审计 Tunnel | unknown | 未审计 | - | Cloudflare 控制面 | unknown | 2026-10-16 |
| tunnel-grok-bot | production | tunnel | grok-bot (2a6e4216-a1c4-41de-ad9c-74aed1883563) | kedoupi | 未审计 Tunnel | unknown | 未审计 | - | Cloudflare 控制面 | unknown | 2026-10-16 |
| alert-platform-incident | production | notification-policy | kdp platform incident (11766abf994c4e61adf7d19e7b956697) | kedoupi | Cloudflare 事件告警（走账户邮箱） | n/a | 全部产品 | - | Cloudflare 控制面 API | managed | 2026-10-18 |
| alert-workers-observability | production | notification-policy | kdp workers observability issues (68eee86535f549a384704c8e69887244) | kedoupi | Workers 实时问题告警（走账户邮箱） | n/a | 全部生产 Worker | - | Cloudflare 控制面 API | managed | 2026-10-18 |
| backup-d1-artifact | production | actions-artifact | kedoupi/kdp.cool: d1-backup-<run-id>-<attempt> | kedoupi | 5 个生产 D1 的公钥封装加密日备（14 天到期删除） | encrypted-dump | 恢复 runbook | - | .github/workflows/d1-backup.yml | managed | 2026-10-18 run 39090056809 / artifact 12122019076 经 GitHub connector 下载；zip API digest、五库 manifest 字节数/sha256、key_id 与 GCM AAD 验证及私钥内存解密全部通过；仅密文存于仓库外，私钥异机托管仍未验证 |
| dns-proxy001 | production | dns | proxy001.kdp.cool A 47.254.89.111 | kedoupi | 外部代理（不在本仓库） | unknown | 未审计 | proxy001.kdp.cool | Cloudflare 控制面 | unknown | 2026-10-15 |
| dns-proxy | production | dns | proxy.kdp.cool A 216.132.133.253 | kedoupi | 外部代理（不在本仓库） | unknown | 未审计 | proxy.kdp.cool | Cloudflare 控制面 | unknown | 2026-10-15 |
| dns-rsend | production | dns | rsend/send.kdp.cool CNAME *.forge.rmta.net | kedoupi | 邮件发送域 | unknown | 邮件投递 | rsend.kdp.cool, send.kdp.cool | Cloudflare 控制面 | unknown | 2026-10-15 |
| dns-xui001 | production | dns | xui001.kdp.cool CNAME 67833ac4-b573-4b6f-b7c8-9ae51edd5181.cfargotunnel.com | kedoupi | 未登记 Tunnel 的 CNAME | unknown | 未审计 | xui001.kdp.cool | Cloudflare 控制面 | unknown | 2026-10-16 |
<!-- registry-table:end -->

## 2026-10-16 只读盘点

盘点使用分页 MCP `GET` 端点，只读取控制面及公开路由元数据：未读取 D1 业务内容、
secret 值、邮件、OAuth 或私人业务数据。每个分页端点均读取总元数据或其空的末页。

| 资源类型 | 盘点结果 |
|---|---|
| Pages | 4：`codepi-www`、`codepi-gu`、`codepi-gzh`、`codepi-health`；全部 `source=null`、`production_branch=main`，未发现 Git 自动部署 source |
| Workers | 5：`codepi-auth`、`codepi-auth-staging`、`codepi-health-api`、`codepi-health-api-staging`、`wechat-proxy` |
| D1 | 11：5 production、5 staging 与 `codepi-health-preview`；旧 GZH staging ID `5162…` 不存在，`GET` 返回 7404 |
| KV / R2 / Queue / Durable Object | 1 `COVERS` / 1 `sub2api-backups` / 0 / 0 |
| Tunnel | 4；详情均保留为 `unknown`，未作变更 |
| DNS | `codepi.app` 16 条、`kdp.cool` 20 条；仅导出公开路由元数据 |

所有 5 个 production Pages hostname 与 4 个 staging Pages hostname 均为 `active`；
production CNAME 精确指向相应 `codepi-*.pages.dev`，staging CNAME 指向
`staging.codepi-*.pages.dev`。`auth.codepi.app` 与 `auth-staging.codepi.app` 分别绑定
其同名逻辑 Worker；控制面的 Worker `environment=production` 是 provider service
environment 标签，并非错误的逻辑环境目标。

新建并授权的 `codepi-gzh-staging`（`1a57d7d8-6d16-4f16-b9f6-b78f78b714ab`）已应用
`0001`–`0004` migration（包括既有 demo seed）；`wrangler d1 migrations list --env preview
--remote` 报告 `No migrations to apply`。`gzh/wrangler.toml` 与 Pages project preview DB
设置均已更新为该 ID，production `acedb64c-…` 未变；尚未上传新的 staging Pages deployment，
须经 release gate，不能据此断言现有部署已经切换 UUID。

### 生产部署元数据（历史漂移证据，不是新 workflow 成功证明）

Pages 的 canonical deployment 都是 direct upload，且 `ad_hoc`、`commit_dirty=true`。
因此 reported commit 不能绑定为干净的 source SHA，也不能作为新发布 workflow 的证据。

| Pages 项目 | deployment ID | reported commit | provider URL |
|---|---|---|---|
| `codepi-www` | `3f902dd6-798d-4098-85c3-efd072ff45f8` | `3899850f30346adcae96ce7ef17d4544d623d11a` | `https://3f902dd6.codepi-www.pages.dev` |
| `codepi-gu` | `824ee45a-65e9-4b2a-84ea-03a6f1da3fec` | `3899850f30346adcae96ce7ef17d4544d623d11a` | `https://824ee45a.codepi-gu.pages.dev` |
| `codepi-gzh` | `b450cf99-3b8a-47f2-aa5c-08b2af7b4e28` | `7701511b66cdb8b5c7547d0944601d8a3b64abc1` | `https://b450cf99.codepi-gzh.pages.dev` |
| `codepi-health` | `e1569fbe-7019-489c-b92b-01ff6d597b13` | `3899850f30346adcae96ce7ef17d4544d623d11a` | `https://e1569fbe.codepi-health.pages.dev` |

| Worker | deployment ID | current version ID | traffic | source / Cron |
|---|---|---|---|---|
| `codepi-auth` | `0c013511-2b0d-4a87-a2ac-c22598bb40b9` | `246505bd-ca26-4ddf-a2be-c09ea256f7b3` | 100% | Wrangler; `17 3 * * *` |
| `codepi-auth-staging` | `c826dc36-1653-4249-aa74-7fcf3d4399ba` | `acd44524-27d1-439a-9b4f-fecb760a0e8a` | 100% | Wrangler; `17 3 * * *` |
| `codepi-health-api` | `a94308eb-fa4f-43e7-9cdd-9cf2d2dbc716` | `574ef7fc-6bca-4022-ba50-d881aec1ed2c` | 100% | Wrangler; `*/2 * * * *` |
| `codepi-health-api-staging` | `f8bfec3c-6b2b-4d81-b56a-68be7e736dcf` | `c27c7bac-d752-4b50-9156-c62c684aeb12` | 100% | Wrangler; `*/2 * * * *` |

未确认任一 Worker 的干净 source SHA；Health API `/api/health` 报告 `build=local`，不能将
线上版本绑定到新 SHA。Worker 的 D1 与 `AUTH` bindings 与本表一致；Health Pages 的
`WORKER` 指向同环境 Worker。Health Pages 配置实际以 `apps/web` 为 functions build 目录，
并通过 `../../workers/api/node_modules/.bin/wrangler` 成功编译 Worker；新增跟踪配置尚未远程上传，
provider 当前 runtime 也未报告 `ENVIRONMENT`。

### 可达的 HTTP smoke（匿名，2026-10-16）

| 端点 | 结果 |
|---|---|
| `codepi.app`、`www.codepi.app`、`health.codepi.app` | 200 HTML |
| `gu.codepi.app` | 302 → 同 host `/login` |
| `gzh.codepi.app` | 302 → 同 host `/login?next=%2F` |
| `auth.codepi.app/api/health` | 200 JSON |
| `auth-staging.codepi.app/api/health` | 503 JSON |
| `health.codepi.app/api/health`、`/api/me` | 200 JSON（后者为匿名 representation） |
| `health.codepi.app/mcp` | GET 405 JSON；POST 401 JSON metadata challenge |
| Health 两个 `/.well-known/oauth-*` 端点 | 200 JSON，origin 正确 |

以上请求未见 522。`node oura/scripts/check-api.mjs` 的 16 个 probes 全部通过：匿名私有
API 为 401、网站 SSO redirect 正确、MCP POST 返回 401 metadata challenge，两个 discovery
端点为正确 origin。没有凭证，故登录、callback 与登出完整 E2E **未通过也未声称通过**。

## 阻断、边界与退役

| 项目 | 当前事实 / 可达工作 | 阻断或未证实部分 |
|---|---|---|
| staging Auth | 仅有 `OTP_PEPPER`、`SESSION_SECRET`、`SSO_CLIENTS` secret 名；503 JSON 与缺失配置一致 | `OWNER_EMAIL`、`OTP_FROM`、`RESEND_API_KEY` 未提供；用户选择保留阻断 |
| 发布预检 | standalone `staging-auth-preflight` 已成为全部 6 个 staging deploy job（含 single-app）的 mandatory `needs`，且要求 result 为 success；以环境凭证作 metadata-only shell 实测因缺 `OWNER_EMAIL` 退出 1，发生在任何 mutation 前 | 未运行 release workflow、未发布计算部署；仅对替代 GZH staging D1 应用 migration（如上） |
| staging Access | Access `GET apps` 为空 | 未提供 required owner identity，不能创建 policy |
| GitHub Environments | `gh` 返回 401 | approval 与 scoped credential 尚未验证 |
| legacy callbacks | `kdp.cool` callback 保留至 2026-10-29 | 到期前不可删除；仍须确认旧 DNS/custom domain、真实流量与消费者为零 |

本次未作 production mutation 或数据删除。盘点中旧 compute 资源已不存在；历史删除记录
`7701511` 来自其他会话，但不构成退役窗口、消费者为零或同路径 smoke 等先决条件已经验证
的声明。`unknown`（包括 `xui001.kdp.cool` 指向的非现存 Tunnel ID）不得重命名、迁移或删除。
