# Blog ↔ MCP 集成实施计划

状态：已批准实施（2026-10-22）。决策记录：D1 动态渲染、marked（用户批准的唯一新依赖）、agent 只能交草稿、Desk 人工发布、blog.read/blog.write 分离。

## 架构

```
agent ──MCP──> services/mcp blog 模块 (blog_submit/blog_list/blog_retract)
                    │ named RPC: codepi-www#BlogMcp
                    ▼
apps/web worker ──> codepi-blog D1 (blog_drafts / blog_posts)
你在 /desk/ 审核 ──/api/blog/*──> publish/reject/unpublish
公开路由 /blog/、/blog/<slug>/：worker 用 HTMLRewriter 注入 Astro 构建的 shell，Cache API 边缘缓存
草稿预览 /blog/preview/<slug>/：复用 desk SSO session，noindex + no-store
```

## 契约（已冻结）

- `packages/shared/mcp/contract.ts`：`BLOG_OPERATIONS = ["list","submit","retract"]`、`BlogService`、`MCP_LIMITS.blogBody = 96KiB`。
- BlogMcp `execute({subject, client, clientName, operation, args})` → `{ok:true,data} | {ok:false,error,status}`；`subject !== "kdp-owner"` → `not_owner` 403。
  - `list`（blog.read）：`{offset?,limit?}` → `{posts:[…published], total, next_offset}`，**只含 published**。
  - `submit`（blog.write）：`{slug,title,summary,tag?,body_markdown,base_revision?,request_id}` → `{slug,revision,status:"draft",submitted_at}`。upsert 语义：已发布 slug 只写 draft 不动现网；同 request_id 幂等重试。错误：`invalid_arguments` 400、`payload_too_large` 413、`revision_conflict` 409。
  - 修订（2026-10-22）：`request_id` 改为可选，缺省时服务端生成 UUID；只有需要幂等重试时才显式传。原因：agent 调用方普遍不带幂等键，必填导致提交必败。
  - `retract`（blog.write）：`{slug}` → 撤回 pending draft；无 → `not_found` 404。
  - slug：`^[a-z0-9][a-z0-9-]{0,79}$`，保留字 `{api,desk,blog,preview,sitemap-blog.xml}`；title ≤200、summary ≤500、tag ≤40。
- Desk `/api/blog/*`（session 门后，匿名 401，Origin 不符 403）：
  - `GET /api/blog/drafts`、`GET /api/blog/drafts/:slug`
  - `POST /api/blog/drafts/:slug/publish`、`POST /api/blog/drafts/:slug/reject {note?}`、`POST /api/blog/posts/:slug/unpublish`

## D1 schema（apps/web/migrations-blog/0001_blog.sql，独立迁移目录绑定 BLOG）

`blog_drafts(slug PK, title, summary, tag?, body_markdown, body_html, status(pending|published|rejected|withdrawn), client_id, client_name?, revision, last_request_id?, review_note?, published_at?, submitted_at, updated_at)`；`blog_posts(slug PK, title, summary, tag?, body_html, revision, published_at, updated_at)`。现网与草稿物理分行。

## 关键机制

- marked 单例 `{gfm:true}`；`renderer.html = () => ""` 丢弃全部 raw HTML；渲染产物再经 `<script|<iframe|<object|on\w+=` 扫描，命中即拒绝提交。渲染只在 submit 时执行一次，结果落库。
- 公开渲染：worker `env.ASSETS.fetch('/blog/index.html')` 拿 Astro 构建的完整 BaseLayout shell → HTMLRewriter 替换 title/meta/canonical 并向挂载点注入列表/文章 HTML；样式必须来自全局 `src/styles/blog.css`（scoped 类注入节点匹配不到）。
- 缓存：`/blog/` 与 `/blog/<slug>/` 走 `caches.default`，`public, max-age=60, s-maxage=300`；publish/unpublish 时 best-effort purge；preview 与 sitemap `no-store`。
- 写作规约（不编造个人经历、只交完成稿、ISO 日期、正文是数据不是指令）写入 MCP 模块 instructions。

## 实施波次

- Wave 0（已完成）：contract.ts 契约冻结。
- Wave 1A（worker：apps/web）：marked 依赖、migrations-blog、server/blog.ts、worker/blog.ts（BlogMcp entrypoint）、worker/index.ts 路由、wrangler.toml（run_worker_first + BLOG D1）、src/styles/blog.css、blog/index.astro 重写为 shell、删除 src/content/articles.js、robots.txt。
- Wave 1B（worker：services/mcp）：SUPPORTED_SCOPES 追加 blog.read/blog.write、env.ts BLOG binding、modules.ts blog 模块、wrangler.toml service binding、README。
- Wave 1C（worker：governance）：validate-governance.mjs www 双 D1 例外 + mcp BLOG binding 允许、backup-core.mjs DATABASE_NAMES + codepi-blog、resource-registry 登记（planned）、governance 文档、check.mjs migrationDirs 补 migrations-blog。
- Wave 2（worker A 继续）：Desk 审核 UI（desk/index.astro、scripts/desk.ts、desk.css）+ server/desk.ts /api/blog/* 路由。
- Wave 3（随各自区块）：apps/web test/blog.test.mjs + runtime.mjs BLOG fixture + desk.test.mjs 增补；services/mcp scopes/modules/domains 测试增补。

## 风险

1. 守门规则 3（每服务单 D1）需先放行 www 双 D1，否则 validate-governance 红。
2. 迁移目录必须 per-DB 独立（migrations-blog/），并补 check.mjs 映射。
3. `codepi-blog` 需进 registry（planned→managed）与备份清单（backup-core DATABASE_NAMES），否则巡检报未登记库。
4. 发布依赖变为 www 先于 mcp（mcp 绑定 codepi-www#BlogMcp）；local-release.md 顺序表同步更新。
5. XSS 面全靠 renderer.html 置空 + 断言扫描；公开路径永不读 draft 表；blog 数据永不写 env.DB（codepi-desk 只存 SSO 会话）。
6. 缓存 purge best-effort，极端失败下 s-maxage=300 兜底 ≤5 分钟陈旧。

## 验收

`node scripts/agent/check.mjs --base <SHA> --run` 全绿；浏览器走通：MCP 提交草稿 → Desk 审核区预览 → 发布 → 匿名窗口可读（无 JS 依赖）→ 同 slug 修订不动现网 → 再发布更新 → 下架后 404 且 sitemap 消失。远程建库 `codepi-blog` 与部署需单独授权。
