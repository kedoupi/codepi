# kedoupi（codepi）个人数字空间

`kdp.cool` 是 kedoupi（codepi）的个人产品与内容入口。健康、投资理财、公众号工作台承载个人生活与工作；博客、笔记和公共 MCP 按阶段建设。广告收入与流量增长不再作为项目目标。

P1 的个人首页、应用介绍、工具存档和去广告已上线。P2 的 Health 已迁移至 `health.kdp.cool`，并与主站共用设计规范；原 `oura.kdp.cool` 保留兼容。公众号工作台的名称和域名后续单独调整。

整体规划见 [个人数字空间方案](docs/superpowers/plans/2026-10-15-personal-digital-space-roadmap.md)；统一视觉规则见 [共享设计规范](docs/architecture/personal-design-system.md)。

各静态站继续独立 Astro 构建和 Cloudflare Pages 部署，通过 `shared/` 与 `@shared/*` alias 复用基础样式和组件。私人应用保留现有技术栈与数据边界。

## Live family (17 tools across 6 domains)

| Path      | Domain                    | Tools | CF Pages project |
| --------- | ------------------------- | ----- | ---------------- |
| `web/`    | `kdp.cool` + `www.`       | personal home, apps, archive + existing tools | `kdp-portal` |
| `calc/`   | `calc.kdp.cool`           | mortgage, auto loan, compound interest, paycheck, income tax | `kdp-tools` |
| `convert/`| `convert.kdp.cool`        | time zone, unit, temperature | `kdp-convert` |
| `text/`   | `text.kdp.cool`           | word counter, Lorem Ipsum generator | `kdp-text` |
| `dev/`    | `dev.kdp.cool`            | JSON formatter, Base64 encoder | `kdp-dev` |
| `ai/`     | `ai.kdp.cool`             | token cost calculator, prompt builder, skill builder, prompt cleaner, privacy checker | `kdp-ai` |
| `shared/` | —                         | BaseLayout, CalculatorShell, charts.js, url-state.js | — |

Page totals: 5 + 10 + 8 + 7 + 7 + 10 = **47 indexable pages**.

## Product apps (same monorepo, own CF projects)


| Path | Domain | CF project | Stack / deploy |
| --- | --- | --- | --- |
| `fagao/` | `fagao.kdp.cool` | `fagao` | Pages + D1 (ex-`publish-desk`). Root `fagao`, `npm run build`, output `dist` |
| `oura/` | `health.kdp.cool`（兼容 `oura.kdp.cool`） | `oura-kdp` + worker `oura-kdp-api` | pnpm workspace. Web: root `oura`, build `corepack enable && pnpm i && pnpm --filter @oura-kdp/web build`, output `apps/web/dist`. API: `cd oura && pnpm deploy:api` |


## 广告与历史工具

P1 已移除六个静态站的广告脚本、账号 meta、广告组件与占位、`ads.txt`，并更新页面中的广告说明。不要重新引入广告审核或占位要求。旧计算器与工具地址继续保留，从主站 `/tools/` 进入。

历史拒审与部署记录保存在 `docs/architecture/adsense-review-hardening-record.md`，只供历史参考。卫星站原有 `noindex` 和去重跳转本轮保留，后续按实际内容状态单独审查。

## SEO + GEO

We optimize for both classical SEO (Google / Bing / DuckDuckGo) and Generative Engine Optimization (citation by ChatGPT, Claude, Perplexity, Google AI Overviews, etc).

