# 健康 Health

kedoupi（codepi）的个人健康空间，主入口为 `health.codepi.app`。应用源码位于 `apps/health/`，workspace 包为 `health-kdp`、`@health-kdp/web`、`@health-kdp/api`；云资源为 `codepi-health`、`codepi-health-api`。

当前数据来源为 Oura。`OURA_CLIENT_ID` / `OURA_CLIENT_SECRET`、提供方 OAuth 回调、数据字段保留 Oura 名称；现有 SSO client ID `oura` 与会话 Cookie 属于兼容协议，本次目录改名不迁移它们。开发工具变量使用 `HEALTH_BROWSER_*`、`HEALTH_CHECK_*`、`HEALTH_EXPECT_*` 和 `HEALTH_PREVIOUS_VERSION`，它们与 Oura 提供方凭证分开命名。

未登录展示个人健康应用介绍；通过统一账号登录后查看概览、睡眠、解读、对比与设置。视觉来源为 `../../packages/shared/styles/tokens.css`，迁移说明见 [Health 域名迁移](../../docs/architecture/health-domain-migration.md)。

同步告警只统计尚未恢复的失败批次：日期范围可以由失败之后的多个成功批次连续补齐，
个人资料和戒指信息则由更新的成功快照替代。状态读取会自动识别已恢复的历史批次；
原始失败记录保留用于诊断，不能直接将数据库中 `last_error` 非空的数量当作当前告警数。

## 登录与授权（统一 MCP 版本）

- 网页登录：`/api/auth/login` → `auth.codepi.app` → 当前域名 `/api/auth/callback`。
- Oura 提供方回调继续使用已登记的 `https://health.codepi.app/api/auth/oura/callback`。
- 从 Health 发起设备连接时，先验证当前网站 SSO 会话，再进入 Oura 授权；完成后回到 Health。带 `health_return` 或同步标记的请求回到设置页。
- AI 客户端统一连接 `https://mcp.codepi.app/mcp`，由 `services/mcp/` 管理授权；此版本直接删除旧 Health MCP，旧客户端需重新授权。实现、发布与真实客户端验收状态见[任务记录](../../docs/development/tasks/2026-10-18-unified-mcp.md)。
- 以下 DEV / 非 SSO 说明属于本地调试或历史模式；生产已启用 SSO，网页登录与设备授权分开。

若确认仍使用原 Oura 账号，却收到账号标识不一致的提示，可在设置 → 账号中展开
「原账号连接修复」，选择「确认是原账号并重新授权」。此操作要求本人 SSO 会话、
同源 POST、绑定当前会话的一次性 OAuth state，以及 Oura 返回的邮箱与原记录完全一致。
修复只更新提供方标识和加密授权；本地用户 ID、历史数据、偏好和 MCP 授权保留。
普通重连仍要求提供方 ID 精确匹配，不会仅凭邮箱相同自动改绑。

## Quick start

完整项目检查使用 Node 24；pnpm 版本遵循根 `package.json` 的 `packageManager`。
统一从仓库根安装，当前应用自己的目录不另建 lockfile。

