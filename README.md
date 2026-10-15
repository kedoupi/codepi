# kedoupi（codepi）个人数字空间

`codepi.app` 是 kedoupi（codepi）的个人产品与内容入口。健康、投资理财、公众号工作台承载个人生活与工作；博客、笔记和公共 MCP 按阶段建设。广告收入与流量增长不再作为项目目标。

当前只保留四个产品：首页、GU（投资理财）、GZH（公众号工作台）和 Health，分别使用 `codepi.app`、`gu.codepi.app`、`gzh.codepi.app`、`health.codepi.app`；统一登录在 `auth.codepi.app`。`auth/` 与 `shared/` 作为支撑层保留，不单独对外。

原先的 `calc/`、`convert/`、`text/`、`dev/`、`ai/` 五个静态工具站、主站旧计算器与指南页、`/tools/` 工具存档，以及 `kdp.cool`、`oura.kdp.cool` 域名均已退役，不保留跳转。退役范围与迁移顺序见 [codepi.app 四产品收尾](docs/development/tasks/2026-10-15-codepi-cutover.md)。

整体规划见 [个人数字空间方案](docs/superpowers/plans/2026-10-15-personal-digital-space-roadmap.md)；统一视觉规则见 [共享设计规范](docs/architecture/personal-design-system.md)。

首页是唯一的静态 Astro 站点，通过 `shared/` 与 `@shared/*` alias 复用基础样式和组件。私人应用保留现有技术栈与数据边界。

## 产品与支撑层

| Path | Domain | CF project | 说明 |
| --- | --- | --- | --- |
| `web/` | `codepi.app` + `www.` | `kdp-portal` | 首页、应用介绍、博客与 `desk` 摘要接口 |
| `gu/` | `gu.codepi.app` | `kdp-gu` | 私人投资工作台 |
| `gzh/` | `gzh.codepi.app` | `gzh` | 公众号稿件、预览与审核台 |
| `oura/` | `health.codepi.app` | `oura-kdp` + worker `oura-kdp-api` | Health |
| `auth/` | `auth.codepi.app` | worker `kdp-auth` | 统一登录，四个产品共同依赖 |
| `shared/` | — | — | 布局、样式 token、产品登记等共享源码 |

部署要点：`web`、`gu`、`gzh` 是 Cloudflare Pages 项目；`oura/` 是独立 pnpm workspace，前端发布到 `oura-kdp`，API 用 `cd oura && pnpm deploy:api` 部署 worker。`gzh/` 的目录名和 Pages 项目名是既有资源名，产品标识统一为 GZH；D1 数据库名沿用历史名称以保证数据不变。


## 广告与历史工具

广告脚本、广告组件与占位、`ads.txt` 都已移除，不要重新引入广告审核或占位要求。旧计算器与工具地址已随工具站一起退役，不再保留入口。

历史拒审与部署记录保存在 `docs/architecture/adsense-review-hardening-record.md`，只供历史参考。

## SEO + GEO

We optimize for both classical SEO (Google / Bing / DuckDuckGo) and Generative Engine Optimization (citation by ChatGPT, Claude, Perplexity, Google AI Overviews, etc).