| Lever                                | Where it lives                              |
| ------------------------------------ | ------------------------------------------- |
| Sitemaps (`sitemap-index.xml` + `sitemap-0.xml`) | Auto-emitted by `@astrojs/sitemap` per site |
| `robots.txt` explicitly Allows AI bots (GPTBot, ClaudeBot, PerplexityBot, Google-Extended, etc.) | `<site>/public/robots.txt` |
| `llms.txt` (site summary + key page links per [llmstxt.org](https://llmstxt.org/)) | `<site>/public/llms.txt` |
| FAQ schema (`FAQPage` JSON-LD + visible `<details>` Q&A) | Top tool pages: mortgage, income-tax, paycheck, time-zone, unit-converter, json-formatter, word-counter, Base64, AI tools |
| "Show the math" disclosure (citation-friendly stepwise content) | All calculator + converter tool pages |
| Internal cross-links between related tools | `calc/` pages link to siblings |
| Cross-site links from `kdp.cool` portal to subdomain families | `web/src/pages/index.astro` |
| Crawler Hints (IndexNow protocol — pings Bing/Yandex on changes) | CF zone setting (Caching → Configuration → Crawler Hints) — enabled |
| Cloudflare "Block AI bots" feature | **Disabled** in CF Security → Bot traffic |
| Cloudflare "Managed robots.txt" feature | **Disabled** in CF Security → Bot traffic |

To submit to Google Search Console (next step, manual): add each domain as a property (DNS verification via a TXT record in CF), then submit `https://<domain>/sitemap-index.xml`. Repeat for Bing Webmaster.

## Local development

Each site is an independent Astro project that imports from `shared/` via `@shared/*` and from its own `src/site.config.js` via `@site/*`.

```bash
cd calc    && npm install --legacy-peer-deps && npm run dev    # :4321
cd convert && npm install --legacy-peer-deps && npm run dev    # :4321 (one at a time)
cd text    && npm install --legacy-peer-deps && npm run dev
cd dev     && npm install --legacy-peer-deps && npm run dev
cd ai      && npm install --legacy-peer-deps && npm run dev
cd web     && npm install --legacy-peer-deps && npm run dev

cd calc    && npm test    # node:test, 36 tests covering all calc math + url-state util
```

`npm install` requires `--legacy-peer-deps` because `@astrojs/tailwind@6` declares peer `astro@^3||^4||^5` while we run Astro 6. Every project's `.npmrc` already pins `legacy-peer-deps=true` and `registry=https://registry.npmjs.org/` so CF Pages and other CI installs work.

The `shared/` directory has no `package.json` — it's a raw source folder pulled in via Vite alias. Its only test file is `shared/lib/url-state.test.mjs`, run by `calc/`'s `npm test` script (which globs both `src/lib/*.test.mjs` and `../shared/lib/*.test.mjs`).

## Deployment

Push to `main` → Cloudflare Pages auto-rebuilds configured projects (each watching the same repo but a different `Root directory`). Most pushes only change one site, but CF rebuilds everyone — harmless, builds are ~30s each.

### CF Pages settings (reference)

| Project       | Root      | Build cmd       | Output | Node | Custom domains                                  |
| ------------- | --------- | --------------- | ------ | ---- | ----------------------------------------------- |
| `kdp-portal`  | `web`     | `npm run build` | `dist` | 22   | `kdp.cool` (apex), `www.kdp.cool`               |
| `kdp-tools`   | `calc`    | `npm run build` | `dist` | 22   | `calc.kdp.cool`                                 |
| `kdp-convert` | `convert` | `npm run build` | `dist` | 22   | `convert.kdp.cool`                              |
| `kdp-text`    | `text`    | `npm run build` | `dist` | 22   | `text.kdp.cool`                                 |
| `kdp-dev`     | `dev`     | `npm run build` | `dist` | 22   | `dev.kdp.cool`                                  |
| `kdp-ai`      | `ai`      | `npm run build` | `dist` | 22   | `ai.kdp.cool`                                   |

### DNS records (CF zone for `kdp.cool`)

| Name              | Type  | Target                       | Proxied |
| ----------------- | ----- | ---------------------------- | ------- |
| `kdp.cool` (apex) | CNAME | `kdp-portal.pages.dev`       | yes (CF flattens at apex) |
| `www`             | CNAME | `kdp-portal.pages.dev`       | yes |
| `calc`            | CNAME | `kdp-tools.pages.dev`        | yes |
| `convert`         | CNAME | `kdp-convert.pages.dev`      | yes |
| `text`            | CNAME | `kdp-text.pages.dev`         | yes |
| `dev`             | CNAME | `kdp-dev.pages.dev`          | yes |
| `ai`              | CNAME | `kdp-ai.pages.dev`           | yes |
| `fagao`           | CNAME | `fagao.pages.dev`            | yes |
| `health`          | CNAME | `oura-kdp.pages.dev`         | yes |
| `oura`            | CNAME | `oura-kdp.pages.dev`         | yes |
| `kdp.cool` (apex) | MX/TXT | Cloudflare Email Routing — handles `hello@kdp.cool` (separate from web traffic) |

## Add a new tool

To a calculator-style subdomain (e.g. another converter on `convert/`):

1. Create `<subdomain>/src/pages/<slug>/index.astro` modeled on an existing tool page (e.g. `convert/src/pages/temperature-converter/index.astro` or `calc/src/pages/mortgage-calculator/index.astro`).
2. Import shared bits from `@shared/*`: `BaseLayout`, `CalculatorShell`, `renderPie`/`renderLineChart` from `charts.js`, `decodeState`/`pushUrlState` from `url-state.js`.
3. If the tool needs custom math, put it in `<subdomain>/src/lib/<slug>.js` plus a `<slug>.test.mjs`. Wire it into the test script in `<subdomain>/package.json` if not already covered by the glob.
4. Add a card entry to the homepage (`<subdomain>/src/pages/index.astro`)'s `tools` array (mark `available: true`, set `href`).
5. (Optional) Add an FAQ block + `FAQPage` JSON-LD if the tool has natural Q&A potential.
6. (Optional) Cross-link from related tools in the same subdomain ("Related" section at the bottom of the content slot).
7. `npm run build` locally; push to `main`. CF deploys in ~1 min.

## Add a new subdomain tool family

Tested recipe (used for `convert/`, `text/`, `dev/`):

1. **Astro scaffold:**
   ```bash
   cd kdp-tools
   npm create astro@latest <family> -- --template minimal --install --no-git --typescript strict --skip-houston --yes
   ```
2. **Replace `<family>/.npmrc`** with `legacy-peer-deps=true` + `registry=https://registry.npmjs.org/`.
3. **Reinstall against public registry, then add Tailwind + sitemap manually** (`npx astro add` is unreliable on private mirrors):
   ```bash
   cd <family> && rm -rf node_modules package-lock.json
   npm install --legacy-peer-deps --registry=https://registry.npmjs.org/
   npm install --save-dev --legacy-peer-deps --registry=https://registry.npmjs.org/ @astrojs/tailwind @astrojs/sitemap tailwindcss@^3
   ```
4. **Write `<family>/astro.config.mjs`** mirroring an existing one — change `site:` to `https://<family>.kdp.cool`, keep the `vite.resolve.alias` block with `@shared` and `@site` paths.
5. **Write `<family>/tailwind.config.mjs`** with content globs including `'./src/**/*.{astro,...}'` AND `'../shared/**/*.{astro,...}'`.
6. **Write `<family>/src/site.config.js`** exporting `siteName`, `tagline`, `footerNote`, `navLinks`, `applicationCategory`.
7. **Pages:** delete the default `src/pages/index.astro`, then write a homepage + tool pages + clone the 4 brand pages (privacy/terms/about/contact) from a sibling project, brand-swapping.
8. **Public files:** `_headers` (clone), `favicon.svg` (visually distinct color/letter), `robots.txt` (template with the 11 AI-bot Allows + sitemap line for the new domain), `llms.txt` (custom summary).
9. **Commit + push.**
10. **CF Pages provisioning** (via API or dashboard):
    - Create CF Pages project with `root_dir: <family>`, `build_command: npm run build`, `destination_dir: dist`, env var `NODE_VERSION=22`, source = GitHub `kedoupi/kdp-tools` main branch.
    - Add custom domain `<family>.kdp.cool`.
    - Add DNS CNAME `<family>` → `<project>.pages.dev` proxied.
    - Trigger first deployment.

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
| P1 | 个人首页、应用介绍、工具存档、六站去广告、共享视觉基础 | 本地实现，待验收与发布 |
| P2 | Health 域名迁移、GU 表达、公众号名称和入口 | 待实施 |
| P3 | 博客、公开笔记与内容发布 | 待实施 |
| P4 | 本人工作台与按需摘要 | 待实施 |
| P5 | 公开内容 MCP | 待实施 |
| P6 | 私人应用的授权 AI 能力 | 按实际使用逐步接入 |

私人应用全面换肤在各自迁移阶段执行，须沿用共享设计规范并单独验证业务状态。
