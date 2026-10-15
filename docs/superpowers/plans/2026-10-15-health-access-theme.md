# Health: collection access pauses and application palette

## Scope and ownership

- User authorized investigation, fixes, validation and production release.
- Initial baseline: `eada8ae`; integrated main baseline: `d18f1cb`.
- Worktree: `/Users/codepi/.codex/worktrees/oura-background-sync/kdp.cool`.
- Coordinator and integration owner: main agent.
- Copernicus owns Health theme files and the three assigned frontend consumers:
  `health.ts`, `AutomaticSync.svelte`, `HealthDataPanel.svelte`.
- Main agent owns the API contract, executor, OAuth resume, browser regression,
  remaining consumers and this record. Assigned write paths do not overlap.
- James investigates provider access read-only; Raman reviews backend read-only.
- No shared token palette, account credentials or production health records change.

## Evidence and limits

The production coverage log records `upstream_access_denied` for
`daily_resilience`, `ring_configuration` and `ring_battery_level`.
This code means the resource still returned 401 after token refresh succeeded.
The documented paths, date parameters, Bearer header and nine public OAuth
scopes match our request construction.

The existing implementation discards the upstream error body. The exact Oura
reason and actual granted scopes cannot be established from the stored error
code. Do not infer unsupported hardware, expired membership or invalid global
authorization from this observation alone.

## Contract and behavior

- The latest collection attempt in `health_sync_windows` is durable evidence.
  A fresh-token 401 or resource 403 pauses that collection across all windows.
  Later successful checks supersede older refusals.
- Manual imports, manual planning and daily planning honor the same pause,
  including evidence older than the 90-day repair horizon.
- Existing pending/failed tasks become `unavailable` without provider calls.
  Other tasks retain checkpoints, retry budgets and quota/rate-limit delays.
- Automatic totals count executable work; `unavailable` separately reports
  collection, error code and check time. Completion means available work finished.
- Collection status and record reads expose `access` with `status`,
  `automatic_retry`, `code` and `checked_at`. Existing records stay readable.
- A successful OAuth callback clears refusal evidence and resumes paused tasks.
  Revoked refresh grants still block globally; transient failures keep bounded retries.
- Scores have a separate bounded failure path and cannot become a collection
  pause or repeatedly occupy the queue. Fresh consent can retry exhausted refusals.
- OAuth consent atomically invalidates old import/executor leases. Both successful
  and failed archive writes are fenced; a late token refresh uses the original
  encrypted row IV for compare-and-swap, preserving a newer consent grant.
- Imports recheck collection access after acquiring the shared user sync lease.
- Overview, settings and archive summaries distinguish access pauses from failures.
- Health owns its warm paper/orange palette. Apps share design and interaction
  rules while retaining their own colors.

## Validation and release

Required checks: `pnpm test`, `pnpm typecheck`, `pnpm build`,
`pnpm test:browser:built` from `oura/`; preview affected checks with
`node scripts/agent/check.mjs --base d18f1cb`.

Browser regression uses synthetic provider responses and ephemeral local D1.
It covers the three repeated 401s, one fresh-token retry each, reloads, continued
accessible work, archive summaries and the existing normal/SSO journeys.
Production acceptance must separately confirm the released build, warm theme,
three access pauses and continued progress of the pre-existing queue.

Local result: all four selected checks passed via the affected-check runner.
`pnpm test` passed 228 cases (25 script, 49 frontend, 44 API unit, 110 integration).
Type checking reported zero errors/warnings; build and normal/SSO browser journeys
passed, including 375px/390px layouts. Added race cases fail against the prior
bundle and pass after the fencing fixes. No production deployment was performed
as part of these local checks.

The live-success authorization unblock also verifies the caller's current sync
lease: an old success cannot clear a newer `invalid_grant` block. The added
interleaving regression reproduces that failure on the previous bundle.
The PR's first Linux browser run exposed an independent readiness race in the
keyboard test; it now waits for the asynchronously loaded sleep table before
focusing it, retaining the keyboard and data-row assertions.
