# Blog Agent 写作与配图

用户目标：在现有 Agent MCP 连接中完成写文章、上传图片、读取反馈并修改，在网站以统一响应式版式阅读。2026-10-26 已实现、审查、合并并上线，真实 CLI 与生产备份验收完成；发布后观察结果见末节。

- task_id: blog-agent-images
- branch: codex/blog-agent-images
- base_sha: f6fb328aef50b46338903dfc579997649f25c49a
- worktree: /Users/codepi/.worktrees/codepi/codex/blog-agent-images
- release_worktree: /Users/codepi/.worktrees/codepi/codex/blog-agent-release
- merged_sha: 0ce86cf987b89d1fc438bbf85bdb90a4fead836f
- 授权：设计、实现和本地验证后，用户进一步明确授权本次博客功能提交、合并、创建私有图片桶、迁移 `codepi-blog`、发布 www/MCP/Ops 并验收。未授权轮换 secret、删除数据、清理 worktree 或回退数据库。

## 设计与使用

1. `blog_list(view=submissions)` 查看稿件；`blog_get(slug)` 读取正文、revision、审核意见。长正文按 Unicode 字符分页，继续时传 `expected_revision`。
2. 小图用 `blog_upload_image(data_base64,alt)`，解码后上限 192 KiB；本地大图用 `blog_create_image_upload(alt,bytes,content_type)` 获取十分钟有效的单文件 PUT 凭证，按返回的 headers 发送原文件，单张最多 8 MiB。上传结果包括 id、URL、Markdown、尺寸。无 HTTP 能力的客户端可使用小图方式。
3. 正文使用返回的 Markdown；图片的可选 Markdown title 是图注；`cover_media_id` 指定封面。不接受外部热链或 SVG。使用统一本站媒体地址，避免外链失效、跟踪和私有地址抓取。不实现远程 URL 抓取；Agent 下载后上传。
4. `blog_submit` 提交完成稿，更新时带 `base_revision`，新文章可传 0；同一次重试沿用 `request_id`。返回 Desk 审核与登录预览地址。
5. 主人在 Desk 审核；正式版是单独快照。新修订保持 pending，旧正式版继续展示；拒绝意见由 Agent 读取并修改。Desk 审核携带 revision 防止审核错误版本。
6. 图片位于私有 R2，公开读取前每次核对已发布文章引用，未发布图片只有本人 SSO 可读取。图片 no-store；下架后不继续从应用缓存公开图片。已经下载的公开内容无法收回。
7. 列表分页、封面、阅读宽度、图片原始比例与图注、代码与表格滚动、日期、SEO metadata 遵循共享设计。

现有 OAuth scopes 不变（blog.read/blog.write）。PAT 仍按选定 scope；write 不隐含 read。图片单文件临时凭证与 MCP Bearer 完全分离，不在 URL 中携带。

## 文件所有权

协调者与公共接口负责人为主会话。所有写入都在以上任务 worktree，文件互不重叠。

| 执行者 | 允许写入 | 依赖与状态 |
| --- | --- | --- |
| 主会话 | server/、worker/blog.ts、wrangler、shared MCP、MCP 服务和测试、任务文档 | 负责领域接口及最终集成 |
| 备份子任务 a9181907fed3b4354 | scripts/cloudflare/、services/ops/、docs/development/cloudflare-*.md | 已交付 v4 原件备份与恢复，本地结果待完整集成复核 |
| UI 子任务 ab4d5cab18f9ec2de | worker/index.ts、blog.css、blog/index.astro、desk.ts、desk.css、scripts/browser-desk.mjs | 已交付，桌面/手机本地浏览器验收通过 |
| 测试子任务 a7d7aa73637b60a2c | apps/web/test/、services/auth/test/runtime.mjs 的可选 R2 fixture 配置 | 已交付；另只读审查服务端，两个发现已修复并补回归 |

## 数据与发布依赖

追加迁移 `0002_blog_media.sql`：媒体元数据、短期上传槽、草稿和正式版封面与图片引用、正式版 Markdown 回填。原迁移不改动。生产 `codepi-blog-uploads` 已创建并核验为私有；www 绑定 BLOG_MEDIA，Ops 经 `BlogMediaBackup` named RPC 只读备份。MCP 不绑定业务库和桶。

发布顺序已执行为：创建并核验私有 R2、迁移 Blog D1、发布并验收 www named RPC，再发布 MCP/Ops。备份 v4 覆盖 GU、Me、Blog，恢复兼容旧 v2/v3。

## 验证记录

