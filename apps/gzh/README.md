# 珂抖屁公众号（kedoupi · 公众号工作台）

生产域名：**https://gzh.codepi.app**（须统一登录），Worker 名 `codepi-gzh`。源码目录和产品标识仍为 `gzh`，不再另迁产品域名。
当前为迁移窗口：Worker 配置已实现，生产域名尚未切换，最新状态与验证见 [GZH 迁移记录](../../docs/development/tasks/2026-10-17-gzh-static-assets.md)。
原 `gzh-preview` 已并入本产品并下线；请勿再使用第二套审稿站。

「过」→ 可推箱；「要改」「拒」→ **需改**（改完可再交审）。不接微信草稿箱 API。

# 产品简介（珂抖屁公众号）

内部公众号工作台，服务微信公众号 **珂抖屁**。一期只做人审：编辑把档位标成待审并附预览 → 老板手机打开 → 过 / 要改 / 拒 → **可推箱** 后编辑在微信后台人工推草稿箱。

- 生产域名：**https://gzh.codepi.app**（Worker 名 `codepi-gzh`）
- 同主机提供看板、`/p/<slug>/` 预览壳（同域正文内嵌进页，外域才降级 iframe）、预览 HTML、`/api/*`，一条 `gzh_session` HttpOnly Cookie 即可在手机里打通
- 生产登录由 `auth.codepi.app` 统一处理，`SSO_ENABLED=1` 时旧本地 OTP 接口关闭。staging 的 Access 与认证隔离要求遵循 CF 治理规范，不以旧一期范围替代平台约束。
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

Cloudflare **Workers Static Assets** + **Hono Worker** + **D1**。`worker/index.ts` 处理 `/api/*`、登录门闩与私有预览，`dist/` 只放客户端资产。`run_worker_first=true` 保证预览正文先经过会话检查；Worker 明确处理 SPA 路由，未知资源返回 404；含路径编码或重复斜杠的非规范路径在资产解析前拒绝，防止预览正文绕过登录。query 编码不受影响。

```
https://gzh.codepi.app/          审核台 H5（Vite）
https://gzh.codepi.app/login
https://gzh.codepi.app/p/<slug>/ 预览壳（会话门闩；同域正文内嵌，外域 iframe）
https://gzh.codepi.app/previews/ 演示 HTML（同样要登录）
https://gzh.codepi.app/api/*     Worker：OTP、session、board、review
```

密钥只走 wrangler secrets，**不要**写进 git / `wrangler.toml` `[vars]`。

下表及 OTP/Cookie 参数描述旧本地登录模式，仅用于 `SSO_ENABLED=0` 的隔离开发/测试，不是生产 SSO 配置清单。生产和 staging 的 Auth binding、SSO 变量与 secret 要求以当前运行配置和下方发布规范为准。

| 名称 | 放哪 | 用途 |
| --- | --- | --- |
| `RESEND_API_KEY` | secret | 旧 OTP 模式发信；本地省略时不发送邮件，合成验证码通过 dev 响应取得，不写日志 |
| `SESSION_SECRET` | secret | 会话 token 哈希 |
| `OTP_PEPPER` | secret | OTP 哈希盐 |
| `ALLOWLIST` | var | 逗号分隔邮箱，默认 `kedoupi@gmail.com` |
| `OTP_FROM` | var | 默认 `otp@kdp.cool` |
| `ACCOUNT_BRAND` | var | 默认 `珂抖屁` |
| `ENVIRONMENT` | var | `production` / `preview` / `development` / `test` |

OTP：6 位数字，`SHA-256(code + OTP_PEPPER)` 存 D1，TTL **8 分钟**。同邮箱 60s 冷却、15 分钟 ≤3、日 ≤10；同 IP 15 分钟 ≤10；同码校验失败 5 次作废。响应统一「若在名单内将发送」，防枚举。

Cookie：`gzh_session`；`HttpOnly; Secure; SameSite=Lax; Path=/`；约 7 天。本地 HTTP 开发会去掉 `Secure`，否则浏览器不带 cookie。

## 运维与受控发布

远程迁移和部署统一遵循 [CF 治理规范](../../docs/development/cloudflare-governance.md) 与 [集成发布流程](../../docs/development/integration-release.md)，使用规定的 GitHub Actions 入口；不要照旧的一期指引连接 Pages Git 自动构建或直接修改 Dashboard 绑定。

### 资源与迁移目标

