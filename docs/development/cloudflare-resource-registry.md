# Cloudflare 资源登记表

账户：`Kedoupi`（`69f1de4c8f3c7411593613711207e7b3`）。本表是唯一资源事实来源；
治理规则见 [cloudflare-governance.md](./cloudflare-governance.md)。

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
| zone-codepi-app | production | zone | codepi.app | kedoupi | 主站与产品域名 zone | public-dns | 全部产品 | codepi.app | Cloudflare 控制面 | managed | 2026-10-15 |
| zone-kdp-cool | production | zone | kdp.cool | kedoupi | 旧站域名 zone（含邮件 MX/DKIM 与隧道 CNAME） | public-dns | 邮件投递、wechat-proxy、Tunnel | kdp.cool | Cloudflare 控制面 | managed | 2026-10-15 |
| pages-www | production | pages | codepi-www | kedoupi | 首页与 Desk 摘要 | private-user-data(desk) | 终端用户 | codepi.app, www.codepi.app | web/wrangler.toml | managed | 2026-10-15 |
| pages-gu | production | pages | codepi-gu | kedoupi | 投资追踪 GU | private-user-data | 终端用户 | gu.codepi.app | gu/wrangler.toml | managed | 2026-10-15 |
| pages-gzh | production | pages | codepi-gzh | kedoupi | 发稿台 GZH | private-user-data | 终端用户 | gzh.codepi.app | gzh/wrangler.toml | managed | 2026-10-15 |
| pages-health | production | pages | codepi-health | kedoupi | Health 前端 | private-health-data | 终端用户 | health.codepi.app | oura/apps/web（direct upload） | managed | 2026-10-15 |
| worker-auth | production | worker | codepi-auth | kedoupi | 中央 SSO/OTP 认证 | auth-session-data | pages-www, pages-gu, pages-gzh, pages-health, worker-health-api | auth.codepi.app (custom domain), cron 17 3 * * * | auth/wrangler.jsonc | managed | 2026-10-15 |
| worker-health-api | production | worker | codepi-health-api | kedoupi | Health API / MCP / OAuth discovery | private-health-data | pages-health, MCP 客户端 | health.codepi.app/api/*, /mcp, /oauth*, /.well-known* | oura/workers/api/wrangler.toml | managed | 2026-10-15 |
| d1-auth | production | d1 | codepi-auth (ecc90eed-e9ff-459d-99aa-4e7f4c6d6ef1) | kedoupi | 认证会话与用户 | auth-session-data | worker-auth | - | auth/wrangler.jsonc | managed | 2026-10-15 |
| d1-desk | production | d1 | codepi-desk (adfb0f6e-b776-471b-9f25-71982b53cbc4) | kedoupi | Desk 摘要数据 | private-user-data | pages-www | - | web/wrangler.toml | managed | 2026-10-15 |
| d1-gu | production | d1 | codepi-gu (4d3b6713-85dd-4f61-ac55-9925db72394b) | kedoupi | GU 投资数据 | private-user-data | pages-gu | - | gu/wrangler.toml | managed | 2026-10-15 |
| d1-auth-staging | staging | d1 | codepi-auth-staging (fc9c02d7-96e3-48ea-a568-a2362fa198ea) | kedoupi | staging 认证数据（仅 synthetic fixture） | synthetic | worker-auth-staging | - | auth/wrangler.jsonc [env.staging] | managed | 2026-10-15 |
| d1-desk-staging | staging | d1 | codepi-desk-staging (cbbe0037-4132-4ec2-bf6b-2c1ff4363977) | kedoupi | staging Desk 数据（仅 synthetic fixture） | synthetic | pages-www preview | - | web/wrangler.toml [env.preview] | managed | 2026-10-15 |
| d1-gu-staging | staging | d1 | codepi-gu-staging (86d7d48c-ef12-4cd6-932c-38c0a53bcded) | kedoupi | staging GU 数据（仅 synthetic fixture） | synthetic | pages-gu preview | - | gu/wrangler.toml [env.preview] | managed | 2026-10-15 |
| d1-gzh-staging | staging | d1 | codepi-gzh-staging (5162cf66-7bf8-4ba9-9758-5c546e13582f) | kedoupi | staging GZH 数据（migration 自带演示种子） | synthetic | pages-gzh preview | - | gzh/wrangler.toml [env.preview] | managed | 2026-10-15 |
| d1-health-staging | staging | d1 | codepi-health-staging (36430305-83df-4af6-961f-64abedca02fe) | kedoupi | staging Health 数据（仅 synthetic fixture） | synthetic | worker-health-api-staging | - | oura/workers/api/wrangler.toml [env.staging] | managed | 2026-10-15 |
| worker-auth-staging | staging | worker | codepi-auth-staging | kedoupi | staging SSO/OTP 认证 | synthetic | staging Pages, worker-health-api-staging | auth-staging.codepi.app (custom domain), cron 17 3 * * * | auth/wrangler.jsonc [env.staging] | managed | 2026-10-15 |
| worker-health-api-staging | staging | worker | codepi-health-api-staging | kedoupi | staging Health API | synthetic | codepi-health preview | health-staging.codepi.app/api/*, /mcp, /oauth*, /.well-known* | oura/workers/api/wrangler.toml [env.staging] | managed | 2026-10-15 |
| pages-www-staging-host | staging | pages-domain | staging.codepi.app → staging.codepi-www.pages.dev | kedoupi | staging 首页/Desk 域名（branch alias） | synthetic | staging 访问者 | staging.codepi.app | Cloudflare 控制面 | managed | 2026-10-15 |
| pages-gu-staging-host | staging | pages-domain | gu-staging.codepi.app → staging.codepi-gu.pages.dev | kedoupi | staging GU 域名（branch alias） | synthetic | staging 访问者 | gu-staging.codepi.app | Cloudflare 控制面 | managed | 2026-10-15 |
| pages-gzh-staging-host | staging | pages-domain | gzh-staging.codepi.app → staging.codepi-gzh.pages.dev | kedoupi | staging GZH 域名（branch alias） | synthetic | staging 访问者 | gzh-staging.codepi.app | Cloudflare 控制面 | managed | 2026-10-15 |
| pages-health-staging-host | staging | pages-domain | health-staging.codepi.app → staging.codepi-health.pages.dev | kedoupi | staging Health 域名（branch alias） | synthetic | staging 访问者 | health-staging.codepi.app | Cloudflare 控制面 | managed | 2026-10-15 |
| pages-kdp-portal | production | pages | kdp-portal | kedoupi | 旧首页（已退役，待删除） | legacy | 无 | kdp-portal.pages.dev | Cloudflare 控制面 | legacy-pending-retirement | 2026-10-15 |
| pages-gzh-legacy | production | pages | gzh | kedoupi | 旧 GZH 项目（数据已迁出） | legacy | 无 | gzh-8g3.pages.dev | Cloudflare 控制面 | legacy-pending-retirement | 2026-10-15 |
| pages-kdp-gu | production | pages | kdp-gu | kedoupi | 旧 GU 项目 | legacy | 无 | kdp-gu.pages.dev | Cloudflare 控制面 | legacy-pending-retirement | 2026-10-15 |
| pages-oura-kdp | production | pages | oura-kdp | kedoupi | 旧 Health 项目 | legacy | 无 | oura-kdp.pages.dev | Cloudflare 控制面 | legacy-pending-retirement | 2026-10-15 |
| worker-kdp-auth | production | worker | kdp-auth | kedoupi | 旧认证 Worker | legacy | 无（新部署已指向 codepi-auth） | - | Cloudflare 控制面 | legacy-pending-retirement | 2026-10-15 |
| worker-oura-kdp-api | production | worker | oura-kdp-api | kedoupi | 旧 Health API Worker | legacy | 无 | - | Cloudflare 控制面 | legacy-pending-retirement | 2026-10-15 |
| d1-gu-preview | staging | d1 | codepi-gu-preview (2dd4b95a-e3a0-47ce-bda4-0598e523b350) | kedoupi | 早期 GU preview 库 | legacy | 待确认 | - | gu/wrangler.toml 历史版本 | legacy-preview | 2026-10-15 |
| d1-health-preview | staging | d1 | codepi-health-preview (4a4ce46a-ff7e-4eda-b9f0-e0691b45e30b) | kedoupi | 早期 Health preview 库 | legacy | 待确认 | - | 历史配置 | legacy-preview | 2026-10-15 |
| d1-gzh-legacy | production | d1 | gzh (1da81739-fc94-4983-b57d-ebeb5a2100b4) | kedoupi | fagao→gzh 数据迁移回滚副本（18 篇稿件） | private-user-data | 无（回滚副本） | - | 迁移记录 2026-10-15-codepi-cutover.md | legacy-pending-retirement | 2026-10-15 |
| d1-kdp-desk | production | d1 | kdp-desk (6d342a22-edda-4526-9a98-2e68b1b37ee1) | kedoupi | 旧 Desk 库 | private-user-data | 无 | - | Cloudflare 控制面 | legacy-pending-retirement | 2026-10-15 |
| d1-kdp-auth | production | d1 | kdp-auth (2a208e2f-50b5-48be-8cbb-a2893e63c658) | kedoupi | 旧认证库 | auth-session-data | worker-kdp-auth | - | Cloudflare 控制面 | legacy-pending-retirement | 2026-10-15 |
| d1-gu-preview-legacy | staging | d1 | gu-preview (4c62889c-b7d1-4cd9-bd75-f959276cee61) | kedoupi | 旧 GU preview 库 | legacy | 无 | - | Cloudflare 控制面 | legacy-pending-retirement | 2026-10-15 |
| d1-gu-production-legacy | production | d1 | gu-production (8fc889ca-b3e6-493e-90ba-01aa0e1c82da) | kedoupi | 旧 GU 生产库（数据已并入 codepi-gu） | private-user-data | 无 | - | Cloudflare 控制面 | legacy-pending-retirement | 2026-10-15 |
| d1-oura-kdp | production | d1 | oura_kdp (a1a08301-b4f9-4b9c-a1d1-2dd04f9038ab) | kedoupi | 旧 Health 生产库（数据已并入 codepi-health） | private-health-data | 无 | - | Cloudflare 控制面 | legacy-pending-retirement | 2026-10-15 |
| d1-oura-kdp-preview | staging | d1 | oura_kdp_preview (eddce040-a059-44a4-9553-a1b42df81313) | kedoupi | 旧 Health preview 库 | legacy | 无 | - | Cloudflare 控制面 | legacy-pending-retirement | 2026-10-15 |
| d1-fagao | production | d1 | fagao (44beaaee-2cfb-4f04-8c5a-242c03ad816e) | kedoupi | 旧发稿台库（内容已复制到 gzh 库） | private-user-data | 无 | - | Cloudflare 控制面 | legacy-pending-retirement | 2026-10-15 |
| worker-wechat-proxy | production | worker | wechat-proxy | kedoupi | 微信代理（不在本仓库） | unknown | 未审计 | - | 不在本仓库 | unknown | 2026-10-15 |
| kv-covers | production | kv | COVERS (4cbe9ae8f79e41bda85fa5bc391a77a4) | kedoupi | 未知（不在本仓库） | unknown | 未审计 | - | 不在本仓库 | unknown | 2026-10-15 |
| r2-sub2api-backups | production | r2 | sub2api-backups | kedoupi | 备份（不在本仓库） | unknown | 未审计 | - | 不在本仓库 | unknown | 2026-10-15 |
| tunnel-kdpmini | production | tunnel | kdpmini (1e1bfb4f-2b1b-4ede-8ce6-ef38d2487fbb) | kedoupi | kdp.cool 多个子域隧道（healthy） | unknown | coding/h5/html/mp/openclaw/star/workbench.kdp.cool | *.kdp.cool CNAME | Cloudflare 控制面 | unknown | 2026-10-15 |
| tunnel-voyracloud | production | tunnel | voyracloud (193a7c34-81b4-4c50-87fd-0700faf07033) | kedoupi | tzai.kdp.cool 隧道（healthy） | unknown | tzai.kdp.cool | tzai.kdp.cool CNAME | Cloudflare 控制面 | unknown | 2026-10-15 |
| tunnel-duoji-mini | production | tunnel | duoji_mini (5e9e0d79-e706-4619-b547-97b09aca5ce7) | kedoupi | 隧道（down） | unknown | 未审计 | - | Cloudflare 控制面 | unknown | 2026-10-15 |
| tunnel-grok-bot | production | tunnel | grok-bot (2a6e4216-a1c4-41de-ad9c-74aed1883563) | kedoupi | 隧道（down） | unknown | 未审计 | - | Cloudflare 控制面 | unknown | 2026-10-15 |
| dns-proxy001 | production | dns | proxy001.kdp.cool A 47.254.89.111 | kedoupi | 外部代理（不在本仓库） | unknown | 未审计 | proxy001.kdp.cool | Cloudflare 控制面 | unknown | 2026-10-15 |
| dns-proxy | production | dns | proxy.kdp.cool A 216.132.133.253 | kedoupi | 外部代理（不在本仓库） | unknown | 未审计 | proxy.kdp.cool | Cloudflare 控制面 | unknown | 2026-10-15 |
| dns-rsend | production | dns | rsend/send.kdp.cool CNAME *.forge.rmta.net | kedoupi | 邮件发送域 | unknown | 邮件投递 | rsend.kdp.cool, send.kdp.cool | Cloudflare 控制面 | unknown | 2026-10-15 |
<!-- registry-table:end -->

## 已核实的实时状态（2026-10-15 只读盘点）

与历史任务记录相比，以下计划假设已过时，以本次盘点为准：

- `codepi.app` zone 的 CNAME **已**指向 `codepi-www/gu/gzh/health.pages.dev`，不再指旧 Pages。
- `codepi.app`、`www.codepi.app`、`gu.codepi.app`、`gzh.codepi.app`、`health.codepi.app`
  的 Pages custom domain **全部为 active**；线上实测：首页/www/health 返回 200，
  gu/gzh 返回 302 登录跳转，`auth.codepi.app/api/health` 返回 404 JSON，
  `health.codepi.app/.well-known/oauth-protected-resource` 返回 `application/json`。
  **无 522**。
- `auth.codepi.app` 已绑定 `codepi-auth`（Workers custom domain，AAAA 100:: 占位记录）。
- `health.codepi.app/api/*`、`/mcp`、`/oauth*`、`/.well-known*` 四条 route 指向
  `codepi-health-api`。

## 当前异常与修复项

| 异常 | 当前目标 | 实际状态 | 修复负责人 |
|---|---|---|---|
| ~~`gzh/wrangler.toml` `[env.preview]` 的 D1 `database_id` 与生产相同~~ | preview 使用 `codepi-gzh-staging` | **已修复**（2026-10-15）：preview 绑定 `codepi-gzh-staging` | 本计划 Phase 3.5 |
| `deploy-product-apps.yml` GZH job 存在重复 YAML key（`if`/`run` 同 step 两次） | 拆分 build/migrate/deploy/smoke steps | 重复 key 且 dispatch 无 production ref guard | 本计划 Phase 5.1 |
| `kdp-portal` Pages Git 自动部署仍为 enabled | 禁用，仅保留 Actions direct upload | deployments_enabled=true | 本计划 Phase 5.5 |
| ~~staging 环境不存在~~ | 5 个 staging D1 + 2 个 staging Worker + staging 域名 | **已建立**（2026-10-15）：D1 migration 已应用，staging 域名实测 200/302，SSO 跳转指向 auth-staging，生产 Auth 拒绝 staging callback（400） | 本计划 Phase 3 |
| `codepi-auth-staging` 缺 `OWNER_EMAIL`/`OTP_FROM`/`RESEND_API_KEY` secret | staging OTP 登录可用 | worker 已部署但配置校验返回 503；`SESSION_SECRET`/`OTP_PEPPER`/`SSO_CLIENTS` 已独立生成并写入 | kedoupi：`cd auth && npx wrangler secret put <NAME> --env staging`（值不可由 agent 读取或复制） |
| staging 四个域名未挂 Cloudflare Access | 仅 owner 可访问 staging | 公开可访问（staging 仅含 synthetic 数据） | kedoupi：以 owner 邮箱建 Access OTP policy（邮箱不在本仓库，无法代配） |
| 生产 `codepi-auth` 仍登记 `kdp.cool` 旧回调（`SSO_EXTRA_REDIRECT_URIS`） | 回滚窗口结束后撤销 | 保留中 | kedoupi，到期日 2026-10-29，撤销条件：旧 DNS/custom domain 下线且旧域真实流量与消费者为零 |

## 退役规则提醒

- D1/KV/R2 数据删除不与计算资源退役绑定；无单独用户授权不得删除任何数据资源。
- `unknown` 资源不得重命名、迁移或删除。
- 旧 Pages/Worker 退役条件：替代资源 active、同路径 smoke 通过、回滚窗口结束、本表标记无消费者。
