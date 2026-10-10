# 公号预览工作台

微信公众号 H5 预览 + 审稿队列。独立仓库，**不是** kdp-tools / oura 的一部分。

本仓库只放工作台和 Worker。文章 HTML 仍只在 Cloudflare Pages（`https://gzh-preview.kdp.cool/<slug>/`），不进 git。

没有登录、没有微信推草稿箱、没有 TZAI。

## 状态

`待审` → 老板审 → `可推箱` 或 `需改` → 人工进箱后改 `已进箱`

| 字段 | 说明 |
| --- | --- |
| id | 与 Pages 目录名相同，如 `2026-09-16-xiaotaozi` |
| slot | `早` / `中` / `晚`（没有档期可留空） |
| title | 标题 |
| url | `https://gzh-preview.kdp.cool/<id>/` |
| status | `待审` / `需改` / `可推箱` / `已进箱` |
| note | 可选备注 |

首页默认打开 **待审** 队列。文章页底栏：过 → `可推箱`；要改 / 拒 → `需改`（可写备注）。

## 黄薇：发预览

1. 把文章目录发到现有 Cloudflare Pages（和现在一样）。
2. 在本仓库 `public/board.json` 里加上这条稿：`status` 设为 **待审**，`url` 用 `https://gzh-preview.kdp.cool/<slug>/`。
3. 把工作台链接发给老板：`https://gzh-preview.kdp.cool/`（首页就是待审队列）。
4. 若这篇以前审过、KV 里还留着旧状态：再 `POST /api/review` 一次 `{ "id": "<slug>", "status": "待审" }` 盖掉。

## 老王：Worker + KV

1. 建 KV：`npx wrangler kv namespace create BOARD_KV`
2. 把返回的 id 填进 `wrangler.toml` 的 `<KV_NAMESPACE_ID>`
3. `npm i` 后 `npx wrangler deploy`
4. 在 Cloudflare 把 **`gzh-preview.kdp.cool/api*`** 指到这个 Worker（Pages 继续托管文章 HTML 和工作台静态页也可以；只要 `/api*` 打到 Worker）

接口：

- `GET /api/board`：静态 `board.json` + KV 审稿记录合并
- `POST /api/review`：`{ "id", "action": "过"|"要改"|"拒", "note"? }` 或 `{ "id", "status", "note"? }`

KV 键：`review:<id>`。

## 本地

```bash
npm i
npm test
npx wrangler dev
```

浏览器打开 `http://localhost:8787/`。本地 KV 是模拟的，占位 id 即可。
