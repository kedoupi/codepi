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

## Locked MVP — 本周解读 / 对比 / Stripe

锁定范围：已有 Oura 环 + 有效会员 + 已在本站 OAuth 的用户。产品是**中文二次解读层**，不改官方分数、不承诺无会员也能拉全量官方数据。

| 页 | 行为 |
|---|---|
| 看板 | 入口卡「本周解读」/ Weekly insights |
| `/insights` | 本周 vs 上周睡眠/准备度/活动各一句模板摘要 + 最多 3 条建议；固定「非医疗建议 / Not medical advice」 |
| `/compare` | 本周 vs 上周，或近 7 天 vs 近 30 天，两列关键指标 |
| 付费墙 | 未订阅可看周报前 3 行；全文建议与对比页需订阅 |
| `/settings` | 语言覆盖 + Stripe 开通 / Customer Portal 取消 |

**语言**：整站壳（落地页 + 看板导航 + 解读入口）跟 `navigator.language`：`zh*` → 中文，否则英文。设置里可覆盖并写入 D1 `user_prefs` + `localStorage`。Phase 1 解读**正文模板只有中文**；英文 UI 用壳 + 「Phase 1 insight body is Chinese-only」。

### Stripe secrets（只走 wrangler，不要进 git）

在 `workers/api`：

```bash
npx wrangler secret put STRIPE_SECRET_KEY
npx wrangler secret put STRIPE_WEBHOOK_SECRET
npx wrangler secret put STRIPE_PRICE_ID
# 可选。托管 Checkout 跳转不需要 publishable key
# npx wrangler secret put STRIPE_PUBLISHABLE_KEY
```

占位价 **¥39/月（B 档）**。在 Stripe Dashboard（test mode）建 recurring Price，把 `price_...` 写入 `STRIPE_PRICE_ID`。币种用 CNY 或你账户支持的币种，UI 文案仍显示 ¥39/月。

Webhook **必须**是：

```
https://oura.kdp.cool/api/stripe/webhook
```

Preview 用对应 `*.workers.dev` / 预览域名的同一路径。Dashboard 里只订阅：`checkout.session.completed`、`customer.subscription.*`、`invoice.paid`、`invoice.payment_failed`。

### 支付方式（哪些被 env 打开）

默认 Checkout `mode=subscription` + `automatic_payment_methods[enabled]=true`：由 Stripe 账户 / Dashboard 已开通的方式决定，通常是 **card**。

| 变量 | 作用 |
|---|---|
| （不设） | automatic payment methods，卡 + 账户已开通且 Checkout 订阅模式支持的方式 |
| `STRIPE_PAYMENT_METHOD_TYPES=card,alipay,wechat_pay` | 改用显式 `payment_method_types[]` |
| `STRIPE_ENABLE_ALIPAY=1` | 追加 `alipay`（还需 Dashboard 打开 Alipay） |
| `STRIPE_ENABLE_WECHAT_PAY=1` | 追加 `wechat_pay`，并设 `payment_method_options[wechat_pay][client]=web` |

**注意：** Alipay / WeChat Pay 一般**不支持** Checkout `mode=subscription`（钱包多为一次性支付；Alipay 循环扣款多为邀请制）。没开 Dashboard、或订阅模式拒收时，创建 Session 会失败。订阅主路径请先用 **card**。取消走 Stripe Customer Portal。

订阅状态写 D1 `subscriptions`，按 session `user_id` 关联。`active` / `trialing` / 本地 `dev_grant` 视为已订阅。

D1 迁移：`migrations/0002_subscriptions.sql`。本地 `pnpm dev:api` 会 `d1 migrations apply --local`。**不要**在人工 review 前对生产 `oura_kdp` 跑 `--remote`。

### 本地 / Preview 测 Checkout（test mode）

1. Stripe test mode 建 ¥39/月 Price，把 `sk_test_...`、`price_...`、webhook `whsec_...` 放进 Preview Worker secrets（或本地 `.dev.vars`）。
2. 本地可用 [Stripe CLI](https://stripe.com/docs/stripe-cli)：`stripe listen --forward-to localhost:8787/api/stripe/webhook`，把 CLI 打印的 `whsec_` 写入 `STRIPE_WEBHOOK_SECRET`。
3. `ALLOW_DEV_LOGIN=1` → DEV 演示登录 → 设置页「开通订阅」→ Checkout 用卡 `4242 4242 4242 4242`。
4. 成功后应回到 `/insights?checkout=success`，webhook 把 D1 标成 `active`，周报建议与对比解锁。
5. 「管理 / 取消订阅」打开 Customer Portal。
6. **没有 Stripe 密钥的 Preview**：设置页 DEV「模拟已订阅 / 恢复未订阅」只点验付费墙，生产必须关 `ALLOW_DEV_LOGIN`。

**不要部署、不要合并到 main。** 生产 oura.kdp.cool 冻结，等人工 review。

## Cloudflare Pages（`apps/web`）

生产 Pages 必须部署 **Svelte 构建产物**，不要把仓库根目录或旧的 vanilla `index.html`（登录卡片 + DEV 按钮）当作 Pages 根目录。

```bash
pnpm --filter @oura-kdp/web build
```

输出目录：`apps/web/dist`。部署后打开站点应看到营销落地页（H1「Oura 健康看板」+「用 Oura 登录」），不是旧的 login-card HTML。

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