- production：Worker `codepi-gzh`，D1 `codepi-gzh`，`AUTH` 指向 `codepi-auth`。
- staging：已于 2026-10-18 全面退役，仓库与云端的 named environment、D1 和域名均已删除；只有 local 与 production 两档。
- 两个环境的 D1 binding 都为 `DB`。准确 UUID 只维护在 [运行配置](wrangler.toml) 和 [资源登记表](../../docs/development/cloudflare-resource-registry.md)，这里不复制易过时的 ID。
- 迁移来自 `migrations/`。不要假定现有库是空库或某一 migration 尚未应用；按目标环境核实状态，再经授权的受控流程执行。

本地初始化使用下方的 `db:migrate:local`。`db:migrate:remote` 显式指向 production 库，不是 staging 命令，也不是默认发布入口；仅在符合治理规范且获授权的例外操作中使用，不能直接追加 preview 环境后假定目标会自动切换。如需启用 staging，必须另行落实发布入口和精确迁移目标。

### SSO、密钥与构建

`wrangler.toml` 声明本环境的 `AUTH` binding、`AUTH_CLIENT_ID=gzh`、`AUTH_ORIGIN` 和 `SSO_ENABLED=1`。生产必需的 `AUTH_CLIENT_SECRET` 与 Auth 的 `SSO_CLIENT_SECRET_GZH` override 配对，`DESK_SUMMARY_TOKEN` 与首页的 `WECHAT_SUMMARY_TOKEN` 配对。重构时可安全生成新值；日常部署不轮换。不要把本地 OTP 配置当生产登录配置，也不要把生产凭证复制到 staging。

构建在 `apps/gzh/` 执行 `npm run build`，产物为 `dist`，包括客户端页面和 `assets/preview-session.js`。Worker 由 Wrangler 直接从 TypeScript 打包；不再生成或上传 `_worker.js`。密钥经最小范围的 secret 操作更新，不把控制面掩码或空值重放为整份配置。

### 发布后验收

匿名检查 `/api/health` 的 JSON 响应，以及 `/`、`/p/<slug>/` 的预期登录跳转；再完成真实 SSO 回调、稿件加载、预览、退出及无会话访问检查。HTTP 200 不代表业务验收完成。用合成稿件测试写入；真实发信或对外发布另需授权。

## 本地开发

```bash
pnpm install # 在仓库根目录执行
cd apps/gzh
cp .dev.vars.example .dev.vars
npm run db:migrate:local
npm run dev
```

打开 http://127.0.0.1:8788 。隔离的旧 OTP 本地测试需显式设置 `SSO_ENABLED=0`、`ENVIRONMENT=development`，使用合成身份和测试 secret，且不填写真实 `RESEND_API_KEY`；请求 OTP 的响应提供 `dev_otp`，不会把验证码写日志。不要修改生产/staging 的 SSO 设置来跑本地场景。

```bash
npm run typecheck
npm test
npm run build
```

测试走 Miniflare + 本地 D1，**不调用 Resend**（`ENVIRONMENT=test` 且无 API key，验证码由 mock/dev 通道给出）。

## 路由与表

- `GET /api/health` 公开
- `GET /api/auth/login`、`GET /api/auth/callback`：统一登录入口与回调
- `POST /api/auth/request-otp` `{ email }`：仅旧本地 OTP 模式
- `POST /api/auth/verify-otp` `{ email, code }`：仅旧本地 OTP 模式
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

- [ ] 生产通过统一登录完成回调、会话与退出；真实验证码投递需明确授权
- [ ] 本地关闭 SSO 的合成场景通过 `dev_otp` 验证，不能代替生产 SSO 验收
- [ ] 登录后默认看到 **今天** 三档，每档有标题/状态，不是空卡片
- [ ] 点待审 → `/p/<slug>/` 里是接近成稿的 H5（同域不套 iframe 双层滚动），底栏先锁「请先通读全文」，滚到底才出现 **过 / 要改 / 拒**
- [ ] 点过之后才出现 **可推箱**，再点 **已进箱**
- [ ] `/p/<slug>/` 与 `/previews/…` 无会话 302 `/login`
- [ ] 密钥未进仓库；`wrangler.toml` 只有 vars / D1 绑定

## 一期明确不做

微信推箱 API、多公众号切换、合并 `gzh-preview` draft PR#1。staging 的 Cloudflare Access 是平台隔离要求，不属于此产品功能排除项。
