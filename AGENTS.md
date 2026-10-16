# AGENTS.md

This is the shared project contract for all coding agents working in this repository, regardless of tool or model. Tool-specific entry files reference this document; they must not maintain separate project rules.

## Agent development

- Start at `docs/development/README.md` for rule ownership and task routing. Follow `docs/development/agent-workflow.md` for development and handoff, and `docs/development/integration-release.md` for branch audits, integration, release and retirement. Small changes do not require a plan document.
- Verify the actual Git root; a chat's old worktree path may no longer be a checkout. Reuse a suitable task worktree; create new independent worktrees under `~/.worktrees/<project-directory>/<branch>` (for example `~/.worktrees/kdp.cool/codex/task-name`). Record the starting SHA and inspect existing changes before editing. Detached HEAD is supported.
- Read the target directory's `AGENTS.md` before modifying `auth/`, `gu/`, `gzh/`, `oura/` or `shared/`, including when starting from the repository root.
- Project skills live in `.agents/skills/`: `kdp-dev` for implementation, `kdp-review` for review, `kdp-release` for integration/release/retirement, `kdp-handoff` for continuity. Keep these skill names stable across product/domain renaming.
- Tool entry points and portable invocation are documented in `docs/development/agent-compatibility.md`. If native skill discovery is unavailable, read the selected `SKILL.md` directly; `$skill` and `/skill` syntax are tool-specific conveniences.
- In a multi-agent task, record the coordinator, each writer's worktree and allowed paths, shared-contract owner, dependencies and integration owner before parallel edits. Role names do not grant permission to message other agents or execute Git/remote actions.
- Preview affected checks with `node scripts/agent/check.mjs --base <starting-SHA>`; add `--run` to execute local checks. This does not replace UI acceptance or caller analysis.
- Shared contracts and CI files have one writer per parallel effort. Worktrees isolate source files, not ports, cookies or remote data.
- Commit, push, PR creation, merge, rebase, cleanup and remote operations follow explicit user authorization. Push/merge to `main` can trigger production deployment and migrations; ordinary development does not authorize these actions.

## What this repo is

Product brand: **kedoupi（codepi）**. Use this exact brand for shared login,
transactional email and cross-product identity. KDP is a technical abbreviation;
existing service names, database names and cookie identifiers do not need renaming.
Reuse `shared/brand.ts` and `shared/email/otp.ts` for brand and OTP mail content.

Monorepo for the kedoupi（codepi）personal digital space, on `codepi.app`. The repository keeps exactly four products: the homepage (`web/`), GU (`gu/`), the WeChat workbench GZH (`gzh/`) and Health (`oura/`). `auth/` and `shared/` are support layers, not products. The former static tool sites (`calc/`, `convert/`, `text/`, `dev/`, `ai/`), the homepage calculator and guide pages, `/tools/`, and the `kdp.cool` and `oura.kdp.cool` domains are retired and must not be reintroduced. Advertising and traffic growth are no longer product goals. See `docs/architecture/personal-design-system.md` for the shared visual contract. In-flight scope and cutover order live in `docs/development/tasks/2026-10-15-codepi-cutover.md`. Read `README.md` for the domain table, DNS records, and per-project CF settings — do not duplicate that content here.

## Architecture in one screen

```
kdp.cool/
├── web/      → personal homepage and private desk
├── auth/     → shared login Worker
├── gu/       → private investment app (web + Worker)
├── gzh/      → private WeChat workbench (web + Worker)
├── oura/     → Health (independent pnpm workspace)
└── shared/   → BaseLayout, styles/tokens.css, products.ts, charts.js, url-state.js, desk contract
```

`web/` is the only Astro site. It has its own `package.json`, `astro.config.mjs` and `node_modules`, and is NOT an npm workspace — there is no root `package.json`. It connects to `shared/` through the `astro.config.mjs` Vite aliases (`@shared` → `../shared`, `@site` → `./src`). The private apps retain their own stacks: `oura/` is an independent pnpm workspace, `gu/` and `gzh/` use npm with Vite + a bundled Worker.

`shared/` has no `package.json`; it's raw source files consumed by the homepage build and by the private app bundles. `shared/auth/client.test.mjs` runs against the Health workspace dependencies.

The homepage brand identity lives in `web/src/site.config.js` exporting `siteName`, `tagline`, `footerNote`, `navLinks`, `applicationCategory`, `personalSite`. `BaseLayout.astro` reads it via `@site/site.config.js` and the Astro-injected `import.meta.env.SITE` from `web/astro.config.mjs`.

## Commands

