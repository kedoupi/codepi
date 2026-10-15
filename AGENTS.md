# AGENTS.md

This is the shared project contract for all coding agents working in this repository, regardless of tool or model. Tool-specific entry files reference this document; they must not maintain separate project rules.

## Agent development

- Follow `docs/development/agent-workflow.md` for task isolation, validation and handoff. Small changes do not require a plan document.
- Reuse this task's worktree; use separate worktrees for independent concurrent tasks. Record the starting SHA and inspect existing changes before editing. Detached HEAD is supported.
- Read the target directory's `AGENTS.md` before modifying `auth/`, `gu/`, `fagao/`, `oura/` or `shared/`, including when starting from the repository root.
- Project skills live in `.agents/skills/`: `kdp-dev` for implementation, `kdp-review` for review, `kdp-handoff` for continuity.
- Tool entry points and portable invocation are documented in `docs/development/agent-compatibility.md`. If native skill discovery is unavailable, read the selected `SKILL.md` directly; `$skill` and `/skill` syntax are tool-specific conveniences.
- In a multi-agent task, record the coordinator, each writer's worktree and allowed paths, shared-contract owner, dependencies and integration owner before parallel edits. Role names do not grant permission to message other agents or execute Git/remote actions.
- Preview affected checks with `node scripts/agent/check.mjs --base <starting-SHA>`; add `--run` to execute local checks. This does not replace UI acceptance or caller analysis.
- Shared contracts and CI files have one writer per parallel effort. Worktrees isolate source files, not ports, cookies or remote data.
- Commit, push, PR creation, merge, rebase, cleanup and remote operations follow explicit user authorization. Push/merge to `main` can trigger production deployment and migrations; ordinary development does not authorize these actions.

## What this repo is

Product brand: **kedoupi（codepi）**. Use this exact brand for shared login,
transactional email and cross-product identity. KDP is a technical abbreviation;
existing domains, service names and cookie identifiers do not need renaming.
Reuse `shared/brand.ts` and `shared/email/otp.ts` for brand and OTP mail content.

Monorepo for the kedoupi（codepi）personal digital space. `web/` is the personal homepage and product entrance. Six independent Astro projects share `shared/` via Vite aliases; private Health, GU and WeChat apps retain their own stacks and data. Advertising and traffic growth are no longer product goals. See `docs/architecture/personal-design-system.md` for the shared visual contract and phased application adoption. Each project deploys to its own Cloudflare Pages project on its own (sub)domain. Read `README.md` for the full domain table, DNS records, and per-project CF settings — do not duplicate that content here.

## Architecture in one screen

```
kdp-tools/
├── web/      → kdp.cool (personal home)            CF project: kdp-portal
├── calc/     → calc.kdp.cool (5 calculators)     CF project: kdp-tools
├── convert/  → convert.kdp.cool (3 converters)   CF project: kdp-convert
├── text/     → text.kdp.cool (2 utils)           CF project: kdp-text
├── dev/      → dev.kdp.cool (2 dev tools)        CF project: kdp-dev
├── ai/       → ai.kdp.cool (archived AI utilities)
├── auth/     → shared login Worker
├── gu/       → private investment app (web + Worker)
├── fagao/    → private WeChat workbench (web + Worker)
├── oura/     → Health (independent pnpm workspace)
└── shared/   → BaseLayout, styles/tokens.css, products.ts, CalculatorShell, charts.js, url-state.js
```

Each of the six static sites is a self-contained Astro project (its own `package.json`, `astro.config.mjs`, `node_modules`). They are NOT npm workspaces — there is no root `package.json`. The static sites connect through `shared/` and the per-site `astro.config.mjs` Vite aliases (`@shared` → `../shared`, `@site` → `./src`). Private apps retain their own stacks; `oura/` is an independent pnpm workspace, and the other apps use npm.

`shared/` has no `package.json`; it's raw source files. Tests in `shared/lib/*.test.mjs` run from `calc/`'s test script, which globs both `src/lib/*.test.mjs` and `../shared/lib/*.test.mjs`.

