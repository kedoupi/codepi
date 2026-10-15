# 珂抖屁公众号（kedoupi · 公众号工作台）

生产域名：**https://fagao.kdp.cool**（须登录）。域名后续随 P4 迁移到正式公众号子域，Pages 项目名 `fagao` 保持不变。
原 `gzh-preview` 已并入本产品并下线；请勿再使用第二套审稿站。

「过」→ 可推箱；「要改」「拒」→ **需改**（改完可再交审）。不接微信草稿箱 API。

# 产品简介（珂抖屁公众号）

内部公众号工作台，服务微信公众号 **珂抖屁**。一期只做人审：编辑把档位标成待审并附预览 → 老板手机打开 → 过 / 要改 / 拒 → **可推箱** 后编辑在微信后台人工推草稿箱。

- 生产域名：**https://fagao.kdp.cool**（Pages 项目名 `fagao`，已由运维占位）
- 同主机提供看板、`/p/<slug>/` 预览壳（同域正文内嵌进页，外域才降级 iframe）、预览 HTML、`/api/*`，一条 `fagao_session` HttpOnly Cookie 即可在手机里打通
- 登录：邮箱 + 6 位 OTP。不做 Cloudflare Access / Zero Trust
- 不接微信草稿箱 API；不要改 `gzh-preview` 仓

## 产品流

默认页是 **上海时区今天** 的图文列表（早 / 中 / 晚），封面 + 标题 + 摘要，点进去才是接近成稿的 H5（同域 `preview_path` 拉 HTML 嵌进阅读栏，顶栏只留返回、底栏悬浮）。待审另有队列；**过 / 要改 / 拒** 钉在稿件页底栏，但进页时锁住，须通读到底（或外域 iframe 点「已读完」）才解锁。只有「过」之后才出现 **可推箱**，编辑再标 **已进箱**。编辑可从 **可推箱 / 已进箱 / 需改** 点 **撤回待审**，再走一遍过。

| 状态 | 谁动 | 含义 |
| --- | --- | --- |
| 空档 / `draft` | 编辑 | 还没交审；「拒」也回到 draft |
| 待审 | 编辑标、老板审 | 有预览地址，可 过 / 要改 / 拒 |
| 需改 | 老板点要改 | 编辑改完再交，或一键撤回待审 |
| 可推箱 | 老板点过 | 黄薇去微信后台人工进箱；编辑可撤回待审 |
| 已进箱 | 编辑确认 | 一期终点；编辑可撤回待审再过 |

种子账号展示名写死 **珂抖屁**。一期允许名单只有 `kedoupi@gmail.com`（可用环境变量 `ALLOWLIST` 追加黄薇邮箱，不必做多账号 UI）。

演示稿：slug `kdp-MMDD-zao|zhong|wan` 且 `is_demo=1` 会标「演示」。迁移里写了 `2026-09-17` 三档。上海时区「今天」若三档都空且当天没被标记跳过，才自动补演示。演示可 **撤回待审**、**撤掉演示** 腾档，或直接交真稿替掉该档演示；撤掉后当天不再自动补。其它日期不自动造稿。

同 slug 换成真稿时要清掉演示标：编辑保存时若标题不再是演示句，或 `preview_path` 指向 `/previews/` 演示路径以外（含 `gzh-preview` / 站外 https），或点 **标为正式稿**，`is_demo` 置 0。演示稿也允许把 slug 从 `kdp-MMDD-*` 改走。已上线的库需补跑 `0003_post_is_demo.sql`。

## 架构

Cloudflare **Pages 静态** + 同项目 Worker（`npm run build` 写出 `dist/_worker.js`，Pages Advanced Mode）处理 `/api/*` 与登录门闩 + **D1**。源码在 `worker/`。

```
https://fagao.kdp.cool/          审核台 H5（Vite）
https://fagao.kdp.cool/login
https://fagao.kdp.cool/p/<slug>/ 预览壳（会话门闩；同域正文内嵌，外域 iframe）
https://fagao.kdp.cool/previews/ 演示 HTML（同样要登录）
https://fagao.kdp.cool/api/*     Worker：OTP、session、board、review
```

密钥只走 wrangler secrets，**不要**写进 git / `wrangler.toml` `[vars]`。

| 名称 | 放哪 | 用途 |
| --- | --- | --- |
| `RESEND_API_KEY` | secret | Resend 发信；本地可省略，验证码打日志 |
| `SESSION_SECRET` | secret | 会话 token 哈希 |
| `OTP_PEPPER` | secret | OTP 哈希盐 |
| `ALLOWLIST` | var | 逗号分隔邮箱，默认 `kedoupi@gmail.com` |
| `OTP_FROM` | var | 默认 `otp@kdp.cool` |
| `ACCOUNT_BRAND` | var | 默认 `珂抖屁` |
| `ENVIRONMENT` | var | `production` / `preview` / `development` / `test` |

OTP：6 位数字，`SHA-256(code + OTP_PEPPER)` 存 D1，TTL **8 分钟**。同邮箱 60s 冷却、15 分钟 ≤3、日 ≤10；同 IP 15 分钟 ≤10；同码校验失败 5 次作废。响应统一「若在名单内将发送」，防枚举。

Cookie：`fagao_session`；`HttpOnly; Secure; SameSite=Lax; Path=/`；约 7 天。本地 HTTP 开发会去掉 `Secure`，否则浏览器不带 cookie。

## 运维：第一次接到 Pages `fagao`

