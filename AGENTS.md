# AGENTS.md

This is the shared project contract for all coding agents working in this repository, regardless of tool or model. Tool-specific entry files reference this document; they must not maintain separate project rules.

## Agent development

- Start at `docs/development/README.md` for rule ownership and task routing. Follow `docs/development/agent-workflow.md` for development and handoff, and `docs/development/integration-release.md` for branch audits, integration, release and retirement. Small changes do not require a plan document.
- Verify the actual Git root; a chat's old worktree path may no longer be a checkout. Reuse a suitable task worktree; create new independent worktrees under `~/.worktrees/<project-directory>/<branch>` (for example `~/.worktrees/kdp.cool/codex/task-name`). Record the starting SHA and inspect existing changes before editing. Detached HEAD is supported.
- Read the target directory's `AGENTS.md` before modifying `services/auth/`, `apps/gu/`, `apps/gzh/`, `apps/health/` or `packages/shared/`, including when starting from the repository root.
- Project skills live in `.agents/skills/`: `kdp-dev` for implementation, `kdp-review` for review, `kdp-release` for integration/release/retirement, `kdp-handoff` for continuity. Keep these skill names stable across product/domain renaming.
- Tool entry points and portable invocation are documented in `docs/development/agent-compatibility.md`. If native skill discovery is unavailable, read the selected `SKILL.md` directly; `$skill` and `/skill` syntax are tool-specific conveniences.
- In a multi-agent task, record the coordinator, each writer's worktree and allowed paths, shared-contract owner, dependencies and integration owner before parallel edits. Role names do not grant permission to message other agents or execute Git/remote actions.
- Preview affected checks with `node scripts/agent/check.mjs --base <starting-SHA>`; add `--run` to execute local checks. This does not replace UI acceptance or caller analysis.
- Shared contracts and CI files have one writer per parallel effort. Worktrees isolate source files, not ports, cookies or remote data.
- Commit, push, PR creation, merge, rebase, cleanup and remote operations follow explicit user authorization. Production releases run locally from clean, merged main via `docs/development/local-release.md`; Actions validates only. Ordinary development does not authorize merge, deployment or remote migrations.

## What this repo is

Product brand: **kedoupi（codepi）**. Use this exact brand for shared login,
transactional email and cross-product identity. KDP is a technical abbreviation;
existing service names, database names and cookie identifiers do not need renaming.
Reuse `packages/shared/brand.ts` and `packages/shared/email/otp.ts` for brand and OTP mail content.

Monorepo for the kedoupi（codepi）personal digital space, on `codepi.app`. The repository keeps exactly four products: the homepage (`apps/web/`), GU (`apps/gu/`), the WeChat workbench GZH (`apps/gzh/`) and Health (`apps/health/`). `services/auth/` and `packages/shared/` are support layers, not products. The former static tool sites (`calc/`, `convert/`, `text/`, `dev/`, `ai/`), the homepage calculator and guide pages, `/tools/`, and the `kdp.cool` and `oura.kdp.cool` domains are retired and must not be reintroduced. Advertising and traffic growth are no longer product goals. See `docs/architecture/personal-design-system.md` for the shared visual contract. In-flight scope and cutover order live in `docs/development/tasks/2026-10-15-codepi-cutover.md`. Read `README.md` for the domain table, DNS records, and per-project CF settings — do not duplicate that content here.

## Architecture in one screen

```
kdp.cool/
├── apps/
│   ├── web/     → personal homepage and private desk (Astro)
│   ├── gu/      → private investment app (Vite + Worker)
│   ├── gzh/     → private WeChat workbench (Vite + Worker)
│   └── health/  → Health (Svelte + Workers, pnpm workspace member)
├── services/
│   └── auth/  → shared login Worker
├── packages/
│   └── shared/ → layouts, styles, products, auth client, email templates, desk contract
├── scripts/   → agent checks and Cloudflare governance
└── docs/      → architecture and development documentation
```

All packages are managed by a single pnpm workspace (`pnpm-workspace.yaml` at the root). Install once from the repository root with `pnpm install`; each app retains its own `package.json` and scripts. `apps/web/` is the only Astro site; shared source is imported as `@kedoupi/shared/<subpath>`, while its `astro.config.mjs` Vite alias `@site` points to `./src`.

`packages/shared/` is a private workspace package with an explicit `exports` allowlist. Add public subpaths to that list when introducing shared APIs; unlisted module imports are rejected. Its source files are consumed by the homepage build and by the private app bundles. `packages/shared/auth/client.test.mjs` runs against the Health workspace dependencies.

The homepage brand identity lives in `apps/web/src/site.config.js` exporting `siteName`, `tagline`, `footerNote`, `navLinks`, `applicationCategory`, `personalSite`. `BaseLayout.astro` reads it via `@site/site.config.js` and the Astro-injected `import.meta.env.SITE` from `apps/web/astro.config.mjs`.

