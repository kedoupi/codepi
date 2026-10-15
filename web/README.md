# 个人主站与本人工作台

公开首页、应用目录、博客由 Astro 静态输出。`/desk/` 只输出没有私人内容的页面壳，通过 Pages Functions 的同域 `/api/*` 接口查询本人数据。

## 本地检查

主站沿用既有 Astro 依赖；工作台测试复用 `auth/` 已有 esbuild、TypeScript、Wrangler/Miniflare，未新增依赖种类。先在 web、auth 安装各自锁文件的依赖。跨应用集成测试还需要 gu、gzh 和 oura 的既有依赖。

在 web 运行：

```sh
npm run build
npm test
npm run typecheck:desk
npm run build:functions
npm run test:browser:desk
```

`astro dev` / `astro preview` 只运行静态页面，不执行 Pages Functions。浏览器验收脚本用本地 Miniflare、合成数据、隔离 Chrome 配置和真实 SSO 流程，监听 localhost:8804（主站）及 localhost:8795（测试认证）。不发送真实邮件、不查询线上私人数据。截图在输出的临时目录。

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

## 上线顺序（本轮尚未执行）

1. 先部署支持 `desk` 的 auth 中心代码，保留原三个客户端注册。为新客户端生成独立 secret，在现有 `SSO_CLIENTS` 中增加 `desk`，精确回调为 `https://codepi.app/api/auth/callback`。不要覆盖原客户端配置或把 secret 写进仓库。
2. 为三个应用分别生成独立 `DESK_SUMMARY_TOKEN`，部署只读接口。Health 是 Worker，GU/公众号是 Pages 应用，各自在其实际运行环境设置 secret。禁止复用 SSO、Oura、上传或 MCP token。Preview 不继承生产凭证。
3. 创建工作台专用 D1（建议名 `kdp-desk`），仅存 SSO 事务与会话。应用 `web/migrations/0001_desk_sso.sql`；不绑定三个业务库。
4. 在 `kdp-portal` Production 的 Pages Functions 设置以下绑定和变量：

| 名称 | 值 / 来源 |
| --- | --- |
| `DB` | 新工作台 D1 |
| `AUTH` | service binding → `kdp-auth` |
| `AUTH_ORIGIN` | `https://auth.codepi.app` |
| `AUTH_CLIENT_ID` | `desk` |
| `SSO_ENABLED` | `1` |
| `AUTH_CLIENT_SECRET` | 与中心新 desk 注册一致的独立 secret |
| `HEALTH_SUMMARY_TOKEN` | 与 Health 的摘要 token 一致 |
| `GU_SUMMARY_TOKEN` | 与 GU 的摘要 token 一致 |
| `WECHAT_SUMMARY_TOKEN` | 与公众号的摘要 token 一致 |

5. 发布 web：Root directory 仍为 `web`，构建 `npm run build`，输出 `dist`。Pages 额外编译 `web/functions/`；`public/_routes.json` 仅让 `/api/*` 进入 Functions，其他公开页面继续静态服务。不需要将整站改为 SSR 或新增 Worker 路由。
6. 实际验收登录、三来源读取、摘要、退出、其他应用会话撤销。代码已为 www 的工作台页面和 GET API 配置到 apex 的临时跳转；www 的写请求拒绝执行。发布后确认跳转生效，勿额外登记 www 回调。
7. 回退时撤回 web 部署即可恢复公共站入口；新增源接口没有业务写入。如退役工作台，撤销 desk 注册及三份摘要凭证，保留原应用注册与数据库。

缺少配置时接口明确拒绝请求；不要临时绕过登录使页面“看起来能用”。