在已登录 `wrangler` 且选对账号的机器上做（本仓不会替你创建远程资源）。

### 1. D1（空库已建，与 oura 隔离）

`wrangler.toml` 已写入：

| 项 | 值 |
| --- | --- |
| database_name | `fagao` |
| database_id | `44beaaee-2cfb-4f04-8c5a-242c03ad816e` |
| binding | `DB` |

库是空的，上线前必须跑迁移（建表 + 种子账号 / 2026-09-17 演示三档 + `desk_meta` + `posts.is_demo`）。已上线的库也要补跑 `0002_desk_meta.sql` 和 `0003_post_is_demo.sql`，否则今天看板读 `desk_meta` 会失败，真稿也清不掉演示标：

```bash
npx wrangler d1 migrations apply fagao --remote
# 或：npm run db:migrate:remote
```

### 2. 绑到 Pages 项目 `fagao`

任选其一（Git 连接 Pages 时 `wrangler.toml` 即配置源，需 **V2 build system**）：

- 仓库根目录已有 `wrangler.toml`：`name = "fagao"`，`pages_build_output_dir = "./dist"`，`[[d1_databases]] binding = "DB"`（库名 `fagao`）
- 或 Dashboard → Workers & Pages → `fagao` → Settings → Bindings → 添加 D1 库 **`fagao`**，变量名必须是 **`DB`**

Pages 构建设置：

| 项 | 值 |
| --- | --- |
| 项目名 | `fagao` |
| 根目录 | `/` |
| Build command | `npm ci && npm run build` |
| Build output | `dist` |
| 自定义域 | `fagao.kdp.cool`（已占位则只确认） |

### 3. Secrets 与 ALLOWLIST

```bash
npx wrangler pages secret put RESEND_API_KEY --project-name=fagao
npx wrangler pages secret put SESSION_SECRET --project-name=fagao
npx wrangler pages secret put OTP_PEPPER --project-name=fagao
```

`SESSION_SECRET` / `OTP_PEPPER` 用足够长的随机串，例如 `openssl rand -hex 32`。

Dashboard → `fagao` → Settings → Environment variables：

- `ALLOWLIST=kedoupi@gmail.com`（以后加黄薇：`kedoupi@gmail.com,huangwei@…`）
- `OTP_FROM=otp@kdp.cool`
- `ACCOUNT_BRAND=珂抖屁`
- `ENVIRONMENT=production`

Resend：在 `kdp.cool` 配好 DKIM 后用 `otp@kdp.cool` 发信。

### 4. 发版后自检

```bash
curl -sS https://fagao.kdp.cool/api/health
# {"ok":true,"brand":"珂抖屁"}
```

未登录打开 `/` 或 `/p/kdp-0917-zao/` 应 302 到 `/login`。

## 本地开发

```bash
cp .dev.vars.example .dev.vars
npm install
npx wrangler d1 migrations apply fagao --local
npm run build
npm run pages:dev
```

打开 http://127.0.0.1:8788 。`.dev.vars` 里不要填 `RESEND_API_KEY` 时：

- wrangler 日志会出现 `[fagao-otp] kedoupi@gmail.com 123456`
- `ENVIRONMENT=development` 时接口也会带 `dev_otp`，方便本地点

```bash
npm run typecheck
npm test
npm run build
```

测试走 Miniflare + 本地 D1，**不调用 Resend**（`ENVIRONMENT=test` 且无 API key，验证码由 mock/dev 通道给出）。

## 路由与表

- `GET /api/health` 公开
- `POST /api/auth/request-otp` `{ email }`
- `POST /api/auth/verify-otp` `{ email, code }`
- `POST /api/auth/logout`
- `GET /api/me`（需登录）
- `GET /api/board?date=YYYY-MM-DD`
- `GET /api/posts/:slug`
- `POST /api/posts` 编辑写入并 `submit: true` 标待审；更新演示稿时按预览/标题清 `is_demo`，可带 `from_slug` / `new_slug` / `mark_official`
- `PATCH /api/posts/:slug` 改标题、预览、`mark_official`、`new_slug`；真稿预览或标为正式稿后 `is_demo=false`
- `POST /api/review` `{ slug, action: 过|要改|拒, note }`
- `POST /api/posts/:slug/boxed` 可推箱 → 已进箱
- `POST /api/posts/:slug/withdraw` 需改 / 可推箱 / 已进箱 → 待审
- `POST /api/posts/:slug/release-demo` 撤掉演示稿并腾档

D1：`accounts` `sessions` `otp_codes` `posts`（含 `is_demo`）`reviews` `desk_meta`，见 `migrations/`。

## 验收

- [ ] 白名单邮箱能要到验证码（生产走 Resend；本地无 key 则看日志 / `dev_otp`）
- [ ] 白名单邮箱 OTP 登录（不改登录形态）
- [ ] 登录后默认看到 **今天** 三档，每档有标题/状态，不是空卡片
- [ ] 点待审 → `/p/<slug>/` 里是接近成稿的 H5（同域不套 iframe 双层滚动），底栏先锁「请先通读全文」，滚到底才出现 **过 / 要改 / 拒**
- [ ] 点过之后才出现 **可推箱**，再点 **已进箱**
- [ ] `/p/<slug>/` 与 `/previews/…` 无会话 302 `/login`
- [ ] 密钥未进仓库；`wrangler.toml` 只有 vars / D1 绑定

## 一期明确不做

Cloudflare Access、微信推箱 API、多公众号切换、合并 `gzh-preview` draft PR#1。
