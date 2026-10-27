# 2026-10-27 Blog 审核体验（第 3 期）

## 范围

承接第 2 期（`codex/blog-content-model`，PR #216）。
本期实现 Desk 审核双栏：左侧待审列表、右侧全文；修订对比、小改与小改后发布、审核清单，
以及移动端列表/详情两层切换。不做新稿通知。

## 实现

- 迁移 `0005_blog_revisions.sql`：新建 `blog_revisions`，并从现有 `blog_drafts` 回填当前版。
- 提交与小改在同一个 `db.batch()` 里写工作稿和修订快照。修订行带 `EXISTS`，
  只有工作稿 CAS 成功时才落入，避免冲突请求留下孤立快照。
- Desk：`POST /api/blog/drafts/:slug/revise`（标题/摘要/正文，revision+1，重新渲染并剥离 HTML）；
  `GET /api/blog/drafts/:slug/diff` 返回当前版与 revision-1。归档稿不可小改（`archived`），已发布稿返回 `not_found`。
- 审核页：左列表选中后右侧显示头图、全文、分类/标签/系列、行级对比和小改表单。
  四项审核清单全部勾选后才能点「发布」或「小改后发布」；操作栏固定在详情底部，并位于带 slug 的节点内。
  正文 diff 超过 2,000,000 个单元格时放弃对比。移动端（≤900px）在列表与详情之间切换。
- Desk 全文里的代码、Mermaid 和表格在自身区域内横向滚动，不撑宽页面。

## 验证

- `apps/web` `npm run typecheck:desk`：通过。
- `apps/web` `npm test`：49 项通过（新增小改修订、归档后拒绝小改、diff 与未登录 401 用例）。
- `npm run build`、`npm run test:assets`：通过。
- `npm run test:browser:desk`：通过；覆盖移动端列表/详情切换、清单未勾选时发布禁用、
  分类标签保存不递增修订、小改生成修订 2 并对比上一版、归档/恢复、勾选清单后发布。
- `node scripts/agent/check-migrations.mjs`：35 个迁移文件通过，0005 已登记基线。

## 发布步骤

必须在第 2 期（0004）合并并发布之后。先对 `codepi-blog` 应用 `0005_blog_revisions.sql`，
再发布 www；本期不改 MCP 合约。smoke 覆盖 Desk 双栏、小改、修订对比与发布。
