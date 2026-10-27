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
2. 核对三个应用 Worker 的只读接口和各自独立的 `DESK_SUMMARY_TOKEN`，仅在缺失或明确获授权轮换时配对写入。禁止复用 SSO、Oura、上传或 MCP token。本地测试只用合成配置；staging 已退役。
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

5. 按[本地发布操作](../../docs/development/local-release.md)从干净且等于远程 main 的源码持锁发布：在 `apps/web/` 执行 `npm run build`，输出 `dist`，再由 `deploy-worker.mjs web <SHA>` 封装 Wrangler 上传 `worker/index.ts` 与静态资产并记录版本。Actions 只验证。`assets.run_worker_first = ["/api/*", "/desk", "/desk/*"]` 保证 API 不被静态文件覆盖，其余页面直接使用 Static Assets；`_headers` 和路径型 `_redirects` 继续生效；www 的 Desk 跳转由 Worker 实现。旧 Pages `_worker.js` 与 `_routes.json` 不再产出，并由 `.assetsignore` 排除。
6. 实际验收登录、三来源读取、摘要、退出、其他应用会话撤销。代码已为 www 的工作台页面和 GET API 配置到 apex 的临时跳转；www 的写请求拒绝执行。发布后确认跳转生效，勿额外登记 www 回调。
7. 回退需同时核对 Worker version、域名归属与配对凭证，旧 Pages 已退役，不能作为现成回退目标。如退役工作台，撤销 desk 注册及三份摘要凭证，保留原应用注册与数据库。

缺少配置时接口明确拒绝请求；不要临时绕过登录使页面“看起来能用”。

## Agent 写作与图片

统一连接 `https://mcp.codepi.app/mcp`，使用现有 `blog.read` / `blog.write`。以下是本地实现的接口；生产状态见[任务记录](../../docs/development/tasks/2026-10-26-blog-agent-images.md)。

可直接向 Agent 说：

> 帮我写一篇关于……的博客。先查看我已有文章，避免重复；把我提供的图片上传，选择一张作封面，正文按内容放图并写图注。完成后提交审核，给我预览和审核入口。不要编造我的经历。

改稿时说：

> 查看文章 `<slug>` 的审核意见，读取当前修订，按意见修改后重新提交。保留已经公开的版本，等待我审核。

工具顺序：`blog_guide`（写作与配图规范）→ `blog_list(view=submissions)` → `blog_get` → 上传配图 → `blog_submit` → 主人在 `/desk/` 审核。`blog_get` 默认读取草稿，`view=published` 读取公开快照。长正文按 `next_offset` 读取，并沿用首屏 `revision` 作为 `expected_revision`，避免混合版本。`blog_list` 只返回摘要。

- `blog_upload_image({data_base64,alt})`：PNG、JPEG、WebP，原文件不超过 192 KiB。传普通 base64，不带 `data:` 前缀。
- `blog_create_image_upload({alt,bytes,content_type})`：原文件最多 8 MiB，返回十分钟有效的单次 PUT 地址及专用 headers；Agent 发送原文件字节（不是 multipart），HTTP 返回图片结果。不发送 MCP Bearer。没有 HTTP PUT 能力的 Agent 使用前一种方式。
- 两种方式都返回 `id`、`url`、`markdown`、宽高。正文使用返回的 Markdown，图片 title 可写图注，如 `![描述](/blog/media/<id> "图注")`；`cover_media_id` 使用图片 id。每稿最多 30 张不同图片（含封面）。外部图片先由 Agent 下载再上传；不支持 SVG 或外部热链。
- `blog_submit` 包含 `slug`、`title`、`summary`、`body_markdown`、`cover_media_id`，可选 `tag`。每篇必须有头图，建议 2.35:1、1800×766 或更大；比例或尺寸不达标不阻断提交，在返回的 `warnings` 中提示。新文章可省略 `base_revision` 或传 `0`；更新已有稿件必须传 `blog_get` 返回的 `revision`，版本不一致会被拒绝。重试同一次提交沿用 `request_id`。`is_test=true` 仅用于联调：测试稿件不进入 Desk 审核队列、不能发布，恢复后才可审核。
- Desk 审核卡片可展开阅读全文与配图（含 Mermaid），无需跳转预览；待审或已拒绝稿件可归档，`/api/blog/drafts?view=archived` 列出测试与已归档稿件，`POST /api/blog/drafts/:slug/archive|restore` 均需 `{revision}`。归档稿件不能发布；重新提交会清掉归档与测试标记并回到审核队列。
- 图表使用 ` ```mermaid ` 代码块。文章页和草稿预览按需渲染 SVG，并保留可展开的 Mermaid 源码；渲染失败时显示提示和原始代码。已有稿件无需为图表支持重新提交。
- 提交返回 `pending`、`preview_url`、`review_url`。预览及未发布图片要求本人登录。公开文章采用已审核快照，后续改稿不直接改公开内容。`blog_retract` 仅撤回待审核版本。

图片存储使用私有 `BLOG_MEDIA` R2，每次读取核对是否被正式文章引用。未发布图片本人可读；下架或替换后失去公开引用的图片不再公开，响应均 `no-store`。已经被下载的公开图片无法收回。数据库索引和原件纳入 Ops v4 备份；没有自动删除原件。

本任务发布依赖：先创建并核验私有 `codepi-blog-uploads`，应用 `migrations-blog/0002_blog_media.sql`，发布 www，再发布 MCP 与依赖 `BlogMediaBackup` 的 Ops。普通开发不执行这些远程步骤。

## 运维记录

- 2026-10-16：Desk 的 `AUTH_CLIENT_SECRET` 经中央 per-client override（`SSO_CLIENT_SECRET_DESK`）轮换，应用侧同值配对后重发；轮换后 Desk 现有登录需重新登录。
