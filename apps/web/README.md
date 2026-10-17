# 个人主站与本人工作台

公开首页、应用目录、博客由 Astro 静态输出，通过 Workers Static Assets 发布。`/desk/` 只输出没有私人内容的页面壳，通过同一 Worker 的 `/api/*` 接口查询本人数据。

## 本地检查

主站沿用既有 Astro 依赖；工作台测试复用 `services/auth/` 已有 esbuild、TypeScript、Wrangler/Miniflare，未新增依赖种类。从仓库根目录运行 `pnpm install --frozen-lockfile`，一次安装跨应用测试需要的全部 workspace 依赖。

在 web 运行：

```sh
npm run build
npm test
npm run typecheck:desk
npm run test:assets
npm run test:browser:desk
```

`astro dev` / `astro preview` 只运行静态页面。构建后用 `pnpm exec wrangler dev --port 8804` 运行 Worker 与静态资产；本地 Desk 登录还需本地 Auth、匹配的合成配置及 SSO migration。`test:assets` 用 Wrangler 配置和其 Miniflare/workerd 运行真实 Static Assets，验证静态头、404 和 API 优先路由。浏览器验收脚本用本地 Miniflare、合成数据、隔离 Chrome 配置和真实 SSO 流程，监听 localhost:8804（主站）及 localhost:8795（测试认证）。不发送真实邮件、不查询线上私人数据。截图在输出的临时目录。

## 路由与数据边界

- `GET /api/auth/login`：固定回到 `/desk/` 的统一登录。
- `GET /api/auth/callback`：SSO 回调，身份固定为本人。
- `POST /api/auth/logout`：沿用中央会话撤销语义。
- `GET /api/desk/me`：验证当前工作台会话。
- `GET /api/desk/overview`：读取三个应用的当前摘要。
- `POST /api/desk/summary`：JSON 包含 `range: current | week` 和 `sources: (health | gu | wechat)[]`，至少一个来源且不能重复。只查询所选应用。

各应用新增 `/api/internal/desk-summary?range=current|week`，使用每应用独立的 `DESK_SUMMARY_TOKEN`（至少 32 字符）鉴权。主站固定请求三个生产域名，不允许调用者指定地址，拒绝上游重定向，不转发浏览器 Cookie。每来源最多等待 8 秒、响应上限 32 KiB；单来源失败返回部分结果。

所有私有响应 no-store；每次聚合前后验证本人会话。页面退出、切到后台或离开时清除内存中的概览与摘要；返回页面重新验证。工作台不在 sitemap，公开首页不发出私人数据请求。摘要不落库，不调用模型，不触发源数据同步。

Health 统计 Asia/Shanghai 最近 7 个日历日（含今天），每指标独立计算有效覆盖天数；当前仅有评分和步数，不能用睡眠贡献评分冒充睡眠时长。GU 始终为当前快照；公众号排除演示稿件，已进箱不代表已发布。

## 发布与配置核对

远程迁移和发布遵循 [CF 治理规范](../../docs/development/cloudflare-governance.md) 的受控入口。以下是 Desk 配置依赖与验收顺序，不代表本次已执行，也不授权重新创建现有资源；实际资源、绑定及未决项见 [CF 资源登记表](../../docs/development/cloudflare-resource-registry.md)。

1. 核对 Auth 中心已支持 `desk`，同环境 `SSO_CLIENTS` 中已有对应注册，production 精确回调为 `https://codepi.app/api/auth/callback`。只有注册缺失且获授权时才新增独立 secret；不要覆盖原客户端或无故轮换现有凭证，不把 secret 写进仓库。
2. 核对三个应用 Worker 的只读接口和各自独立的 `DESK_SUMMARY_TOKEN`，仅在缺失或明确获授权轮换时配对写入。禁止复用 SSO、Oura、上传或 MCP token。staging 不继承生产凭证。
3. 核对工作台专用 D1：production 为 `codepi-desk`（staging 库已随 2026-10-18 staging 退役删除），仅存 SSO 事务与会话，不绑定三个业务库。迁移来自 `apps/web/migrations/`，是否已应用按对应环境核实，不因本文重复建库。
4. 核对 `codepi-www` production 的 Worker 绑定和变量（staging named environment 已于 2026-10-18 退役删除）：

| 名称 | 值 / 来源 |
| --- | --- |
| `DB` | `codepi-desk`，ID 以当前配置与登记表为准 |
| `AUTH` | service binding → `codepi-auth` |
| `AUTH_ORIGIN` | `https://auth.codepi.app` |
| `AUTH_CLIENT_ID` | `desk` |
| `SSO_ENABLED` | `1` |
| `AUTH_CLIENT_SECRET` | 与同环境中心 desk 注册一致的独立 secret |
| `HEALTH_SUMMARY_TOKEN` | 与 Health 的摘要 token 一致 |
| `GU_SUMMARY_TOKEN` | 与 GU 的摘要 token 一致 |
| `WECHAT_SUMMARY_TOKEN` | 与公众号的摘要 token 一致 |

5. 受控 workflow 在 `apps/web/` 执行 `npm run build`，输出 `dist`，再由 `wrangler deploy` 同时上传 `worker/index.ts` 和静态资产。`assets.run_worker_first = ["/api/*", "/desk", "/desk/*"]` 保证 API 不被静态文件覆盖，其余页面直接使用 Static Assets；`_headers` 和路径型 `_redirects` 继续生效；www 的 Desk 跳转由 Worker 实现。旧 Pages `_worker.js` 与 `_routes.json` 不再产出，并由 `.assetsignore` 排除。
6. 实际验收登录、三来源读取、摘要、退出、其他应用会话撤销。代码已为 www 的工作台页面和 GET API 配置到 apex 的临时跳转；www 的写请求拒绝执行。发布后确认跳转生效，勿额外登记 www 回调。
7. 回退需同时核对 Worker version、域名归属与配对凭证；旧 Pages 若凭证已轮换，不能只恢复 DNS 就视作可用回退。如退役工作台，撤销 desk 注册及三份摘要凭证，保留原应用注册与数据库。

缺少配置时接口明确拒绝请求；不要临时绕过登录使页面“看起来能用”。

## 运维记录

- 2026-10-16：Desk 的 `AUTH_CLIENT_SECRET` 经中央 per-client override（`SSO_CLIENT_SECRET_DESK`）轮换，应用侧同值配对后重发；轮换后 Desk 现有登录需重新登录。
