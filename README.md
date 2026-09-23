# kdp-tools

Monorepo for the `kdp.cool` family of single-purpose web tools. Each subdirectory is one independent static Astro site, deployed to its own Cloudflare Pages project on its own (sub)domain. Shared layout / components / utilities live under `shared/` and are imported via the `@shared/*` Vite alias.

## Live family (17 tools across 6 domains)

| Path      | Domain                    | Tools | CF Pages project |
| --------- | ------------------------- | ----- | ---------------- |
| `web/`    | `kdp.cool` + `www.`       | portal landing + 4 brand pages | `kdp-portal` |
| `calc/`   | `calc.kdp.cool`           | mortgage, auto loan, compound interest, paycheck, income tax | `kdp-tools` |
| `convert/`| `convert.kdp.cool`        | time zone, unit, temperature | `kdp-convert` |
| `text/`   | `text.kdp.cool`           | word counter, Lorem Ipsum generator | `kdp-text` |
| `dev/`    | `dev.kdp.cool`            | JSON formatter, Base64 encoder | `kdp-dev` |
| `ai/`     | `ai.kdp.cool`             | token cost calculator, prompt builder, skill builder, prompt cleaner, privacy checker | `kdp-ai` |
| `shared/` | —                         | BaseLayout, AdSense, CalculatorShell, charts.js, url-state.js | — |

Page totals: 5 + 10 + 8 + 7 + 7 + 10 = **47 indexable pages**.

## AdSense

| Item                    | Value                              |
| ----------------------- | ---------------------------------- |
| Account                 | `kedoupi1121@gmail.com`            |
| Publisher ID            | `pub-4790759596265225`             |
| Client ID (script src)  | `ca-pub-4790759596265225`          |
| Verified property       | `kdp.cool` (apex; covers all subdomains) |
| Status                  | In review (submitted 2026-05-08; ads.txt authorized) |

`ads.txt` lives at the root of every domain (`web/calc/convert/text/dev/ai/public/ads.txt`). The AdSense `<script>` + `<meta name="google-adsense-account">` tag are injected by `shared/layouts/BaseLayout.astro`, so every page across all 6 domains carries them.

Ad placeholders in `shared/components/AdSense.astro` reserve `min-height` for CLS and stay visually quiet during review (no bordered "Advertisement" boxes, no real `<ins class="adsbygoogle">` until approval).

### Post-approval (after Google emails "Approved")

1. **No script change needed** — the AdSense loader is already injected by `BaseLayout`.
2. **Replace the placeholder body in `shared/components/AdSense.astro`**: swap the `<div class="adsense-placeholder">` for a real `<ins class="adsbygoogle">` block plus a `<script is:inline>(adsbygoogle = window.adsbygoogle || []).push({});</script>`. Because `AdSense.astro` is in `shared/`, one change applies across all 5 domains.
3. Per ad placement (e.g. `mortgage-top`, `home-top`, `wc-top`, `tz-top`, `json-top`, `portal-top`), create an ad unit in AdSense and map its generated numeric `data-ad-slot` ID to the semantic name we use in `adSlot` props — easiest is a small lookup table inside `AdSense.astro` (`SLOT_IDS = { 'mortgage-top': '1234567890', ... }`).

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
| `kdp.cool` (apex) | MX/TXT | Cloudflare Email Routing — handles `hello@kdp.cool` (separate from web traffic) |

## Add a new tool

To a calculator-style subdomain (e.g. another converter on `convert/`):

1. Create `<subdomain>/src/pages/<slug>/index.astro` modeled on an existing tool page (e.g. `convert/src/pages/temperature-converter/index.astro` or `calc/src/pages/mortgage-calculator/index.astro`).
2. Import shared bits from `@shared/*`: `BaseLayout`, `CalculatorShell`, `AdSense`, `renderPie`/`renderLineChart` from `charts.js`, `decodeState`/`pushUrlState` from `url-state.js`.
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
8. **Public files:** `ads.txt` (clone), `_headers` (clone), `favicon.svg` (visually distinct color/letter), `robots.txt` (template with the 11 AI-bot Allows + sitemap line for the new domain), `llms.txt` (custom summary).
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

| Phase | Status | Notes |
| ----- | ------ | ----- |
| Phase 1 — calc to AdSense-ready | ✅ | 5 calculators, brand pages, AdSense submitted |
| Phase 2 — extract `shared/` | ✅ | BaseLayout, AdSense, CalculatorShell, charts, url-state in `shared/` |
| Phase 3 — convert/text/dev subdomains | ✅ | each with 2-3 tools + brand pages |
| Phase 4 — `kdp.cool` portal | ✅ | shipped early to satisfy AdSense apex requirement |
| Sprint D — SEO + GEO | ✅ | llms.txt, AI-bot Allow, FAQ schema, internal links, Crawler Hints |
| Sprint E — people-first quality pass + `ai.kdp.cool` | ✅ | evergreen title cleanup, review/limitations/source signals, 4 browser-only AI tools |
| **Awaiting AdSense approval** | 🟡 | Once approved: swap `<div>` → `<ins>` in `AdSense.astro`, map slot IDs |
| Future — currency converter | ⏳ | Needs live FX API |
| Future — regex tester, JWT decoder, case converter, markdown↔HTML | ⏳ | Pure JS candidates; keep off public homepages until shipped |
| Future — calc P1.5 (scenario compare, CSV export, OBBBA tax features) | ⏳ | Hold during AdSense review |