## Commands

Install all dependencies from the repository root:

```bash
pnpm install                     # installs all workspace packages
```

Then run commands from a specific app directory (`apps/web/`, `apps/gu/`, `apps/gzh/`, `apps/health/`, or `services/auth/`):

```bash
cd apps/web
npm run dev                        # http://localhost:4321
npm run build                      # → apps/web/dist
npm run preview                    # serves apps/web/dist
npm test                           # builds services/auth first, then node:test
```

Health: `cd apps/health && pnpm test`, `pnpm typecheck`, `pnpm build`.

Run a single test file:

```bash
cd apps/web && node --test test/desk.test.mjs
```

There is no monorepo-level `npm test` / `npm run build`. Iterate per app.

## Pitfalls (these will bite you)

1. **The root `.npmrc` pins the public npm registry.** `@astrojs/tailwind@6` declares peer `astro@^3||^4||^5` while we run Astro 6. The retained `legacy-peer-deps` option is for npm; do not treat it as pnpm peer-dependency validation. Keep the frozen workspace lockfile and verify the homepage build.
2. **Use pnpm for all installs.** Run `pnpm install` from the repository root. Do not use `npm install` or `npm ci` in individual app directories.
3. **Personal-space direction supersedes AdSense review restrictions.** Do not add advertising scripts, placeholders, or publisher files.
4. **`packages/shared/` change ripples beyond the homepage.** `packages/shared/layouts/BaseLayout.astro`, `packages/shared/styles/`, `packages/shared/brand.ts` and `packages/shared/email/` are consumed by the homepage build and by the GU, GZH and Health bundles. Verify the affected apps, not just `apps/web/`.
5. **Auth changes are a cross-app contract.** `packages/shared/auth/` and `services/auth/` are consumed by GU, GZH, Health and `desk`. A change there requires the auth, homepage/desk, GU, GZH and Health checks plus `packages/shared/auth/client.test.mjs`. The central `SSO_CLIENTS` secret and each app's `AUTH_CLIENT_ID`/redirect URIs must stay in sync.
6. **Shared visual contract.** Reuse `packages/shared/styles/tokens.css`, `packages/shared/styles/site.css` and `packages/shared/products.ts`. Personal-site pages must share navigation, typography, colors, spacing and interaction states. Private apps adopt these rules in their own migration phase; do not claim all apps are restyled when only shared tokens exist.

## Conventions

- **Keep behavior and presentation apart.** Match an existing page before inventing a pattern; shared components beat per-page copies.
- **No advertising.** Shared ad injection, components and placements have been retired. Do not reintroduce them.
- **Public pages are independent of private data.** The homepage, `/apps/`, `/about/`, `/privacy/`, `/terms/` and `/contact/` must not embed health, investment or unpublished draft data. Private apps stay behind unified login.
- **Product registry is shared.** `packages/shared/products.ts` is the single list of public product entries; update it when a product is added or retired, and keep it free of private business data.
- **Health names the application; Oura names its provider.** Application code lives in `apps/health/`, with workspace packages `health-kdp`, `@health-kdp/web` and `@health-kdp/api`. Keep `oura` in provider modules, OAuth endpoints and credentials. Existing SSO client IDs, cookies and persisted provider fields are protocol/data identifiers; changing them requires an explicit migration, not a text replacement. Cloudflare physical resource names follow the governance document and resource registry.
- **No new dependencies without asking.** The homepage stack is locked at Astro 6 + `@astrojs/tailwind@6` + Tailwind v3 + `@astrojs/sitemap` + zero JS framework. Private apps retain their existing stacks. Any addition needs explicit user approval.

## Adding work

- Adding or retiring a product: see README §"Adding or retiring a product" for the shared touchpoints and the safe order of operations.
- Retiring something means removing code, entries, Cloudflare custom domains and DNS records — in that order. Data deletion is a separate, explicitly authorized step.
- `services/auth/` and DNS/cutover work can affect every product at once; keep those changes in their own task with their own verification.

## Workflow notes

- Design docs and implementation plans live in `docs/superpowers/specs/` and `docs/superpowers/plans/`. A proposal is not approval or implementation evidence; verify scope against current user decisions, code and tests.
- Cloudflare rules live in `docs/development/cloudflare-governance.md`; resource ownership and dated verification evidence live in `docs/development/cloudflare-resource-registry.md`. A registry entry or workflow file is not proof of current remote readiness or successful release.
- Current product direction is recorded in `docs/superpowers/plans/2026-10-15-personal-digital-space-roadmap.md`; visual rules are in `docs/architecture/personal-design-system.md`. Old AdSense records are historical context and do not override the personal-space direction.