All commands run from a specific app directory (`web/`, `gu/`, `gzh/`, or `oura/`):

```bash
cd web
npm install --legacy-peer-deps    # required — see "Pitfalls" below
npm run dev                        # http://localhost:4321
npm run build                      # → web/dist
npm run preview                    # serves web/dist
npm test                           # builds ../auth first, then node:test
```

Health uses its own pnpm workspace: `cd oura && npx pnpm@9.15.9 install --frozen-lockfile`, then `pnpm test`, `pnpm typecheck`, `pnpm build`.

Run a single test file:

```bash
cd web && node --test test/desk.test.mjs
```

There is no monorepo-level `npm test` / `npm run build`. Iterate per app.

## Pitfalls (these will bite you)

1. **Always pass `--legacy-peer-deps` on `npm install`** (or rely on `web/.npmrc`, which already pins it). `@astrojs/tailwind@6` declares peer `astro@^3||^4||^5` while we run Astro 6. Without it, install fails.
2. **Lockfiles must use the public npm registry.** `web/.npmrc` pins `registry=https://registry.npmjs.org/`. If you ever regenerate a lockfile and your global `~/.npmrc` points at a private mirror (e.g. `npm.cnb.cool`), CF Pages builds will fail with `npm error code E401`. Always reinstall with `--registry=https://registry.npmjs.org/` explicitly.
3. **Personal-space direction supersedes AdSense review restrictions.** Do not add advertising scripts, placeholders, or publisher files.
4. **`shared/` change ripples beyond the homepage.** `shared/layouts/BaseLayout.astro`, `shared/styles/`, `shared/brand.ts` and `shared/email/` are consumed by the homepage build and by the GU, GZH and Health bundles. Verify the affected apps, not just `web/`.
5. **Auth changes are a cross-app contract.** `shared/auth/` and `auth/` are consumed by GU, GZH, Health and `desk`. A change there requires the auth, homepage/desk, GU, GZH and Health checks plus `shared/auth/client.test.mjs`. The central `SSO_CLIENTS` secret and each app's `AUTH_CLIENT_ID`/redirect URIs must stay in sync.
6. **Shared visual contract.** Reuse `shared/styles/tokens.css`, `shared/styles/site.css` and `shared/products.ts`. Personal-site pages must share navigation, typography, colors, spacing and interaction states. Private apps adopt these rules in their own migration phase; do not claim all apps are restyled when only shared tokens exist.

## Conventions

- **Keep behavior and presentation apart.** Match an existing page before inventing a pattern; shared components beat per-page copies.
- **No advertising.** Shared ad injection, components and placements have been retired. Do not reintroduce them.
- **Public pages are independent of private data.** The homepage, `/apps/`, `/about/`, `/privacy/`, `/terms/` and `/contact/` must not embed health, investment or unpublished draft data. Private apps stay behind unified login.
- **Product registry is shared.** `shared/products.ts` is the single list of public product entries; update it when a product is added or retired, and keep it free of private business data.
- **Health keeps its source vocabulary.** The source directory and package names retain `oura` even though the product and domain are Health; do not rename them just to match the UI. Cloudflare physical resource names follow the governance document and resource registry, not legacy package names.
- **No new dependencies without asking.** The homepage stack is locked at Astro 6 + `@astrojs/tailwind@6` + Tailwind v3 + `@astrojs/sitemap` + zero JS framework. Private apps retain their existing stacks. Any addition needs explicit user approval.

## Adding work

- Adding or retiring a product: see README §"Adding or retiring a product" for the shared touchpoints and the safe order of operations.
- Retiring something means removing code, entries, Cloudflare custom domains and DNS records — in that order. Data deletion is a separate, explicitly authorized step.
- `auth/` and DNS/cutover work can affect every product at once; keep those changes in their own task with their own verification.

## Workflow notes

- Design docs and implementation plans live in `docs/superpowers/specs/` and `docs/superpowers/plans/`. A proposal is not approval or implementation evidence; verify scope against current user decisions, code and tests. Proposed `apps/` / `packages/` or root workspace migrations do not replace the current structure until approved and implemented.
- Cloudflare rules live in `docs/development/cloudflare-governance.md`; resource ownership and dated verification evidence live in `docs/development/cloudflare-resource-registry.md`. A registry entry or workflow file is not proof of current remote readiness or successful release.
- Current product direction is recorded in `docs/superpowers/plans/2026-10-15-personal-digital-space-roadmap.md`; visual rules are in `docs/architecture/personal-design-system.md`. Old AdSense records are historical context and do not override the personal-space direction.