Per-site brand identity lives in `<site>/src/site.config.js` exporting `siteName`, `tagline`, `footerNote`, `navLinks`, `applicationCategory`. `BaseLayout.astro` reads these via `@site/site.config.js` and the Astro-injected `import.meta.env.SITE` (auto-populated from each site's `astro.config.mjs` `site:` field).

## Commands

All commands run from a specific site directory (`calc/`, `web/`, `convert/`, `text/`, or `dev/`):

```bash
cd <site>
npm install --legacy-peer-deps    # required — see "Pitfalls" below
npm run dev                        # http://localhost:4321
npm run build                      # → <site>/dist
npm run preview                    # serves <site>/dist
npm test                           # among these static sites, calc/ has node:test
```

Run a single test file:

```bash
cd calc && node --test src/lib/mortgage.test.mjs
```

There is no monorepo-level `npm test` / `npm run build`. Iterate per site.

## Pitfalls (these will bite you)

1. **Always pass `--legacy-peer-deps` on `npm install`** (or rely on the per-site `.npmrc` which already pins it). `@astrojs/tailwind@6` declares peer `astro@^3||^4||^5` while we run Astro 6. Without it, install fails.
2. **Lockfiles must use the public npm registry.** `<site>/.npmrc` pins `registry=https://registry.npmjs.org/`. If you ever regenerate a lockfile and your global `~/.npmrc` points at a private mirror (e.g. `npm.cnb.cool`), CF Pages builds will fail with `npm error code E401`. Always reinstall with `--registry=https://registry.npmjs.org/` explicitly.
3. **Personal-space direction supersedes AdSense review restrictions.** Preserve useful legacy tool URLs and math behavior. Do not add advertising scripts, placeholders, or publisher files.
4. **Math test gotcha: `round(a) + round(b) ≠ round(a + b)`.** Several tests in this repo were initially written with `Math.round(monthly) * n` style expectations and produced off-by-one failures. When asserting on derived totals, compute them from the implementation's exact numbers, not from rounded intermediates. Already cost two debugging cycles.
5. **`shared/` change ripples to all 6 static sites.** A change to `shared/layouts/BaseLayout.astro` rebuilds + redeploys every CF Pages project. Verify all 6 static sites still build before pushing.
6. **Astro inline `<script>` is bundled by Vite.** Relative imports (`@shared/lib/charts.js`) work and are tree-shaken. Don't switch to `<script type="module" src="/scripts/...">` — that breaks bundling. URL state must be persisted via the `pushUrlState` util in `shared/lib/url-state.js`, not raw `history.replaceState`, so the debounce + `?` handling is consistent.
7. **Shared visual contract.** Reuse `shared/styles/tokens.css`, `shared/styles/site.css` and `shared/products.ts`. Personal-site pages must share navigation, typography, colors, spacing and interaction states. Private apps adopt these rules in their own migration phase; do not claim all apps are restyled when only shared tokens exist.

## Conventions

- **Pure math first.** Calculator math goes in `<site>/src/lib/<slug>.js` as a pure function with a `<slug>.test.mjs` next to it (`node:test` + `node:assert/strict`). The page's inline `<script>` imports the pure function — same code as the test, no DOM in the math module.
- **Primitives in DRY order.** `shared/lib/url-state.js` and `shared/lib/charts.js` are cross-site. `calc/src/lib/{amortization,federal-tax}.js` are calc-internal primitives reused by multiple calc tools (e.g. `mortgage.js` and `auto-loan.js` both call `calcAmortizedLoan`). New shared primitives go in `shared/lib/`; new calc-only primitives stay in `calc/src/lib/`.
- **No advertising.** Shared ad injection, components and placements have been retired. Preserve tool content without empty ad spacing.
- **Every calculation/conversion page has a "Show the math" `<details>` block** that prints the actual computation (formula filled in with the user's inputs). Non-math tools should include How it works, Limitations, Privacy, Last reviewed, and FAQ sections.
- **Every tool page persists inputs to URL** via `decodeState` + `pushUrlState` from `shared/lib/url-state.js`. Pattern: read URL on mount → seed inputs → on every input event, debounced 250ms, replaceState the snapshot.
- **JSON-LD `applicationCategory`** is per-site. Set it via `<site>/src/site.config.js` (`FinanceApplication` for calc, `UtilityApplication` for convert/text, `DeveloperApplication` for dev).
- **No new dependencies without asking.** The static-site stack is locked at Astro 6 + `@astrojs/tailwind@6` + Tailwind v3 + `@astrojs/sitemap` + zero JS framework. Private apps retain their existing stacks. Any addition needs explicit user approval.

## Adding work

- Adding a new tool to an existing subdomain: see README §"Add a new tool".
- Adding a new subdomain tool family: see README §"Add a new subdomain tool family" — the recipe is tested.
- Keep math behavior changes separate from presentation changes; run the relevant math tests when behavior changes.

## Workflow notes

- Design docs and implementation plans live in `docs/superpowers/specs/` and `docs/superpowers/plans/` — generated via the brainstorm → plan → execute workflow. Reading the most recent files gives the most up-to-date picture of intended scope.
- Current product direction is recorded in `docs/superpowers/plans/2026-10-15-personal-digital-space-roadmap.md`; visual rules are in `docs/architecture/personal-design-system.md`. Old AdSense records are historical context and do not override the personal-space direction.
