# kedoupi（codepi）个人数字空间

`codepi.app` 是 kedoupi（codepi）的个人产品与内容入口。健康、投资理财、公众号工作台承载个人生活与工作；博客、笔记和公共 MCP 按阶段建设。广告收入与流量增长不再作为项目目标。

当前只保留四个产品：首页、GU（投资理财）、GZH（公众号工作台）和 Health，分别使用 `codepi.app`、`gu.codepi.app`、`gzh.codepi.app`、`health.codepi.app`；统一登录在 `auth.codepi.app`。`services/auth/` 与 `packages/shared/` 作为支撑层保留，不单独对外。

原先的 `calc/`、`convert/`、`text/`、`dev/`、`ai/` 五个静态工具站、主站旧计算器与指南页、`/tools/` 工具存档，以及 `kdp.cool`、`oura.kdp.cool` 域名均已退役，不保留跳转。退役范围与迁移顺序见 [codepi.app 四产品收尾](docs/development/tasks/2026-10-15-codepi-cutover.md)。

整体规划见 [个人数字空间方案](docs/superpowers/plans/2026-10-15-personal-digital-space-roadmap.md)；统一视觉规则见 [共享设计规范](docs/architecture/personal-design-system.md)。

首页是唯一的静态 Astro 站点，通过 `@kedoupi/shared/<subpath>` 复用基础样式、布局与契约，共享入口由严格的 `exports` 白名单声明。所有应用由根 pnpm workspace 统一管理依赖。私人应用保留现有技术栈与数据边界。

## 产品与支撑层

| Path | Domain | CF project | 说明 |
| --- | --- | --- | --- |
| `apps/web/` | `codepi.app` + `www.` | `codepi-www` | 首页、应用介绍、博客与 `desk` 摘要接口 |
| `apps/gu/` | `gu.codepi.app` | `codepi-gu` | 私人投资工作台 |
| `apps/gzh/` | `gzh.codepi.app` | `codepi-gzh` | 公众号稿件、预览与审核台 |
| `apps/oura/` | `health.codepi.app` | `codepi-health` + worker `codepi-health-api` | Health |
| `services/auth/` | `auth.codepi.app` | worker `codepi-auth` | 统一登录，四个产品共同依赖 |
| `packages/shared/` | — | — | 布局、样式 token、产品登记等共享源码 |

部署要点：`apps/web`、`apps/gzh` 是 Cloudflare Pages 项目；`apps/gu` 自 2026-10-17 起是 Workers Static Assets 架构的 Worker `codepi-gu`（`run_worker_first = true`，经 `wrangler deploy` 发布）；`apps/oura` 前端发布到 `codepi-health`，API worker 名 `codepi-health-api`。所有应用共享根 pnpm workspace。受控发布入口和例外操作遵循下方 CF 治理规范，不将单应用直传脚本当作默认发布路径。数据库与环境绑定以资源登记表及运行配置为准。


## 广告与历史工具

广告脚本、广告组件与占位、`ads.txt` 都已移除，不要重新引入广告审核或占位要求。旧计算器与工具地址已随工具站一起退役，不再保留入口。

历史拒审与部署记录保存在 `docs/architecture/adsense-review-hardening-record.md`，只供历史参考。

## SEO + GEO

We optimize for both classical SEO (Google / Bing / DuckDuckGo) and Generative Engine Optimization (citation by ChatGPT, Claude, Perplexity, Google AI Overviews, etc).