| Lever                                | Where it lives                              |
| ------------------------------------ | ------------------------------------------- |
| Sitemaps (`sitemap-index.xml` + `sitemap-0.xml`) | Auto-emitted by `@astrojs/sitemap` for `web/` |
| `robots.txt` explicitly Allows AI bots (GPTBot, ClaudeBot, PerplexityBot, Google-Extended, etc.) | `web/public/robots.txt` |
| `llms.txt` (site summary + key page links per [llmstxt.org](https://llmstxt.org/)) | `web/public/llms.txt` |
| Internal links between products | `web/src/components/ProductList.astro` |
| Crawler Hints (IndexNow protocol — pings Bing/Yandex on changes) | CF zone setting (Caching → Configuration → Crawler Hints) — enabled |
| Cloudflare "Block AI bots" feature | **Disabled** in CF Security → Bot traffic |
| Cloudflare "Managed robots.txt" feature | **Disabled** in CF Security → Bot traffic |

To submit to Google Search Console (next step, manual): add `codepi.app` as a property (DNS verification via a TXT record in CF), then submit `https://codepi.app/sitemap-index.xml`. Repeat for Bing Webmaster.

## Local development

多 agent 开发入口见 [开发工作流](docs/development/agent-workflow.md) 和 [工具兼容说明](docs/development/agent-compatibility.md)：Codex、Claude Code、Cursor、Gemini CLI、Copilot 及其他 agent 共用根与局部 `AGENTS.md`、`.agents/skills/` 下的开发/审查/交接流程，以及 `node scripts/agent/check.mjs --base <基线SHA>` 检查入口。按任务隔离 worktree，明确写入范围与集成负责人。

The homepage is the only Astro project; it imports from `shared/` via `@shared/*` and from its own `src/site.config.js` via `@site/*`. The private apps use their own stacks.

```bash
cd web && npm install --legacy-peer-deps && npm run dev    # :4321
cd web && npm test                                         # builds ../auth, then node:test
cd web && npm run build                                    # → web/dist
```

Health runs in its own pnpm workspace: `cd oura && npx pnpm@9.15.9 install --frozen-lockfile`, then `pnpm test`, `pnpm typecheck`, `pnpm build`.

`npm install` requires `--legacy-peer-deps` because `@astrojs/tailwind@6` declares peer `astro@^3||^4||^5` while we run Astro 6. Every project's `.npmrc` already pins `legacy-peer-deps=true` and `registry=https://registry.npmjs.org/` so CF Pages and other CI installs work.

The `shared/` directory has no `package.json` — it's a raw source folder pulled in via Vite alias, and it is consumed by the homepage and by the private app bundles. `shared/auth/client.test.mjs` runs against the Health workspace dependencies.

## Deployment

Push to `main` → Cloudflare Pages auto-rebuilds configured projects (each watching the same repo but a different `Root directory`). Most pushes only change one site, but CF rebuilds everyone — harmless, builds are ~30s each.

### CF Pages settings (reference)

| Project       | Root      | Build cmd       | Output | Node | Custom domains                                  |
| ------------- | --------- | --------------- | ------ | ---- | ----------------------------------------------- |
| `kdp-portal`  | `web`     | `npm run build:pages` | `dist` | 22   | `codepi.app` (apex), `www.codepi.app`           |
| `kdp-gu`      | `gu`      | `npm run build` | `dist` | 22   | `gu.codepi.app`, `kdp-gu.pages.dev`             |
| `gzh`         | `gzh`     | `npm run build` | `dist` | 22   | `gzh.codepi.app`, `gzh.pages.dev`               |
| `oura-kdp`    | `oura/apps/web` | `pnpm --filter @oura-kdp/web build` | `apps/web/dist` | 22 | `health.codepi.app`, `oura-kdp.pages.dev` |

`kdp-portal` uses `npm run build:pages` because Pages only auto-compiles the
Functions folder when it sits next to the project root; the portal's Functions
(`web/functions/api/`) are compiled into `dist/` by the build script instead.

### DNS records (CF zone for `codepi.app`)

| Name              | Type  | Target                       | Proxied |
| ----------------- | ----- | ---------------------------- | ------- |
| `codepi.app` (apex) | CNAME | `kdp-portal.pages.dev`     | yes (CF flattens at apex) |
| `www`             | CNAME | `kdp-portal.pages.dev`       | yes |
| `gu`              | CNAME | `kdp-gu.pages.dev`           | yes |
| `gzh`             | CNAME | `gzh.pages.dev`              | yes |
| `health`          | CNAME | `oura-kdp.pages.dev`         | yes |
| `auth`            | —     | Worker custom domain `kdp-auth` | yes |

`kdp.cool` 与 `oura.kdp.cool` 已退役：不再解析到任何项目，也不做跳转。原 `kdp.cool` 上的邮件身份与网站解析相互独立，停用站点不影响已配置的邮件发送域。

## Adding or retiring a product

新增应用时同步更新 `shared/products.ts`、首页入口、`auth` 的客户端登记（`SSO_REDIRECT_URIS` 与 `SSO_CLIENTS`）、`scripts/agent/check.mjs` 的影响映射及其回归测试。

退役产品时按顺序执行：先移除代码与入口，再更新 `shared/products.ts` 和文档，然后撤下 Cloudflare Pages 自定义域，最后删除 DNS 记录与项目。数据（D1、对象存储）单独确认后再处理。

## Notes

- `output: 'static'` + `trailingSlash: 'always'` + `format: 'directory'` produces clean URLs like `/mortgage-calculator/` with `index.html` inside.
- Sitemap is emitted as `sitemap-index.xml` (index) referencing `sitemap-0.xml`. `robots.txt` points at the index.
- The `_headers` file under each site's `public/` is consumed by Cloudflare Pages for security headers (X-Frame-Options, X-Content-Type-Options, Referrer-Policy, Permissions-Policy).
- All math modules use `node:test` (no test framework dependency). Run with `npm test` per project.
- `docs/superpowers/specs/` and `docs/superpowers/plans/` hold design specs and implementation plans from the brainstorm → plan → execute workflow used to build this repo.
- `shared/` does not have its own `package.json`; it is a raw source folder consumed by every site via Vite alias `@shared/*`.

## Roadmap

| 阶段 | 范围 | 状态 |
| --- | --- | --- |
| P1 | 个人首页、应用介绍、共享视觉基础 | 已上线 |
| P2 | Health 视觉统一 | 已上线 |
| P3 | GU 视觉统一 | 已上线 |
| P4 | 公众号工作台（GZH）视觉统一 | 已上线 |
| P5 | 博客栏目上线（`/blog/`），公开笔记与内容发布 | 博客已上线 |
| P6 | 本人工作台与按需摘要（`/desk/`） | 已实现，摘要 token 待配置 |
| P9 | 五站下线、codepi.app 迁域、四产品收尾 | 进行中 |
| P7 | 公开内容 MCP | 待实施 |
| P8 | 私人应用的授权 AI 能力 | 按实际使用逐步接入 |

私人应用全面换肤在各自迁移阶段执行，须沿用共享设计规范并单独验证业务状态。