```bash
cd <repository-root>
pnpm install --frozen-lockfile
cd apps/health
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
- 本地可用 **DEV 演示登录**（`GET /api/auth/dev/session`）写入 HttpOnly session；
  `/api/me/daily` 返回 `data/synthetic-board.ts` 中的生成式合成样本（嵌套 `days[]`），
  不读取真实个人数据或旧线上回退接口

真实 OAuth：在 [Oura applications](https://cloud.ouraring.com/oauth/applications) 创建应用，把 `OURA_CLIENT_ID` / `OURA_CLIENT_SECRET` 写入 `.dev.vars` 或 `wrangler secret put`。callback 用 `TOKEN_ENCRYPTION_KEY` 做 AES-GCM 后把 **refresh_token** 写入 D1；前端永不拿到 token。

## 历史开发记录

以下各阶段记录保留当时的行为和接口描述；当前生产登录与开发入口以上文为准。历史任务中的 `apps/oura/`、`@oura-kdp/*` 是改名前的名称，当前命令使用 `apps/health/`、`@health-kdp/*`。

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
# 期望: 看板形状
# { ok:true, from, to, count:7, days:[{ date, sleep:{score,contributors}, readiness:{score,temperature_*,contributors}, activity:{score,steps,active_calories}|null }], source:"dev", user_id:"synthetic-user" }
# 数字来自仓库内生成式合成样本（synthetic-board.ts），不来自任何真实个人数据
```

`?days=7|30|90`。bundled 合成样本是 30 天（2000-01-01 → 2000-01-30）；请求 90 天时不编造额外日期。2026-10-18 起 DEV 不再拉取任何真实个人看板数据（原 `api.xiaotaozi.cc` 实时回退与 `oura_daily_kedoupi_30d.json` 均已删除）。

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

## Production secrets（health.codepi.app）

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
OURA_REDIRECT_URI=https://health.codepi.app/api/auth/oura/callback
FRONTEND_ORIGIN=https://health.codepi.app
```

`ALLOW_DEV_LOGIN`：

- **预览 / 测试 Worker**（`*.pages.dev` 若挂了 `/api`）：必须设 `ALLOW_DEV_LOGIN=1`，落地页才会出现「DEV 演示登录」，点击后走 `/api/auth/dev/session` 跳过 OAuth 进看板。
- **生产 health.codepi.app**：必须 unset 或 `0`。落地页只保留「用 Oura 登录」。
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
pnpm --filter @health-kdp/web build
```

输出目录：`apps/web/dist`。部署后打开站点应看到营销落地页（H1「Oura 健康看板」+「用 Oura 登录」），不是旧的 login-card HTML。

### API 路由与登录检查

Health 前端由 `codepi-health` Workers Static Assets 承载，API/MCP/OAuth 请求
经 `WORKER` service binding 进入 `codepi-health-api`，API 不声明公网 routes。
前端不持有 DB/AUTH/vars。发布从已合并 main 在本机执行，步骤见
[本地发布操作](../../docs/development/local-release.md)：本地验证后先发布 API，
线上契约通过后才发布受影响前端，并分别记录 SHA、Worker version 和 smoke。
GitHub Actions 只做附加验证，不部署。无前端改动时可只发布 API。

已有路由下发布 API：`pnpm deploy:api`。脚本上传新版本并将该版本切到 100% 流量，
保留现有 Worker secrets 和 zone 路由，不需要每次发布都具备 zone 路由写权限。
首次配置或变更路由仍需 Cloudflare 控制台，或具备相应权限的 `wrangler triggers deploy`。
发布前要求 `CLOUDFLARE_ACCOUNT_ID` 和 `CLOUDFLARE_API_TOKEN`，先完成本地 dry-run，
再以只读请求校验目标 Worker 访问权限、读取现有 Cron 和活跃版本，成功后才应用迁移与切流。
可用 `node scripts/deploy-api.mjs --preflight-only` 仅执行这些预检，不修改生产资源。

发布后在 `apps/health/` 执行：

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

在 `apps/health/` 使用 Node 24、仓库锁定的 pnpm 和依赖：

| 命令 | 覆盖 |
| --- | --- |
| `pnpm test` | 部署脚本、前端逻辑、API 单元测试与 Worker 集成测试（含旧 MCP 入口拒绝、同步并发和完整数据采集流程） |
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
本地默认写入系统临时目录，可通过 `HEALTH_BROWSER_ARTIFACTS` 指定位置。

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
- 页面 `range` 为近 7 天与近 30 天，窗口重叠；统一 MCP 的 `health_aggregate`
  通过显式日期选择两个区间，对全部已保存记录统计并返回完整边界和每项样本数。
- 均值忽略缺失/非有限值/越界评分，合法零值仍参与计算。缺失不作为零填充。
- 看板与睡眠页展示每日主睡眠；未标记时取最长记录，不累加小睡。
  HRV 仅使用明确标记的主睡眠。睡眠时间按原始记录的当地时刻展示。
- 页面跨北京时间午夜保持打开时，定时检查或重新获得焦点会刷新窗口与数据；
  浏览器回归使用不同的浏览器时区，并验证跨日后的请求与显示。

## CodePi 统一 MCP（Claude / ChatGPT / Agent CLI）

AI 客户端统一使用 `https://mcp.codepi.app/mcp`。在客户端添加远程连接器后，
通过 CodePi 统一账号登录，明确允许 `health.read health.sync`。Oura 设备授权
仍在 Health 设置页单独管理；MCP 不接收 Oura 凭证。

此版本直接删除 Health API 内的旧 MCP、OAuth 服务和连接管理 API，旧地址返回
404 JSON。旧客户端 token 不迁移；需要改连统一地址并重新授权。
Health 设置页提供新连接地址和 `https://mcp.codepi.app/connections` 授权管理链接，
查看及撤销客户端授权均在统一 MCP 服务完成。

| 工具 | 用途 |
| --- | --- |
| `list_data_sources` | 列出当前已实现且已授权的数据源，首期只有 Health |
| `health_get_catalog` | 查询集合、字段、单位、统计规则和已保存历史范围 |
| `health_query_records` | 按集合和日期查询已保存记录，支持分页和按需读取序列 |
| `health_aggregate` | 全区间统计、日/周/月分组和两个日期区间对比 |
| `health_get_sync_status` | 查看提供方连接、缓存、覆盖、后台同步进度和错误 |

查询和统计默认把需要补齐的近 90 天窗口持久化入队，先返回已有数据，后台刷新；
`refresh:false` 关闭本次刷新。因此这两个工具不声明只读执行。历史查询不限近 90 天，
未保存或未覆盖的数据明确标记缺失，不作为零。统计扫描完整区间，不使用分页样本。

服务边界、日期/加权规则、授权和发布顺序见[统一 MCP 架构](../../docs/architecture/unified-mcp.md)。
本地协议与浏览器测试不能代替真实 ChatGPT、Claude 或 CLI 授权验收；当前进度见
[任务记录](../../docs/development/tasks/2026-10-18-unified-mcp.md)。

Health 看板图标由 `/icon.png`（应用图标）和 `/brand/codepi-symbol.png`（页头标志）提供，
浏览器图标使用 `/favicon.ico`、`/favicon-16.png`、`/favicon-32.png` 和
`/apple-touch-icon.png`；
`pnpm check:branding` 验证公开图片状态、MIME、PNG 尺寸和首页图标链接，
避免缺失图片被 SPA HTML 回退掩盖。

## 详细数据与长期保存

新增授权入口：`https://health.codepi.app/api/auth/oura/start?sync_health=1`。
申请 `daily personal email heartrate workout tag session spo2 heart_health stress ring_configuration`；
授权后回到固定的 `/settings?sync=90`，自动启动最近 90 天分批补齐。
页面消费此标记一次并提交后台任务；收到任务确认后，关闭或离开页面仍由服务端继续。
首页与 `/settings` 共用「更新数据」入口。无需分享密码、令牌或重新创建 Oura 应用。
后台将心率、电量按一天一批采集，其他历史日期类型按 30 天一批；
遇到 `sync_window_too_large` 时自动二分日期，最小到一天，不要求用户手动选择范围。
单日仍超限时保留失败并继续其他日期；授权失效暂停，限流或上游网络失败按后台策略退避。
未完成队列与进度保存到服务端，刷新页面可恢复状态；部分完成后可再次「更新数据」，
已核验的历史窗口跳过，失败或从未尝试的日期会重新规划。子批次全部成功后才解除原大窗口的失败状态，
旧成功记录或部分覆盖不能冒充本次重试成功。
如果官方拒绝某类数据，先检查该类别授权和会员访问资格；不把 403 当成空数据。

韧性 `daily_resilience` 需要 `stress` scope；戒指信息和戒指电量均需要
`ring_configuration` scope。这两项未列入当前公开 OpenAPI 的 scope 清单，
但已通过线上响应核实：缺失时 Oura 返回 401 及明确的 scope 名称。
增加请求 scope 后需要用户重新同意授权，刷新已有 token 不会扩大权限。
设置页重新连接 Oura，并允许请求的全部权限即可；回调继续使用原有
`https://health.codepi.app/api/auth/oura/callback`，无需改域名、创建新应用或重置密钥。
授权完成后自动恢复暂停任务；不能仅凭 401 告知用户授权已过期。

`health_records` 按用户、类型、记录 ID 保存完整官方文档，包括睡眠 HRV/心率序列、
活动详情与 `sleep_regularity`；同一天的多个睡眠片段分别保存。
支持 18 类：`sleep`、`daily_sleep`、`daily_readiness`、`daily_activity`、
`heartrate`、`daily_spo2`、`daily_stress`、`daily_resilience`、
`daily_cardiovascular_age`、`vO2_max`（官方路径大小写）、`workout`、
`enhanced_tag`、`session`、`sleep_time`、`rest_mode_period`、
`ring_configuration`、`ring_battery_level`、`personal_info`。
旧 `tag` 接口已弃用，使用 `enhanced_tag`。

- HTTP：`POST /api/me/health-records/automatic` 提交统一后台任务，返回 `202` 和持久化进度；
  同地址 `GET` 轻量读取任务、评分阶段、详情批次及重试时间。
  `GET /api/me/health-records/status` 查看任务与各类档案覆盖；
  `POST /api/me/health-records?collection=sleep&from=2026-10-01&to=2026-10-07`
  同步指定窗口（睡眠页「同步此区间」及既有调用方保留使用；首页和设置不再逐窗口调用）；
  同地址 `GET` 只读已保存数据。
  仅已登录的个人 owner（SSO 或原 OAuth 会话）可访问。
- 统一 MCP：`health_query_records` 和 `health_aggregate` 默认将过期窗口入队刷新，
  `refresh:false` 只读历史；`health_get_sync_status` 读取本地状态，不访问 Oura。
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

- 北京时间每天 **09:00** 启动一次；也可由用户随时点击「更新数据」启动，
  仅处理 `PERSONAL_OWNER_ID` 对应的已授权账号。
  上线时若已过当天 09:00，下一次触发即可开始当日任务。不依赖浏览器或登录会话。
- Cloudflare Cron `*/2 * * * *` 每两分钟唤醒一次，每次在同一租约内最多推进三个窗口，
  网页或 MCP 请求的定向窗口优先于历史回填执行一次。
  日门控与任务清单保存在 D1 `auto_sync_state`；无需 Queue、新依赖或桌面自动化。
  发布脚本在版本部署后单独 PUT Worker schedules 并 GET 核验，不改动 zone routes。
  Cron 配置传播可能延迟，09:00 表示计划开始时间，并非全部数据就绪时间。
- 先刷新首页最近 90 天评分缓存、18 类数据最近 7 天/当前快照，再补齐最近
  90 天未成功覆盖的日期（成功空结果也算覆盖；较新的失败会使旧覆盖需要重试）。
  心率、电量逐日，其余历史日期最多 30 天一批，超限自动二分。
  初次补齐可能持续数小时；已有历史不会因超出 90 天滚动范围而删除。
  任务跨午夜仍保留进度、失败次数与重试时间，不在早晨重新丢弃队列。
  前一任务完成后，日调度再按覆盖情况规划新一天任务。
- 复用现有同步锁，避免与手动操作并发刷新令牌。瞬时失败最多尝试 3 次，
  按 15/30 分钟退避；429 延后整个队列。类别 403 跳过该类别继续其他数据，
  单日超限保留失败；次日日任务重新规划未覆盖窗口。
  授权失效会暂停整个任务，正常 Oura 重新授权回调会恢复任务，不自动反复尝试失效授权。
- 任务清单与每批结果持久保存，Worker 被中断后租约到期可接续；
  已写入的窗口按既有冷却期避免立即重取。设置页显示进度、最近完整成功时间、下次计划与错误。
  首页和设置页共用任务状态，分别展示评分与详情完成情况。
  HTTP 响应前先保存完整队列，`waitUntil` 仅用于尽快处理首个评分批次；
  即使该请求被终止，Cron 也会接续。重复点击复用运行中的任务，不清除退避或授权暂停。
  部分失败后的手动重试也保留尚未到期的窗口/全局限流等待；
  09:00 前完成的手动任务不占用当天定时刷新的门控。
  刚结束的任务有 30 秒冷却。页面只轮询进度，离开页面会停止轮询，不会停止后台任务。
- 每次日任务开始时，最多各清理 500 条过期 session、OAuth state、授权码、同意事务，
  以及超过 30 天的分析缓存。**不删除历史健康记录、窗口覆盖记录、MCP 撤销记录、账单事件**。
  `AUTO_SYNC_ENABLED=0` 可停用后台调度；配置变更需正常发布。
- 相同健康记录不重复删除/写入，只更新变化和移除官方已删除的记录；
  `fetched_at` 保留最近一次写入该文档的时间，窗口 `synced_at` 表示最近成功核验时间。
  用户触发和定时触发的后台任务共用每日 **400,000 行估算写入**预算（含索引和临时数据清理余量，
  约合 10 万真实行；Workers Paid 每月含 5,000 万行写入，留有大量余量），
  使用 D1 中的原子计数；达到预算后等待 UTC 次日 01:00（北京时间 09:00）续跑。
  该预算不是 Cloudflare 账户剩余额度，既有单窗口 API/MCP 调用和其他项目仍会共享平台额度。
  不自动升级套餐；初次历史补齐可能分多日完成。
- 旧 Actions 部署重试已退役。发布因 D1 写入额度失败时，等待额度恢复，
  再从当前 main 重新执行本地发布流程；不自动重放旧 run。
- D1 当日写入额度超限时，API 返回 `503 storage_write_quota_exceeded`、
  下一次 UTC 午夜的 `retryAt` 和 `Retry-After`。登录回调也保留该错误分类，
  页面显示恢复提示；后台任务延后整个未完成队列，保留进度自动续跑。
  如果提交队列本身已无法写入，则返回错误而不宣称任务已接受。
  额度错误不会被解释为 Oura 服务故障或授权状态无效。
  已保存数据不会被删除；是否能即时读取仍取决于 Cloudflare 当时允许的查询。

自动回归使用隔离 D1 和模拟 Oura 验证权限、分页、历史保留及 90 天补齐 UI。
真实账号的额外权限和实际数据覆盖，需用户完成上述授权后验收。

### 区域边缘说明

`health.codepi.app` 曾对部分数据中心来源间歇返回 `cf-mitigated: challenge` 的 403。
旧 MCP 路径的历史边缘规则不代表新 `mcp.codepi.app` 已验收。`pnpm check:api`
验证 Health API 和旧连接器路径的 404 JSON；`services/mcp` 的 `pnpm check:live`
单独验证新域名的发现和匿名拒绝。默认遇到边缘 403 时失败，不能当作 Worker 已验证。

## Phase 0 — `/api/me/daily` 契约（2026-09-15）

契约形状对齐现网公开看板接口；仓库内不再保存真实个人数据样本，演示数据由 `workers/api/src/data/synthetic-board.ts` 生成。

**主 payload**（与现网一致）：`ok`, `days[]`, `from`, `to`, `count`。会话 extras：`source`, `dev`, `label`, `user_id`, `dataset`。

**DEV**：在 per-user OAuth token 就绪之前，演示登录走仓库内合成数据集（`synthetic-board.ts`），UI 字段形状与生产一致，数值为合成值。

**OAuth**：Cloud 日接口经 pick* 映射；缺密钥时该路径保持 503 / 未登录 401，类型与 mapper 已就绪。

**看板**：`apps/web` 已按现网 `h5.xiaotaozi.cc/health/`（build 20260914-1735-ai-now）整页迁入（chrome / 周滑块 / 三卡 spark / SRA / 仪表 / 步数档 / 步数柱 / 雷达 / 热力 / 均值表 / 30vs90 / 洞察 / 贡献条 / AI 抽屉）。未登录是 `#landing-view` 营销页；登录后看板不变。前端一次拉 `?days=90` 再本地切片，默认周视图。DEV 的 `/api/me/ai` 为演示接口；OAuth 用户该接口暂 501，抽屉壳保留。

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
