# Cloudflare 资源登记表

账户：`Kedoupi`（`69f1de4c8f3c7411593613711207e7b3`）。本表是版本化登记记录；
实时状态以当次 Cloudflare 控制面核实为准。治理规则见 [cloudflare-governance.md](./cloudflare-governance.md)。

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
| pages-www | production | pages | codepi-www | kedoupi | 首页与 Desk 摘要 | private-user-data(desk) | 终端用户 | codepi.app, www.codepi.app | web/wrangler.toml | managed | 2026-10-16 |
| pages-gu | production | pages | codepi-gu | kedoupi | 投资追踪 GU | private-user-data | 终端用户 | gu.codepi.app | gu/wrangler.toml | managed | 2026-10-16 |
| pages-gzh | production | pages | codepi-gzh | kedoupi | 发稿台 GZH | private-user-data | 终端用户 | gzh.codepi.app | gzh/wrangler.toml | managed | 2026-10-16 |
| pages-health | production | pages | codepi-health | kedoupi | Health 前端 | private-health-data | 终端用户 | health.codepi.app | oura/apps/web/wrangler.toml | managed | 2026-10-16 |
| worker-auth | production | worker | codepi-auth | kedoupi | 中央 SSO/OTP 认证 | auth-session-data | Pages、worker-health-api | auth.codepi.app (custom domain), cron 17 3 * * * | auth/wrangler.jsonc | managed | 2026-10-16 |
| worker-health-api | production | worker | codepi-health-api | kedoupi | Health API / MCP / OAuth discovery | private-health-data | pages-health, MCP 客户端 | health.codepi.app/api/*, /mcp, /oauth*, /.well-known* | oura/workers/api/wrangler.toml | managed | 2026-10-16 |
| d1-auth | production | d1 | codepi-auth (ecc90eed-e9ff-459d-99aa-4e7f4c6d6ef1) | kedoupi | 认证会话与用户 | auth-session-data | worker-auth | - | auth/wrangler.jsonc | managed | 2026-10-16 |
| d1-desk | production | d1 | codepi-desk (adfb0f6e-b776-471b-9f25-71982b53cbc4) | kedoupi | Desk 摘要数据 | private-user-data | pages-www | - | web/wrangler.toml | managed | 2026-10-16 |
| d1-gu | production | d1 | codepi-gu (4d3b6713-85dd-4f61-ac55-9925db72394b) | kedoupi | GU 投资数据 | private-user-data | pages-gu | - | gu/wrangler.toml | managed | 2026-10-16 |
| d1-gzh | production | d1 | codepi-gzh (acedb64c-d374-4e40-b61e-7df7f0766694) | kedoupi | GZH 稿件数据 | private-user-data | pages-gzh | - | gzh/wrangler.toml | managed | 2026-10-16 |
| d1-health | production | d1 | codepi-health (2e35deaa-8066-49c1-b19a-afcd8706d58c) | kedoupi | Health 数据 | private-health-data | worker-health-api | - | oura/workers/api/wrangler.toml | managed | 2026-10-16 |
| d1-auth-staging | staging | d1 | codepi-auth-staging (fc9c02d7-96e3-48ea-a568-a2362fa198ea) | kedoupi | staging 认证数据（仅 synthetic fixture） | synthetic | worker-auth-staging | - | auth/wrangler.jsonc [env.staging] | managed | 2026-10-16 |
| d1-desk-staging | staging | d1 | codepi-desk-staging (cbbe0037-4132-4ec2-bf6b-2c1ff4363977) | kedoupi | staging Desk 数据（仅 synthetic fixture） | synthetic | pages-www preview | - | web/wrangler.toml [env.preview] | managed | 2026-10-16 |
| d1-gu-staging | staging | d1 | codepi-gu-staging (86d7d48c-ef12-4cd6-932c-38c0a53bcded) | kedoupi | staging GU 数据（仅 synthetic fixture） | synthetic | pages-gu preview | - | gu/wrangler.toml [env.preview] | managed | 2026-10-16 |
| d1-gzh-staging | staging | d1 | codepi-gzh-staging (1a57d7d8-6d16-4f16-b9f6-b78f78b714ab) | kedoupi | staging GZH 数据（0001–0004 migration 与既有 demo seed） | synthetic | pages-gzh preview（配置已更新；上传待 release gate） | - | gzh/wrangler.toml [env.preview]、Pages preview DB PATCH | managed | 2026-10-16 |
| d1-health-staging | staging | d1 | codepi-health-staging (36430305-83df-4af6-961f-64abedca02fe) | kedoupi | staging Health 数据（仅 synthetic fixture） | synthetic | worker-health-api-staging | - | oura/workers/api/wrangler.toml [env.staging] | managed | 2026-10-16 |
| worker-auth-staging | staging | worker | codepi-auth-staging | kedoupi | staging SSO/OTP 认证 | synthetic | staging Pages、worker-health-api-staging | auth-staging.codepi.app (custom domain), cron 17 3 * * * | auth/wrangler.jsonc [env.staging] | managed | 2026-10-16 |
| worker-health-api-staging | staging | worker | codepi-health-api-staging | kedoupi | staging Health API | synthetic | pages-health preview | health-staging.codepi.app/api/*, /mcp, /oauth*, /.well-known* | oura/workers/api/wrangler.toml [env.staging] | managed | 2026-10-16 |
| pages-www-staging-host | staging | pages-domain | staging.codepi.app → staging.codepi-www.pages.dev | kedoupi | staging 首页/Desk 域名（branch alias） | synthetic | staging 访问者 | staging.codepi.app | Cloudflare 控制面 | managed | 2026-10-16 |
| pages-gu-staging-host | staging | pages-domain | gu-staging.codepi.app → staging.codepi-gu.pages.dev | kedoupi | staging GU 域名（branch alias） | synthetic | staging 访问者 | gu-staging.codepi.app | Cloudflare 控制面 | managed | 2026-10-16 |
| pages-gzh-staging-host | staging | pages-domain | gzh-staging.codepi.app → staging.codepi-gzh.pages.dev | kedoupi | staging GZH 域名（branch alias） | synthetic | staging 访问者 | gzh-staging.codepi.app | Cloudflare 控制面 | managed | 2026-10-16 |
| pages-health-staging-host | staging | pages-domain | health-staging.codepi.app → staging.codepi-health.pages.dev | kedoupi | staging Health 域名（branch alias） | synthetic | staging 访问者 | health-staging.codepi.app | Cloudflare 控制面 | managed | 2026-10-16 |
| d1-health-preview | staging | d1 | codepi-health-preview (4a4ce46a-ff7e-4eda-b9f0-e0691b45e30b) | kedoupi | 早期 Health preview 库 | legacy | 无 | - | 历史配置 | legacy-preview | 2026-10-16 |
| worker-wechat-proxy | production | worker | wechat-proxy | kedoupi | 微信代理（不在本仓库） | unknown | 未审计 | - | 不在本仓库 | unknown | 2026-10-16 |
| kv-covers | production | kv | COVERS (4cbe9ae8f79e41bda85fa5bc391a77a4) | kedoupi | 未知（不在本仓库） | unknown | 未审计 | - | 不在本仓库 | unknown | 2026-10-16 |
| r2-sub2api-backups | production | r2 | sub2api-backups | kedoupi | 备份（不在本仓库） | unknown | 未审计 | - | 不在本仓库 | unknown | 2026-10-16 |
| tunnel-kdpmini | production | tunnel | kdpmini (1e1bfb4f-2b1b-4ede-8ce6-ef38d2487fbb) | kedoupi | 未审计 Tunnel | unknown | 未审计 | - | Cloudflare 控制面 | unknown | 2026-10-16 |
| tunnel-voyracloud | production | tunnel | voyracloud (193a7c34-81b4-4c50-87fd-0700faf07033) | kedoupi | 未审计 Tunnel | unknown | 未审计 | - | Cloudflare 控制面 | unknown | 2026-10-16 |
| tunnel-duoji-mini | production | tunnel | duoji_mini (5e9e0d79-e706-4619-b547-97b09aca5ce7) | kedoupi | 未审计 Tunnel | unknown | 未审计 | - | Cloudflare 控制面 | unknown | 2026-10-16 |
| tunnel-grok-bot | production | tunnel | grok-bot (2a6e4216-a1c4-41de-ad9c-74aed1883563) | kedoupi | 未审计 Tunnel | unknown | 未审计 | - | Cloudflare 控制面 | unknown | 2026-10-16 |
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