| Lever                                | Where it lives                              |
| ------------------------------------ | ------------------------------------------- |
| Sitemaps (`sitemap-index.xml` + `sitemap-0.xml`) | Auto-emitted by `@astrojs/sitemap` for `apps/web/` |
| `robots.txt` explicitly Allows AI bots (GPTBot, ClaudeBot, PerplexityBot, Google-Extended, etc.) | `apps/web/public/robots.txt` |
| `llms.txt` (site summary + key page links per [llmstxt.org](https://llmstxt.org/)) | `apps/web/public/llms.txt` |
| Internal links between products | `apps/web/src/components/ProductList.astro` |
| Crawler Hints (IndexNow protocol — pings Bing/Yandex on changes) | CF zone setting (Caching → Configuration → Crawler Hints) — enabled |
| Cloudflare "Block AI bots" feature | **Disabled** in CF Security → Bot traffic |
| Cloudflare "Managed robots.txt" feature | **Disabled** in CF Security → Bot traffic |

To submit to Google Search Console (next step, manual): add `codepi.app` as a property (DNS verification via a TXT record in CF), then submit `https://codepi.app/sitemap-index.xml`. Repeat for Bing Webmaster.

## Local development

从 [规范与工作流导航](docs/development/README.md) 开始：根与局部 `AGENTS.md` 定义项目约束；`.agents/skills/` 提供 `kdp-dev`、`kdp-review`、`kdp-release`、`kdp-handoff` 四个入口；[开发工作流](docs/development/agent-workflow.md) 和 [集成发布流程](docs/development/integration-release.md) 维护执行步骤。各工具按 [兼容说明](docs/development/agent-compatibility.md) 共用这些来源。`node scripts/agent/check.mjs --base <基线SHA>` 只预览检查计划，加 `--run` 才执行。

The homepage is the only Astro project; it imports shared APIs via the `@kedoupi/shared/<subpath>` exports allowlist and its own `src/site.config.js` via `@site/*`. The private apps use their own stacks. All packages are managed by a single pnpm workspace.

```bash
pnpm install                    # install all workspace dependencies
cd apps/web && npm run dev      # :4321
cd apps/web && npm test         # builds services/auth, then node:test
cd apps/web && npm run build    # → apps/web/dist
```

Health: `cd apps/oura && pnpm test`, `pnpm typecheck`, `pnpm build`.

The root `.npmrc` pins `legacy-peer-deps=true` and `registry=https://registry.npmjs.org/`. `pnpm install` from the repository root installs all workspace packages.

`packages/shared/` is a workspace member consumed by the homepage and by the private app bundles. `packages/shared/auth/client.test.mjs` runs against the Health workspace dependencies.

## Deployment

Cloudflare 基础设施的命名、环境、域名、密钥、发布与退役规范见
[Cloudflare 项目级治理规范](docs/development/cloudflare-governance.md)；
资源归属、最近核验记录与未决项见
[Cloudflare 资源登记表](docs/development/cloudflare-resource-registry.md)。
登记表是版本化快照，不是实时控制面。受控发布使用治理规范指定的 GitHub Actions 入口；历史 direct upload 记录不能证明新 workflow 已完成发布。

### Pages build commands (reference)

| Project | Command working directory | Build cmd | Output relative to working directory |
| --- | --- | --- | --- |
| `codepi-www` | `apps/web` | `npm run build:pages` | `dist` |
| `codepi-gu` | `apps/gu` | `npm run build` | `dist` |
| `codepi-gzh` | `apps/gzh` | `npm run build` | `dist` |
| `codepi-health` | `apps/oura` | `pnpm --filter @oura-kdp/web build` | `apps/web/dist` |

这里只列构建命令，不是 Dashboard 自动构建设置，也不代表完整检查与发布步骤。Node、依赖安装和发布参数以当前 workflow 为准。
> Note: Pages 项目的 pnpm workspace 过滤仍叫 `@oura-kdp/web` / `@oura-kdp/api`（包名未重命名），仅 Pages 项目名统一为 `codepi-*`。

`codepi-www` uses `npm run build:pages` because Pages only auto-compiles the
Functions folder when it sits next to the project root; the portal's Functions
(`apps/web/functions/api/`) are compiled into `dist/` by the build script instead.

### DNS records (CF zone for `codepi.app`)

| Name              | Type  | Target                       | Proxied |
| ----------------- | ----- | ---------------------------- | ------- |
| `codepi.app` (apex) | CNAME | `codepi-www.pages.dev`   | yes (CF flattens at apex) |
| `www`             | CNAME | `codepi-www.pages.dev`     | yes |
| `gu`              | AAAA | `100::`（Worker custom domain `codepi-gu` 自动管理，2026-10-17 已切换） | yes |
| `gzh`             | CNAME | `codepi-gzh.pages.dev`     | yes |
| `health`          | CNAME | `codepi-health.pages.dev`  | yes |
| `auth`            | —     | Worker custom domain `codepi-auth` | yes |

上表描述产品域名映射，不是本次实时 DNS 查询。`kdp.cool` 与 `oura.kdp.cool` 的产品网站已退役，不再作为产品入口或跳转目标；实际残留与兼容入口按资源登记表核实。原 `kdp.cool` 的邮件路由与邮件身份、用户指定保留的 `wechat-proxy` 不在网站退役范围，不能随旧站一并删除。

## Adding or retiring a product

经批准新增应用时同步更新 `packages/shared/products.ts`、首页入口、`auth` 的客户端登记与校验、`scripts/agent/check.mjs` 的影响映射及其回归测试。`SSO_CLIENTS` 登记客户端凭证及 `redirectUris`；`SSO_EXTRA_REDIRECT_URIS` 只为已登记客户端追加精确 callback，不能用它创建新客户端。额外回调与 `redirectUris` 合并生效；删除回调时须检查两处，且必须保持 production/staging 隔离。

退役产品时按顺序执行：先移除代码与入口，再更新 `packages/shared/products.ts` 和文档，然后撤下 Cloudflare Pages 自定义域，最后删除 DNS 记录与项目。数据（D1、对象存储）单独确认后再处理。

## Notes

- `output: 'static'` + `trailingSlash: 'always'` + `format: 'directory'` produces clean URLs like `/about/` with `index.html` inside.
- Sitemap is emitted as `sitemap-index.xml` (index) referencing `sitemap-0.xml`. `robots.txt` points at the index.
- The `_headers` file under each site's `public/` is consumed by Cloudflare Pages for security headers (X-Frame-Options, X-Content-Type-Options, Referrer-Policy, Permissions-Policy).
- `docs/superpowers/specs/` and `docs/superpowers/plans/` hold design specs and implementation plans from the brainstorm → plan → execute workflow used to build this repo.
- `packages/shared/` is a private workspace package. Consumers import its source through the explicit `@kedoupi/shared/<subpath>` exports allowlist; unlisted module paths are rejected.

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
