# oura-kdp

Open-source Oura health dashboard for [oura.kdp.cool](https://oura.kdp.cool) — OAuth, sleep / readiness / activity.

未登录是工具落地页（产品标题 + 看板预览 +「用 Oura 登录」）；登录后是完整 Svelte 看板。设计摘要见 [DESIGN.md](./DESIGN.md)。

## Quick start

需要 Node ≥ 20 与 [pnpm](https://pnpm.io/) 9+。

```bash
pnpm i
cp .env.example workers/api/.dev.vars   # placeholders only; never commit real secrets
pnpm dev
```

并行启动：

| 服务 | 地址 | 说明 |
|------|------|------|
| Web (`apps/web`) | http://localhost:5173 | Svelte 5 + Vite：未登录营销首页，登录后看板；`/api` 代理到 Worker |
| API (`workers/api`) | http://localhost:8787 | Cloudflare Worker 本地 + D1 |

也可分开跑：

```bash
pnpm dev:web
pnpm dev:api
```

未配置真实 Oura 密钥时：

- `GET /api/auth/oura/start` 仍 **302** 到真实 Oura authorize URL 形状（`cloud.ouraring.com/oauth/authorize?...`，`client_id` 默认为文档占位 `oura_dev_placeholder_client_id`）
- 生产主机且无 `OURA_CLIENT_ID` → **503**（不会签发假生产 token）
- 本地可用 **DEV 演示登录**（`GET /api/auth/dev/session`）写入 HttpOnly session；`/api/me/daily` 返回 **kedoupi 个人看板真实日数据**（嵌套 `days[]`），不是编造序列

真实 OAuth：在 [Oura applications](https://cloud.ouraring.com/oauth/applications) 创建应用，把 `OURA_CLIENT_ID` / `OURA_CLIENT_SECRET` 写入 `.dev.vars` 或 `wrangler secret put`。callback 用 `TOKEN_ENCRYPTION_KEY` 做 AES-GCM 后把 **refresh_token** 写入 D1；前端永不拿到 token。

## Tonight verify（无真实 Oura 密钥）

```bash
pnpm i
cp .env.example workers/api/.dev.vars
pnpm test && pnpm typecheck
pnpm dev:api    # applies local D1 migrations, then wrangler
# 另一个终端: pnpm dev:web
```

**检查 1 — 登录按钮不是死 stub（authorize URL 形状）**

```bash
curl -sI http://localhost:8787/api/auth/oura/start
# 期望: HTTP 302
# Location: https://cloud.ouraring.com/oauth/authorize?client_id=...&redirect_uri=...&response_type=code&scope=daily+personal+email&state=...
```

浏览器：打开 http://localhost:5173 → 未登录应看到营销首页（hero / 能看到什么 / 登录怎么工作），主按钮是 **「用 Oura 登录」** → 点击后地址栏进入 `cloud.ouraring.com/oauth/authorize?...`。DEV 演示登录只在页脚，不是主 CTA。

**检查 2 — DEV session + `/api/me/daily` 点亮看板**

```bash
curl -sI -c /tmp/oura-cookies -b /tmp/oura-cookies http://localhost:8787/api/auth/dev/session
# 期望: 302 到 http://localhost:5173/?login=dev 且 Set-Cookie: oura_session=...; HttpOnly

curl -s -b /tmp/oura-cookies 'http://localhost:8787/api/me/daily?days=7'
# 期望: 现网个人看板形状
# { ok:true, from, to, count:7, days:[{ date, sleep:{score,contributors}, readiness:{score,temperature_*,contributors}, activity:{score,steps,active_calories}|null }], source:"dev", user_id:"kedoupi" }
# 数字来自 kedoupi 真实样本（例如 2026-09-15 activity.steps=10273），不是正弦波假数据
```

`?days=7|30|90`。bundled 样本是 30 天（2026-08-17 → 2026-09-15）；请求 90 天时不编造额外日期，只返回已有真实行（DEV 运行时会先尝试拉 `api.xiaotaozi.cc/oura/daily?user_id=kedoupi&days=…`）。

浏览器：落地页页脚点 **DEV 演示登录** → 出现睡眠/准备度/活动摘要卡与 7/30/90 趋势图。已登录会跳过落地页，直接进看板。

生产路径（有真实密钥）：落地页 **「用 Oura 登录」** → `/api/auth/oura/start` → Oura 同意 → `/api/auth/oura/callback` 换 token、加密入库、设 session → 回 `/` 后 `/api/me` 已认证 → 现有看板。`/api/me/daily` 用该用户 refresh 拉 `daily_sleep` / `daily_readiness` / `daily_activity`，再经 `pickSleep` / `pickReadiness` / `pickActivity` 收成同一套嵌套 `days[]`。

## Preview（本 PR）

```bash
pnpm i
cp .env.example workers/api/.dev.vars
pnpm test && pnpm typecheck && pnpm build
pnpm dev
```

- 未登录：http://localhost:5173 是工具落地页（H1「Oura 健康看板」+ 运营图），主 CTA 走 `/api/auth/oura/start`
- 运营图：`/marketing/01-hero.png`、`/marketing/02-feature-readiness.png`、`/marketing/03-share-concept.png`
- 已登录（DEV 页脚或真实 OAuth 回调后）：同一地址直接进看板，无落地页
- 预览 Worker 必须 `ALLOW_DEV_LOGIN=1`，页脚才有可用的「DEV 演示登录」；生产 unset/`0`
- `/api/me` 不可达时仍渲染营销页，不出现首屏红色 API 错误，也不提示 pnpm
- 不要把真实 Client ID / Secret 写进 git

## Production secrets（oura.kdp.cool）

在 `workers/api` 里用 [wrangler secret put](https://developers.cloudflare.com/workers/configuration/secrets/) 写入密钥，**不要**写进仓库或 `wrangler.toml`：

```bash
cd workers/api
npx wrangler secret put OURA_CLIENT_ID
npx wrangler secret put OURA_CLIENT_SECRET
npx wrangler secret put TOKEN_ENCRYPTION_KEY
npx wrangler secret put SESSION_SECRET
```

生产 URL（Dashboard 变量或同样 `secret put`，仍不要提交真值）：

```
OURA_REDIRECT_URI=https://oura.kdp.cool/api/auth/oura/callback
FRONTEND_ORIGIN=https://oura.kdp.cool
```

`ALLOW_DEV_LOGIN`：

- **预览 / 测试 Worker**（`*.pages.dev` 若挂了 `/api`）：必须设 `ALLOW_DEV_LOGIN=1`，落地页才会出现「DEV 演示登录」，点击后走 `/api/auth/dev/session` 跳过 OAuth 进看板。
- **生产 oura.kdp.cool**：必须 unset 或 `0`。落地页只保留「用 Oura 登录」。
- 本地 `.dev.vars` 设 `ALLOW_DEV_LOGIN=1`。

Oura 应用里的 Redirect URL 必须与 `OURA_REDIRECT_URI` 完全一致。

前端只在 `/api/me` **明确返回** `allowDevLogin: true` 时显示 DEV 登录 / 「DEV 演示」徽章。纯静态 Pages（没有 Worker `/api`）时 `/api/me` 失败按未登录渲染营销页，不出现红色错误条，也不会出现 DEV 按钮。

## 权限模型 — 摘要 vs 完整解读（无付费）

本产品**不自带付费/订阅**：Stripe Checkout、Customer Portal、webhook 与 DEV 订阅开关
已于 2026-10-15 全部移除，旧路由 `/api/stripe/*`、`/api/dev/subscription` 现在一律返回 `404`。

| 账号 | 能看什么 |
|---|---|
| 任意已登录 Oura 账号 | 日汇总（`/api/me/daily`）、周报摘要前三行、`/api/me/ai` 规则解读、语言偏好 |
| `PERSONAL_OWNER_ID` 对应账号 | 以上全部 + 完整周报建议（`/insights`）+ 完整对比（`/compare`）+ 健康档案同步 + MCP 连接器 |

- 权限只由 `PERSONAL_OWNER_ID` 决定（见 `workers/api/src/lib/capabilities.ts`）。
  历史 `subscriptions` 表仍在库中，但**没有任何代码读它**：写入一行也不会解锁权限。
- 前端 `/api/me` 不再返回 `subscribed` / `subscriptionStatus` / `stripeConfigured` / `priceLabel`，
  `capabilities.billing` 也已删除。
- 语言偏好仍写 D1 `user_prefs`（`workers/api/src/lib/preferences.ts`）+ `localStorage`。
- `migrations/0002_subscriptions.sql` 作为历史 schema 保留（其中 `user_prefs` 仍在使用），
  不要删除或改写；`subscriptions` / `stripe_events` 两张表已无运行时代码使用。

**语言**：整站壳（落地页 + 看板导航 + 解读入口）跟 `navigator.language`：`zh*` → 中文，否则英文。设置里可覆盖并写入 D1 `user_prefs` + `localStorage`。Phase 1 解读**正文模板只有中文**；英文 UI 用壳 + 「Phase 1 insight body is Chinese-only」。

## Cloudflare Pages（`apps/web`）

生产 Pages 必须部署 **Svelte 构建产物**，不要把仓库根目录或旧的 vanilla `index.html`（登录卡片 + DEV 按钮）当作 Pages 根目录。

```bash
pnpm --filter @oura-kdp/web build
```

输出目录：`apps/web/dist`。部署后打开站点应看到营销落地页（H1「Oura 健康看板」+「用 Oura 登录」），不是旧的 login-card HTML。

### API 路由与登录检查

Pages 只托管前端。`oura.kdp.cool/api/*` 必须通过同一 Cloudflare zone 的
Worker Route 指向 `oura-kdp-api`；API 路由、生产回调地址和关闭 DEV 登录的变量
已声明在 `workers/api/wrangler.toml`。前端与 API Worker 分别发布；
`.github/workflows/deploy-product-apps.yml` 现在先测试、检查类型并构建，
再发布 API，通过线上契约检查后才发布前端，最后再检查一次。
PR 只运行验证，不发布。工作流修改提交到远端后才会在 GitHub 生效。

已有路由下发布 API：`pnpm deploy:api`。脚本上传新版本并将该版本切到 100% 流量，
保留现有 Worker secrets 和 zone 路由，不需要每次发布都具备 zone 路由写权限。
首次配置或变更路由仍需 Cloudflare 控制台，或具备相应权限的 `wrangler triggers deploy`。
发布前要求 `CLOUDFLARE_ACCOUNT_ID` 和 `CLOUDFLARE_API_TOKEN`，先完成本地 dry-run，
再以只读请求校验目标 Worker 访问权限、读取现有 Cron 和活跃版本，成功后才应用迁移与切流。
可用 `node scripts/deploy-api.mjs --preflight-only` 仅执行这些预检，不修改生产资源。

发布后在 `oura/` 执行：

```bash
pnpm check:api
```

这个检查要求 `/api/health` 和未登录的 `/api/me` 返回正确的 JSON（含账号权限、语言等
前端所需字段）、生产 OAuth 配置已启用且 DEV 登录关闭，并要求 `/api/auth/oura/start` 跳转到 Oura 授权页，
回调指向当前域名的 `/api/auth/oura/callback`。它不会完成用户授权，也不会打印
OAuth state 或密钥。可传入另一个部署域名：`pnpm check:api https://<domain>`。

如果 `/api/*` 返回 `200 text/html`，请求落到了 Pages 的 SPA 首页回退，而非
API Worker。先核对 Worker Route，不能只重新发布前端或修改错误文案。
检查同时要求日报、AI、周报和两种对比模式在匿名请求下返回 401，
设置接口 GET 返回 405；返回 404 会使检查失败，避免旧 Worker 漏掉新路由。
这些检查不读取健康数据；OAuth start 会生成短期授权 state。

### 自动化测试与覆盖边界

在 `oura/` 使用 Node 24、仓库锁定的 pnpm 和依赖：

| 命令 | 覆盖 |
| --- | --- |
| `pnpm test` | 部署脚本、前端逻辑、API 单元测试与 Worker 集成测试（含 MCP 授权轮转、同步并发和完整数据采集流程） |
| `pnpm typecheck` | API TypeScript 与前端 Svelte 类型检查 |
| `pnpm build` | 前端生产构建 + Worker 打包 |
| `pnpm check:api` | 线上路由、匿名鉴权、能力字段、OAuth 跳转契约 |
| `pnpm test:browser` | 构建后在无头 Chrome 中验证正常与 SSO 两套完整交互 |
| `pnpm test:browser:built` | 复用已有构建运行浏览器回归（CI 发布前必跑） |
| `pnpm test:browser:ego` | 保留本机 Ego 浏览器排查入口 |

集成测试使用 Wrangler 已锁定的 Miniflare，无新增依赖。执行真实构建后的 Worker、
内存 D1、OAuth 回调、会话、加密令牌读写和报表逻辑，仅模拟外部 Oura 响应。
覆盖 7/30/90 天数据、未登录拒绝访问、非所有者与所有者报表权限、设置持久化、退出及伪造会话。
所有上游数据均为测试数据，不使用生产密钥或真实健康数据。

浏览器测试使用 Node 24 内置 WebSocket 与已安装的 Chrome，通过 CDP 驱动，
不新增 npm 依赖。默认检测 macOS Chrome 和 Ubuntu Chrome，可用 `CHROME_BIN` 指定可执行文件。
会自动启动仅监听
`127.0.0.1:4178` 的隔离服务，加载真实前端构建与 Worker，结束后关闭服务。
测试账号与权限状态仅存在于临时 D1；`/__test/login` 只属于测试服务，不进入生产 Worker。
脚本验证页面内容、错误横幅、API 失败和浏览器运行异常，不需要人工逐个点击。
同时覆盖快速切换对比模式的响应竞争、睡眠缺失/空结果/请求失败、
18 类数据补采、超大窗口自动拆分、后台同步状态和数据库额度耗尽后的恢复提示。
同时验证稀疏周报、日期跨午夜、375px 移动端、键盘交互及 SSO 中断/恢复。
GitHub PR 与上线 workflow 均在部署前执行浏览器回归；失败会阻止部署。
截图、浏览器/网络诊断与 fixture 日志作为 CI artifacts 保留 7 天；
本地默认写入系统临时目录，可通过 `OURA_BROWSER_ARTIFACTS` 指定位置。

真实 Oura 登录/授权与账户会员资格不属于模拟测试保证范围。
`/api/me/ai` 始终返回可用的规则解读（`source: "template"`）；只有配置了
AI provider 才可能返回 `source: "ai-ranked"`，且该模式仅对已验证结论排序，
不生成文字或数字。`PERSONAL_OWNER_ID` 对应的账号解锁完整报表与数据同步；其它账号只能看到日汇总与周报摘要。

### 日期、样本与睡眠口径

- 页面“今天”、日报请求、周报和手动补采的默认窗口统一采用 `Asia/Shanghai`。
  日文档仍保留 Oura 的 `day`，不因查看者所在地改写；心率/电量原始时间戳归档仍采用 UTC。
- 周报按包含今天的近 7 个日历日，对比此前 7 个日历日，不表示周一到周日。
  空日、稀疏日和过期缓存不移动窗口。每项指标分别统计有效天数，
  两期都至少 3 天才生成比较结论；这个门槛是产品展示规则，不代表统计显著性。
- 页面 `range` 为近 7 天与近 30 天，窗口重叠；MCP `compare_periods range`
  保留近 30 天与此前 30 天的独立区间。两者都按日历过滤，返回完整边界和每项样本数。
- 均值忽略缺失/非有限值/越界评分，合法零值仍参与计算。缺失不作为零填充。
- 看板与睡眠页展示每日主睡眠；未标记时取最长记录，不累加小睡。
  HRV 仅使用明确标记的主睡眠。睡眠时间按原始记录的当地时刻展示。
- 页面跨北京时间午夜保持打开时，定时检查或重新获得焦点会刷新窗口与数据；
  浏览器回归使用不同的浏览器时区，并验证跨日后的请求与显示。

## MCP 连接器（Claude / ChatGPT）

看板数据以只读远端 MCP 服务暴露给 Claude 与 ChatGPT：

```
https://oura.kdp.cool/mcp
```

部署此版本需先应用 `0009_mcp_token_family.sql`（`pnpm deploy:api` 会自动执行）。
授权码消费与凭证发行、refresh token 轮转都在 D1 事务内完成，失败可重试；
重放已轮转的 refresh token 会撤销同一授权链，错误客户端不能触发该撤销。
历史凭证缺少授权链关联，因此同一用户、同一客户端的旧授权会统一归组：
它们保持可用，但其中一枚旧凭证被撤销或发生重放时，该组旧授权会一起失效。
新授权各自独立，不受旧授权组撤销影响。

接入步骤（两个平台相同）：添加自定义连接器 → 填上面的 URL → 平台自动完成
注册与授权 → 浏览器打开同意页 → 先登录 Oura，再点「允许连接」。

`oura-kdp-api.kedoupi.workers.dev` 仅用于排查 Worker 是否在线，不作为连接器 URL：
OAuth 登录回调固定在 `oura.kdp.cool`，跨域名浏览器会话无法完成授权。

连接器图标沿用看板的原创橙色仪表圆环：

- `https://oura.kdp.cool/icon.png`：512 × 512 PNG，可用于平台手动上传。
- `https://oura.kdp.cool/icon.svg`：矢量图；网站和授权页也使用此图标。
- `https://oura.kdp.cool/favicon.ico`：32 × 32 浏览器兼容图标。

MCP `initialize` 的 `serverInfo.icons` 返回同源 PNG 和 SVG 地址，并提供
`websiteUrl`；保留现有协议版本协商，不为图标改动升级整个协议。
字段格式参照 [MCP Implementation / Icon](https://modelcontextprotocol.io/specification/2025-11-25/schema)。
客户端是否显示图标由其实现决定，服务端返回元数据不等于平台 UI 已验收。
ChatGPT 可在连接管理中 Refresh 后开启新对话
（[官方测试说明](https://developers.openai.com/apps-sdk/deploy/connect-chatgpt)）。
Claude 自定义连接器的自动图标读取尚未经过真实客户端验证。
`pnpm check:branding` 检查公开图片状态、MIME、PNG 尺寸和首页图标链接；
发布流水线在前端部署后自动执行，避免缺失图片被 SPA HTML 回退掩盖。

授权由本 Worker 自带的 OAuth 2.1 授权服务器签发：

| 端点 | 作用 |
| --- | --- |
| `/.well-known/oauth-protected-resource` | RFC 9728 资源元数据 |
| `/.well-known/oauth-authorization-server` | RFC 8414 授权服务器元数据 |
| `/oauth/register` | RFC 7591 动态客户端注册（仅 https 或回环地址） |
| `/oauth/authorize` | PKCE S256 授权码；同意页需已登录且仅限 `PERSONAL_OWNER_ID` |
| `/oauth/token` | 授权码与刷新令牌（刷新令牌一次性轮换） |
| `/oauth/revoke` | RFC 7009 撤销 |

令牌只存 SHA-256 哈希，Oura 令牌始终留在服务端。工具全部只读且由服务端计算：

| 工具 | 返回 |
| --- | --- |
| `get_connection_status` | 同步时间、最近有数据的日期、是否过期 |
| `get_daily_metrics` | 每日官方分数、contributors、数据覆盖 |
| `get_period_summary` | 7/30/90 天均值与覆盖 |
| `compare_periods` | 近 7 天 vs 前 7 天，或近 30 天 vs 前 30 天 |
| `get_health_data_status` | 18 类数据的入库数量、历史范围、各类最近同步和失败窗口数 |
| `get_health_records` | 按类型和日期读取官方详细记录，按需刷新，保留原始字段和单位 |

每个响应都带日期范围、覆盖天数、同步状态与非医疗建议声明；缺失指标保持 `null`。
在设置页的「AI 应用连接」可查看并随时撤销已授权应用。

### 详细数据与长期保存

新增授权入口：`https://oura.kdp.cool/api/auth/oura/start?sync_health=1`。
申请 `daily personal email heartrate workout tag session spo2 heart_health`；
授权后回到固定的 `/settings?sync=90`，自动启动最近 90 天分批补齐。
页面消费此标记一次；关闭或离开设置页后不再启动下一批。
可以在 `/settings` 重试补齐，或只同步最近 7 天。无需分享密码、令牌或重新创建 Oura 应用。
设置页默认将心率、电量按一天一批采集，其他日期类型按 30 天一批；
遇到 `sync_window_too_large` 时自动二分日期，最小到一天，不要求用户手动选择范围。
单日仍超限时保留失败并继续其他日期；授权失效、限流或网络中断会停止本轮。
同一页面可继续未完成任务；刷新后可从服务端 `failed_ranges` 重试已记录的失败窗口，
从未尝试的日期仍需使用 90 天补齐入口。子批次全部成功后才解除原大窗口的失败状态，
旧成功记录或部分覆盖不能冒充本次重试成功。
如果官方拒绝某类数据，先检查该类别授权和会员访问资格；不把 403 当成空数据。

`health_records` 按用户、类型、记录 ID 保存完整官方文档，包括睡眠 HRV/心率序列、
活动详情与 `sleep_regularity`；同一天的多个睡眠片段分别保存。
支持 18 类：`sleep`、`daily_sleep`、`daily_readiness`、`daily_activity`、
`heartrate`、`daily_spo2`、`daily_stress`、`daily_resilience`、
`daily_cardiovascular_age`、`vO2_max`（官方路径大小写）、`workout`、
`enhanced_tag`、`session`、`sleep_time`、`rest_mode_period`、
`ring_configuration`、`ring_battery_level`、`personal_info`。
旧 `tag` 接口已弃用，使用 `enhanced_tag`。

- HTTP：`GET /api/me/health-records/status` 查看状态；
  `POST /api/me/health-records?collection=sleep&from=2026-10-01&to=2026-10-07`
  同步指定窗口；同地址 `GET` 只读已保存数据。仅真实 OAuth 的个人 owner 可访问。
- MCP：`get_health_records` 默认刷新过期窗口；`refresh:false` 只读历史。
  `get_health_data_status` 不访问 Oura。
- 起止日期均包含在内，最多 31 天；心率、电量最多 7 天，按 UTC 时间戳归日；
  日文档保留 Oura 的 `day`。戒指配置和个人资料为当前快照，不表示历史画像。
- 返回最多 20 条，较大记录会提前分页；继续传 `next_offset`。
  默认省略大序列，`include_series:true` 可读取；数据库始终保留完整序列。
- 成功同步缓存 10 分钟，手动刷新有 30 秒冷却；失败窗口短暂退避。
  共用用户同步锁，避免与看板并发刷新 Oura token。
- 所有上游页成功后，原子替换**本窗口**；分页错误、超时或权限失败保留旧数据，
  标记 stale/error。历史窗口不会滚动删除；原有 `daily_cache` 也不再清空更早记录。
- `window_verified:false` 表示该窗口尚未成功采集，不能解释为“没有数据”。
  较旧窗口可由后台日任务补齐；已成功覆盖的旧日期不会每日重复抓取。尚未接入 Webhook。

### 每日后台自动同步

- 北京时间每天 **09:00** 启动一次，仅处理 `PERSONAL_OWNER_ID` 对应的已授权账号。
  上线时若已过当天 09:00，下一次触发即可开始当日任务。不依赖浏览器或登录会话。
- Cloudflare Cron `*/2 * * * *` 每两分钟唤醒一次，每次只处理一个窗口。
  日门控与任务清单保存在 D1 `auto_sync_state`；无需 Queue、新依赖或桌面自动化。
  发布脚本在版本部署后单独 PUT Worker schedules 并 GET 核验，不改动 zone routes。
  Cron 配置传播可能延迟，09:00 表示计划开始时间，并非全部数据就绪时间。
- 先刷新首页最近 90 天评分缓存、18 类数据最近 7 天/当前快照，再补齐最近
  90 天未成功覆盖的日期（成功空结果也算覆盖；较新的失败会使旧覆盖需要重试）。
  心率、电量逐日，其余历史日期最多 30 天一批，超限自动二分。
  初次补齐可能持续数小时；已有历史不会因超出 90 天滚动范围而删除。
  新一天优先刷新近期数据，再根据持久化覆盖记录重新规划 90 天内尚未完成的历史批次。
- 复用现有同步锁，避免与手动操作并发刷新令牌。瞬时失败最多尝试 3 次，
  按 15/30 分钟退避；429 延后整个队列。类别 403 跳过该类别继续其他数据，
  单日超限保留失败；次日日任务重新规划未覆盖窗口。
  授权失效会暂停整个任务，正常 Oura 重新授权回调会恢复任务，不自动反复尝试失效授权。
- 任务清单与每批结果持久保存，Worker 被中断后租约到期可接续；
  已写入的窗口按既有冷却期避免立即重取。设置页显示进度、最近完整成功时间、下次计划与错误。
  手动 7/90 天同步仍可立即使用；手动批次需要保持页面打开，后台任务不受页面关闭影响。
- 每次日任务开始时，最多各清理 500 条过期 session、OAuth state、授权码、同意事务，
  以及超过 30 天的分析缓存。**不删除历史健康记录、窗口覆盖记录、MCP 撤销记录、账单事件**。
  `AUTO_SYNC_ENABLED=0` 可停用后台调度；配置变更需正常发布。
- 相同健康记录不重复删除/写入，只更新变化和移除官方已删除的记录；
  `fetched_at` 保留最近一次写入该文档的时间，窗口 `synced_at` 表示最近成功核验时间。
  自动同步每日最多预留 **400,000 行估算写入**（含索引和临时数据清理余量，
  约合 10 万真实行；Workers Paid 每月含 5,000 万行写入，留有大量余量），
  使用 D1 中的原子计数；达到预算后等待 UTC 次日 01:00（北京时间 09:00）续跑。
  该预算不是 Cloudflare 账户剩余额度，手动同步和其他项目仍会共享平台额度。
  不自动升级套餐；初次历史补齐可能分多日完成。
- `.github/workflows/retry-oura-deploy.yml` 每天 UTC 00:10（北京时间 08:10）
  检查最近的主分支产品发布。只有 Oura API 发布步骤明确因 D1 当日写入额度失败，
  才重跑该次发布失败的 job；成功、正在执行和其他失败一律不重试。GitHub 定时触发可能延迟。
- D1 当日写入额度超限时，API 返回 `503 storage_write_quota_exceeded`、
  下一次 UTC 午夜的 `retryAt` 和 `Retry-After`。登录回调也保留该错误分类，
  页面显示北京时间的具体恢复日期；手动补齐在首次全局故障后停止其他类别，
  保留未完成任务供重试。额度错误不会被解释为 Oura 服务故障或授权状态无效。
  已保存数据不会被删除；是否能即时读取仍取决于 Cloudflare 当时允许的查询。

自动回归使用隔离 D1 和模拟 Oura 验证权限、分页、历史保留及 90 天补齐 UI。
真实账号的额外权限和实际数据覆盖，需用户完成上述授权后验收。

### 区域边缘说明

`oura.kdp.cool` 曾对部分数据中心来源间歇返回 `cf-mitigated: challenge` 的 403。
当前已针对 `oura.kdp.cool` 的 `/mcp`、`/oauth/*`、`/.well-known/*` 添加
浏览器完整性检查豁免；`pnpm check:api` 严格验证这些路径已真实到达 Worker，
不再把边缘 403 记为警告通过。

## Phase 0 — `/api/me/daily` 契约（2026-09-15）

对照真源：`GET https://api.xiaotaozi.cc/oura/daily?user_id=kedoupi&days=30`（已入库 `workers/api/src/data/oura_daily_kedoupi_30d.json`）。

**主 payload**（与现网一致）：`ok`, `days[]`, `from`, `to`, `count`。会话 extras：`source`, `dev`, `label`, `user_id`, `dataset`。

**DEV**：在 per-user OAuth token 就绪之前，演示登录走个人公开看板数据集（kedoupi / `api.xiaotaozi.cc`），保证 UI 看到的 contributors / steps / active_calories 是生产数字。

**OAuth**：Cloud 日接口经 pick* 映射；缺密钥时该路径保持 503 / 未登录 401，类型与 mapper 已就绪。

**看板**：`apps/web` 已按现网 `h5.xiaotaozi.cc/health/`（build 20260914-1735-ai-now）整页迁入（chrome / 周滑块 / 三卡 spark / SRA / 仪表 / 步数档 / 步数柱 / 雷达 / 热力 / 均值表 / 30vs90 / 洞察 / 贡献条 / AI 抽屉）。未登录是 `#landing-view` 营销页；登录后看板不变。前端一次拉 `?days=90` 再本地切片，默认周视图。DEV 的 `/api/me/ai` 代理现网 kedoupi AI；OAuth 用户该接口暂 501，抽屉壳保留。

## Svelte pilot（2026-09-16）

`apps/web` 从 vanilla Vite TS 迁到 **Vite + Svelte 5 SPA**（不用 SvelteKit SSR，保持 Cloudflare Pages 静态托管 + Workers API 拆分）。

- 奶油纸看板 CSS token / 类名与现网一致（`apps/web/src/styles.css` 原文复用）；落地页只用同一套 token
- OAuth / DEV / `/api/me/daily` / `/api/me/ai` 路由不变；未登录主 CTA 仍是 `/api/auth/oura/start`
- Chart.js 仍走 CDN 4.4.7，Svelte 组件只负责挂载/销毁 canvas
- **不用 React / React Bits**

## Layout

```
apps/web          Vite + Svelte 5 SPA 看板
workers/api       Cloudflare Worker（OAuth / session / daily）
migrations/       D1 SQL
DESIGN.md         产品与安全假设
```

## Stack

- Cloudflare Pages（前端）
- Cloudflare Workers + D1（OAuth / API / 会话）
- 密钥仅环境变量 / Worker secrets，见 `.env.example`
- 本仓不改 DNS、不部署生产、不做 `/oura/ai`

## License

MIT
