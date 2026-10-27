# 2026-10-27 Blog 审核基础（第 1 期）

## 范围与决策

主流程核对后，所有者决定分三期实现缺口，每期独立 PR、合并后从干净 main 本地发布。
本期为第 1 期：并发安全、AI 可读规范、头图约束、测试稿件、Desk 全文审核与归档。
所有者已确认：不做新稿通知（C5 暂缓）；每篇必须有头图；生产现有测试稿上线后归档（不删除）。
后续期次：第 2 期内容模型（来源/系列/分类标签）与前台阅读（卡片、目录、RSS 等）；
第 3 期审核体验（小改后发布、修订对比、审核清单、审核页版式）。

基线：`50b17fedcaf33be7446d168fa2c9dd276230380a`（实时 origin/main）。

## 实现

- revision 乐观并发补齐：下架必须校验 `revision`；Desk 发布/拒绝/下架/归档/恢复均要求 `{revision}`；
  更新已有稿件 `blog_submit` 必须带 `base_revision`（新稿可省略或传 0）。
- `blog_guide` MCP 工具（`blog.read`）：写作、配图、提交与审核清单规范，单一来源 `apps/web/server/guide.ts`。
- 头图必填：`cover_media_id` 缺失返回 `cover_required`；比例偏离 2.35:1（接受 2.2–2.5）或宽度小于
  1800 像素不阻断提交，在响应 `warnings` 中提示（幂等重试返回相同 warnings）。
- `is_test` 测试标记：测试稿件不进 Desk 审核队列与待审计数、不能发布（`test_draft`）。
- 归档/恢复：`blog_drafts.archived_at`，归档稿件不能发布（`archived`），恢复回到审核队列；
  重新提交会清除归档与测试标记。已发布文章不可归档（先下架）。
- Desk 审核卡片内展开阅读全文与全部配图（含 Mermaid 渲染，复用公开页的同一 sanitized `body_html`），
  新增"测试与归档"列表及归档/恢复操作。
- 迁移 `apps/web/migrations-blog/0003_blog_review.sql`：`is_test`、`archived_at` 与审核队列索引。

## 本地验证

- `apps/web` `npm test`：45 项通过（含新增头图/warnings、测试稿、归档恢复、guide 用例）。
- `npm run typecheck:desk`、`npm run build`、`npm run test:assets`：通过。
- `npm run test:browser:desk`：通过；新增全文展开、归档/恢复的真实浏览器操作断言与截图。
- `services/mcp` `npm test`：63 项通过；`pnpm typecheck`、`pnpm build`：通过。

## 发布步骤（合并后执行）

1. 从干净且等于实时 main 的源码持 `codepi-production-release.lock`。
2. 先对 `codepi-blog` D1 应用 `0003_blog_review.sql`，再发布 www 与 MCP（其余 Worker 按全量同步惯例处理漂移）。
3. 生产 smoke：guide 工具、带头图提交、测试稿隔离、Desk 全文与归档。
4. 将生产现有测试稿归档（所有者已授权），保留数据不删除。
