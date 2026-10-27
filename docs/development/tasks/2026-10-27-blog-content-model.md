# 2026-10-27 Blog 内容模型与前台阅读（第 2 期）

## 范围

承接第 1 期（`codex/blog-review-foundations`，PR #215）。
本期实现 A6 资料来源、A7 系列、A8 分类与多标签，以及 D2 卡片、D3 目录/阅读时长/上下篇、
D4 文末来源与 AI 协作说明、D5 RSS、D6 标签与系列页。

## 实现

- 迁移 `0004_blog_taxonomy.sql`：双表新增 `category`、`tags`(JSON)、`series`、`sources`(JSON)，
  旧 `tag` 回填为单元素 tags；新增 `blog_categories` 表并内置 6 个分类。
- 提交校验：分类必填且必须在分类表内（`unknown_category`）；tags 1–5 个去重；series 可选；
  sources 最多 10 条且仅 https。Desk「管理分类」增删（最多 8 个，被引用分类不可删）；
  待审卡片可改分类/标签/系列（`metadata` 接口，revision 校验，不递增修订）。
- `blog_guide` 返回当前分类列表与 taxonomy 规范。
- 前台：卡片 2.35:1 头图（cover 裁切）、分类、最多 3 个标签、阅读时长（约 400 字/分钟）；
  分类筛选 chips、`/blog/tag/<标签>/`、`/blog/series/<系列>/`；文章页标题锚点与目录、
  阅读时长、标签/系列链接、上一篇/下一篇、文末资料来源与 AI 协作说明；`/blog/rss.xml` 最近 50 篇，
  博客页输出 RSS autodiscovery。筛选页与 RSS 均 no-store，文章缓存沿用 publish/unpublish 清理。

## 验证

- `apps/web` `npm test`：48 项通过（新增分类/标签/来源校验、Desk 分类与元数据、分类筛选、标签/系列页、
  目录、阅读时长、上下篇、RSS 用例）。
- `npm run typecheck:desk`、`npm run build`、`npm run test:browser:desk`：通过；浏览器验收新增
  审核中改标签、2.35:1 卡片封面断言。
- `services/mcp` `npm test`：63 项通过（其中两例 OAuth/元数据测试在并行高负载下出现 ECONNRESET，
  串行重跑全部通过，与本次改动无关）。

## 发布步骤

先对 `codepi-blog` 应用 `0004_blog_taxonomy.sql`，再发布 www 与 MCP；smoke 覆盖分类筛选、
标签/系列页、RSS、Desk 元数据编辑与发布。
