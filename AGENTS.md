# AGENTS.md

This is the shared project contract for all coding agents. Tool-specific entry files reference it and must not maintain separate project rules.

## Start here

- Read [development navigation](docs/development/README.md) for rule ownership and task routing; use [docs navigation](docs/README.md) for current versus historical material.
- Follow [agent workflow](docs/development/agent-workflow.md) for implementation, verification and handoff. Choose a shared skill from `.agents/skills/` when the task matches it.
- Before editing `apps/`, `services/` or `packages/`, read the target directory's local `AGENTS.md`; inspect implementations, callers and tests.
- Confirm the real Git root, starting SHA, existing changes and allowed paths. Preserve unrelated work. Ordinary work does not require an agent allocation table.

## Project boundary

- This repository is **kedoupi（codepi）**, a pnpm workspace whose products live under `apps/`.
- Use `kedoupi（codepi）` for shared login, transactional email and cross-product identity; reuse the shared brand and OTP modules.
- `services/auth/`, `services/mcp/`, `services/ops/` and `packages/shared/` are support layers, not products.
- The former tool sites, homepage calculator/guides, `/tools/`, `kdp.cool`, `oura.kdp.cool` and advertising are retired; do not restore them.
- `packages/shared/products.ts` is the single source for the public product registry. Keep it free of private business data.
- Shared visual authority is `docs/architecture/codepi-design-system.md`; `personal-design-system.md` supplements homepage-specific guidance.
- Architecture, product commands, technical stack and local service details belong to their linked architecture, README and local rule documents, not here.

## Non-negotiable engineering and security

- Keep public pages independent of private health, investment and unpublished draft data; private apps use unified login.
- Changes to `packages/shared/`, Auth, MCP or a domain Worker require checking all consumers and following the affected-check mapping. Shared contracts have one writer.
- Keep behavior and presentation separate, reuse existing components and patterns, and do not add dependencies without explicit approval. Astro 6 with `@astrojs/tailwind@6` has a known peer-range warning; preserve the npm compatibility setting and verify the homepage build.
- Do not expose credentials, private keys, cookies, tokens or private business data in code, logs, task records or replies.
- Do not perform Git history changes, remote operations, deployment, production data changes or migrations without explicit authorization. Do not commit, push, merge, rebase or release as part of ordinary development.

## Verification and release

- Preview affected checks with `node scripts/agent/check.mjs --base <starting-SHA>` and run them with `--run`; use the actual mapping and report uncovered paths.
- Run targeted tests first. UI, real OAuth, production data, remote bindings, mail delivery and release acceptance require separate evidence.
- Use `docs/development/integration-release.md` for branch audits, integration and retirement, and `docs/development/local-release.md` for authorized local releases from clean, merged `main`.
- A document, registry entry, workflow or CI result is not proof of current remote readiness or production acceptance.
