# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this repo is

Monorepo for the `kdp.cool` family of static, ad-supported web tools. Six independent Astro projects share a `shared/` source folder via Vite aliases. Each project deploys to its own Cloudflare Pages project on its own (sub)domain. Read `README.md` for the full domain table, AdSense status, DNS records, and per-project CF settings — do not duplicate that content here.

## Architecture in one screen

```
kdp-tools/
├── web/      → kdp.cool (apex portal)            CF project: kdp-portal
├── calc/     → calc.kdp.cool (5 calculators)     CF project: kdp-tools
├── convert/  → convert.kdp.cool (3 converters)   CF project: kdp-convert
├── text/     → text.kdp.cool (2 utils)           CF project: kdp-text
├── dev/      → dev.kdp.cool (2 dev tools)        CF project: kdp-dev
├── ai/       → ai.kdp.cool (4 AI tools)          CF project: kdp-ai
└── shared/   → BaseLayout, AdSense, CalculatorShell, charts.js, url-state.js
```

Each site is a self-contained Astro project (its own `package.json`, `astro.config.mjs`, `node_modules`). They are NOT npm workspaces — there is no root `package.json`. The only thing connecting them is `shared/` and the per-site `astro.config.mjs` Vite aliases (`@shared` → `../shared`, `@site` → `./src`).

`shared/` has no `package.json`; it's raw source files. Tests in `shared/lib/*.test.mjs` run from `calc/`'s test script, which globs both `src/lib/*.test.mjs` and `../shared/lib/*.test.mjs`.

Per-site brand identity lives in `<site>/src/site.config.js` exporting `siteName`, `tagline`, `footerNote`, `navLinks`, `applicationCategory`. `BaseLayout.astro` reads these via `@site/site.config.js` and the Astro-injected `import.meta.env.SITE` (auto-populated from each site's `astro.config.mjs` `site:` field).

## Commands

All commands run from a specific site directory (`calc/`, `web/`, `convert/`, `text/`, `dev/`, or `ai/`):

```bash
cd <site>
npm install --legacy-peer-deps    # required — see "Pitfalls" below
npm run dev                        # http://localhost:4321
npm run build                      # → <site>/dist
npm run preview                    # serves <site>/dist
npm test                           # only in calc/ — node:test, ~36 tests
```

Run a single test file:

```bash
cd calc && node --test src/lib/mortgage.test.mjs
```

There is no monorepo-level `npm test` / `npm run build`. Iterate per site.

## Pitfalls (these will bite you)

1. **Always pass `--legacy-peer-deps` on `npm install`** (or rely on the per-site `.npmrc` which already pins it). `@astrojs/tailwind@6` declares peer `astro@^3||^4||^5` while we run Astro 6. Without it, install fails.
2. **Lockfiles must use the public npm registry.** `<site>/.npmrc` pins `registry=https://registry.npmjs.org/`. If you ever regenerate a lockfile and your global `~/.npmrc` points at a private mirror (e.g. `npm.cnb.cool`), CF Pages builds will fail with `npm error code E401`. Always reinstall with `--registry=https://registry.npmjs.org/` explicitly.
3. **AdSense review window (active):** property was rejected for low-value content. Prefer deepening `web/` (apex calculators + guides). Satellite sites (`convert`/`text`/`dev`/`ai`) stay `noindex` + ads off until approval. Do not re-expand thin utility farms or re-duplicate apex calculators onto `calc/` without an explicit ask.
4. **Math test gotcha: `round(a) + round(b) ≠ round(a + b)`.** Several tests in this repo were initially written with `Math.round(monthly) * n` style expectations and produced off-by-one failures. When asserting on derived totals, compute them from the implementation's exact numbers, not from rounded intermediates. Already cost two debugging cycles.
5. **`shared/` change ripples to all 6 sites.** A change to `shared/layouts/BaseLayout.astro` rebuilds + redeploys every CF Pages project. Verify all 6 sites still build before pushing.
6. **Astro inline `<script>` is bundled by Vite.** Relative imports (`@shared/lib/charts.js`) work and are tree-shaken. Don't switch to `<script type="module" src="/scripts/...">` — that breaks bundling. URL state must be persisted via the `pushUrlState` util in `shared/lib/url-state.js`, not raw `history.replaceState`, so the debounce + `?` handling is consistent.
7. **AdSense.astro renders a placeholder `<div>`, not a real `<ins class="adsbygoogle">`.** This is intentional during the review window. Do not switch to real `<ins>` tags until Google approves the account; switching too early can cause empty ad units in Google's metrics. The swap is documented in README §"Post-approval".
8. **Astro slot syntax conflict with AdSense `slot` prop.** The `AdSense.astro` component accepts BOTH `slot=` (the Astro named-slot fill) and `adSlot=` (the AdSense placement ID). When `<AdSense>` is filling a named slot in `CalculatorShell`, use `slot="top-ad"` for the Astro semantics and `adSlot="mortgage-top"` for the placement. When it's a direct child (no named-slot context), `slot=` alone works. The component resolves `slotId = adSlot ?? slot ?? ''` internally.

## Conventions

- **Pure math first.** Calculator math goes in `<site>/src/lib/<slug>.js` as a pure function with a `<slug>.test.mjs` next to it (`node:test` + `node:assert/strict`). The page's inline `<script>` imports the pure function — same code as the test, no DOM in the math module.
- **Primitives in DRY order.** `shared/lib/url-state.js` and `shared/lib/charts.js` are cross-site. `calc/src/lib/{amortization,federal-tax}.js` are calc-internal primitives reused by multiple calc tools (e.g. `mortgage.js` and `auto-loan.js` both call `calcAmortizedLoan`). New shared primitives go in `shared/lib/`; new calc-only primitives stay in `calc/src/lib/`.
- **Most substantial tool pages have 3 AdSense placements** (`top-ad`, `middle-ad`, `bottom-ad`) using `<AdSense>` with `adSlot=<slug>-{top,middle,bottom}`. Thin utility pages may intentionally use fewer placements to keep content-to-ad balance healthy.
- **Every calculation/conversion page has a "Show the math" `<details>` block** that prints the actual computation (formula filled in with the user's inputs). Non-math tools should instead include How it works, Limitations, Privacy, Last reviewed, and FAQ sections.
- **Every tool page persists inputs to URL** via `decodeState` + `pushUrlState` from `shared/lib/url-state.js`. Pattern: read URL on mount → seed inputs → on every input event, debounced 250ms, replaceState the snapshot.
- **JSON-LD `applicationCategory`** is per-site. Set it via `<site>/src/site.config.js` (`FinanceApplication` for calc, `UtilityApplication` for convert/text, `DeveloperApplication` for dev).
- **No new dependencies without asking.** The stack is locked at Astro 6 + `@astrojs/tailwind@6` + Tailwind v3 + `@astrojs/sitemap` + zero JS framework. Any addition needs explicit user approval.

## Adding work

- Adding a new tool to an existing subdomain: see README §"Add a new tool".
- Adding a new subdomain tool family: see README §"Add a new subdomain tool family" — the recipe is tested.
- Math behavior changes that affect calc/ output during AdSense review: pause and confirm with the user first.

## Workflow notes

- Design docs and implementation plans live in `docs/superpowers/specs/` and `docs/superpowers/plans/` — generated via the brainstorm → plan → execute workflow. Reading the most recent files gives the most up-to-date picture of intended scope.
- Memory in `~/.claude/projects/-Users-echorenyuan-Coding-kedoupi-kdp-tools/memory/` records project goals (AdSense revenue, beat-NerdWallet UX), apex-domain AdSense lesson, and decisive-design preference. Read at session start when context matters.