- `node scripts/agent/check.mjs --base f6fb328aef50b46338903dfc579997649f25c49a --run` 已执行：Cloudflare 190、agent/check 35、migration tests 7；Web/Auth/GU/GZH/Health/Project/Me/MCP 的选定测试、类型检查、构建与资产检查，以及 Health/MCP 浏览器检查均通过。Ops 单测 46、构建通过；首次 Ops runtime 因 fixture binding 名称不一致失败，修正为生产 `BlogMediaBackup` 与 BLOG binding 后 `pnpm --dir services/ops test:runtime` 通过（真实 named RPC、加密原件、隔离 D1/R2 恢复）。
- 因全量 runner 在该失败处停止，已单独补跑余下 CLI test/typecheck/build、shared auth tests，全通过。无跳过失败继续冒充整条 runner 一次成功。
- 新增图片容器与旧 Markdown 回归：Blog 最新 32/32 通过；最后完整 Web 42/42、治理、32 migration、lint、git diff --check 全通过。真实 PNG/WebP/JPEG inline 与 PUT 成功；残缺容器和越界尺寸拒绝。
- MCP build/typecheck 与 29 项针对性测试通过；最终严格图片校验后 domains 5 项、modules 6 项复跑通过。真实 MCP → Blog named RPC → D1/R2 验证，已移除 Blog echo stub。
- `test:browser:desk` 通过：本地合成 SSO、审核 publish revision、13 篇列表 12/1 分页、封面加载、图注、代码局部滚动、退出后审核 DOM/图片/输入清理。320/375/768/1024/1440px 无页面横向溢出。
- 截图：`/var/folders/tf/by849xr51djfhx_x0fw2rqth0000gn/T/kdp-desk-browser-2byJsQ`，已读取桌面列表与手机文章截图；1200×675 合成 PNG 替代最初 1×1 空白图证据。
- 独立审查修复：仅有图片格式头会误入 ready media → 校验 PNG chunk/CRC/IDAT/IEND、JPEG segments/scan/EOI、WebP chunk/raster；迁移不能回填的旧正式版 Markdown → `markdown_unavailable` 409，避免谎报空文章。无新增依赖。

## 生产发布与真实验收

- PR #196 已合并为 `0ce86cf987b89d1fc438bbf85bdb90a4fead836f`，最终 14 项检查通过。首次 `health-build` 的浏览器回归出现 `.sleep-controls button` 数量为 0，失败 job 重跑后通过；本任务没有修改 Health 代码。
- 发布源为干净 detached worktree，HEAD 与当时实时远程 main 一致。私有桶 `codepi-blog-uploads` 于 `2026-10-26T00:34:12.460Z` 创建，控制面未返回公开域名或公开访问配置；`codepi-blog`（`22e27bb5-230a-4b89-b969-3dc29c8a1d22`）已应用 `0002_blog_media.sql` 并确认 `blog_media`、`blog_uploads`。
- www：`9e8e3a5f-c76b-4c58-aada-b659317887e6` → `11cd1860-75f5-4cbf-84f7-e0a3e1e7c7bf`；MCP：`78e3b6e7-419d-4a6e-a6c3-64b1b9cdbc04` → `ee21dcbb-dae3-4df1-8373-62da79512773`；Ops：`22741311-4c7c-436d-8dcf-2d6c2af5c9f5` → `8f722bd4-f5f9-44bb-8d76-ed141dac4ad6`。三者均为单一版本 100% 承流、`BUILD_SHA=0ce86cf987b8`。www 的 `BLOG_MEDIA`、MCP 的 `BLOG=codepi-www#BlogMcp`、Ops 的 `BLOG=codepi-www#BlogMediaBackup` 均已核对；MCP/Ops 的 workers.dev 保持关闭，没有轮换 secret。
- `check-pages.mjs web production` 与 MCP `check:live` 通过。后者覆盖凭证配对、发现、匿名拒绝和连接管理入口，不冒充真实授权或领域调用。三服务真实 version 与 smoke 已追加到 Git 外 `/tmp/codepi-deployment-evidence.jsonl`。
- 真实 `codepi CLI` 经生产 OAuth 授权后，直接调用线上 Blog MCP：`blog_list(view=submissions)`、inline PNG 上传、单次 PUT PNG 上传、带封面和两处图注的 `blog_submit`、`blog_get` 与 `base_revision` 改稿均成功。Desk 对合成验收稿写入拒绝意见后，CLI 读到相同意见并再次按 revision 提交；最终 `agent-blog-media-acceptance-20261026` 保持 pending revision 3，未公开发布。本人预览实际显示封面、两张图片与图注；公开文章及两张未发布图片的匿名请求均为 404，媒体响应为 no-store。
- 生产完整备份实例 `cf_d2bc8d1d03d9bb71feedde0f1c1d1da2afa95b56a0758fcb2bfbf418e821df71` 于 `2026-10-26T00:49:38.520Z` 完成。v4 manifest 覆盖 9 个 D1、GU 112 件、Me 2 件和 Blog 2 件；两个 Blog `material_id` 与本次真实上传 ID 完全一致。`reports/backup/latest.json` 为 `r2=complete`、`ok=true`、`build=0ce86cf987b8`。Workflow 已逐件校验源与密文并提交清单；本次未另做该生产实例的隔离恢复，既有本地 runtime 已覆盖隔离恢复路径。
- 发布后观察 `release-0ce86cf987b8-blog196` 已完成，Workflow 实例 `cf_07a6868d5622510636b6d03cac712d0aae388802f85f2e8678b7bf48c3c36f80`；manifest 推导 www/Ops `rollback_allowed=false`、MCP 为 true。2026-10-26T01:15:00.321Z 写入最终 summary：`healthy_reported`，t=0/5/10/15/20/25/30 七轮完成；末轮 www/MCP/Ops 均为 `healthy`，活动版本与 manifest 一致，无版本错配、硬失败或观测读取失败，`rollback=null`。该结论是平台观察证据，不代替所有者对实际使用的确认。

边界：图片验证是容器/尺寸校验，不是完整像素解码；animated WebP 不支持。本地浏览器使用 CDP synthetic harness，原生确认框以测试替身覆盖并断言文案，按钮 DOM click，未测物理点击；生产验收补充了真实 OAuth、CLI、MCP、R2、预览和 Desk 审核链路。公开布局尚未用真实大尺寸照片发布验收，合成草稿保持私密。
