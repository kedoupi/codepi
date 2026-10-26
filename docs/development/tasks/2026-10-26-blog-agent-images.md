# Blog Agent 写作与配图

用户目标：在现有 Agent MCP 连接中完成写文章、上传图片、读取反馈并修改，在网站以统一响应式版式阅读。2026-10-26 已实现、本地验证与独立服务端审查完成，尚未提交或部署。

- task_id: blog-agent-images
- branch: codex/blog-agent-images
- base_sha: f6fb328aef50b46338903dfc579997649f25c49a
- worktree: /Users/codepi/.worktrees/codepi/codex/blog-agent-images
- 授权：设计、实现、本地验证。没有本任务的 commit、push、PR、合并、迁移、创建云资源或部署授权。

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

追加迁移 `0002_blog_media.sql`：媒体元数据、短期上传槽、草稿和正式版封面与图片引用、正式版 Markdown 回填。原迁移不改动。`codepi-blog-uploads` 仅 planned；www 绑定 BLOG_MEDIA，Ops 经 `BlogMediaBackup` named RPC 只读备份。MCP 不绑定业务库和桶。

发布须先创建核验私有 R2、迁移 Blog D1、发布 www named RPC，再发布 MCP/Ops。无远程就绪或发布证据。备份 v4 覆盖 GU、Me、Blog，恢复兼容旧 v2/v3；未发布新 www 能力前不能发布依赖该 binding 的 Ops。

## 验证记录

- `node scripts/agent/check.mjs --base f6fb328aef50b46338903dfc579997649f25c49a --run` 已执行：Cloudflare 190、agent/check 35、migration tests 7；Web/Auth/GU/GZH/Health/Project/Me/MCP 的选定测试、类型检查、构建与资产检查，以及 Health/MCP 浏览器检查均通过。Ops 单测 46、构建通过；首次 Ops runtime 因 fixture binding 名称不一致失败，修正为生产 `BlogMediaBackup` 与 BLOG binding 后 `pnpm --dir services/ops test:runtime` 通过（真实 named RPC、加密原件、隔离 D1/R2 恢复）。
- 因全量 runner 在该失败处停止，已单独补跑余下 CLI test/typecheck/build、shared auth tests，全通过。无跳过失败继续冒充整条 runner 一次成功。
- 新增图片容器与旧 Markdown 回归：Blog 最新 32/32 通过；最后完整 Web 42/42、治理、32 migration、lint、git diff --check 全通过。真实 PNG/WebP/JPEG inline 与 PUT 成功；残缺容器和越界尺寸拒绝。
- MCP build/typecheck 与 29 项针对性测试通过；最终严格图片校验后 domains 5 项、modules 6 项复跑通过。真实 MCP → Blog named RPC → D1/R2 验证，已移除 Blog echo stub。
- `test:browser:desk` 通过：本地合成 SSO、审核 publish revision、13 篇列表 12/1 分页、封面加载、图注、代码局部滚动、退出后审核 DOM/图片/输入清理。320/375/768/1024/1440px 无页面横向溢出。
- 截图：`/var/folders/tf/by849xr51djfhx_x0fw2rqth0000gn/T/kdp-desk-browser-2byJsQ`，已读取桌面列表与手机文章截图；1200×675 合成 PNG 替代最初 1×1 空白图证据。
- 独立审查修复：仅有图片格式头会误入 ready media → 校验 PNG chunk/CRC/IDAT/IEND、JPEG segments/scan/EOI、WebP chunk/raster；迁移不能回填的旧正式版 Markdown → `markdown_unavailable` 409，避免谎报空文章。无新增依赖。

边界：图片验证是容器/尺寸校验，不是完整像素解码；animated WebP 不支持。浏览器使用 CDP synthetic harness，原生确认框以测试替身覆盖并断言文案，按钮 DOM click，未测物理点击。没有真实 Agent 账号、生产 R2、迁移、远程 smoke 或部署验收。单元/合成 SDK 验证不等于真实 Agent 账号验收。
