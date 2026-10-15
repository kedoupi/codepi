/**
 * 公开文章内容登记。
 *
 * 每篇文章需要 `slug`、`title`、`summary`、`date`、`displayDate`，可选 `tag`。
 * 文章正文放在 `src/pages/blog/<slug>/index.astro`，沿用 `personal-article`
 * 排版与共享设计 token。
 *
 * 规则：
 * - 只登记已经完成、确认公开的内容；不放占位草稿。
 * - 摘要和标题不编造个人经历，不引用未确认的外部数据。
 * - `date` 用 ISO 日期；`displayDate` 用 `YYYY.MM.DD`。
 */
export const articles = [];
