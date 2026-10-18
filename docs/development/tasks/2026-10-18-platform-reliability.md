# Production reliability follow-up

- Status: implemented, locally verified and pushed as PR #81; pending merge and post-release acceptance.
- Worktree: `/Users/codepi/.worktrees/kdp.cool/codex/platform-reliability`.
- Branch: `codex/platform-reliability`.
- Baseline: `3d86d3e5449c3097da3ce1073c71e4d5837f4a6d`.
- Implementation commit: `878d557494329e4335c49ac87d46b3aaaabf5e25`;
  the follow-up commit only records the operational verification.
- PR: https://github.com/kedoupi/kdp.cool/pull/81.
- Owner: this Codex session, the sole writer of application configuration, scripts and CI.
- User scope: close the legacy health-data leak; add recovery, monitoring, migration and
  quality checks; update Health runtime compatibility. No new dependencies.
- Preserve: private Git history, applied GU migrations, `local + production`, existing
  product/authentication contracts and the single deployment entry point.

## Delivery state

| Stage | Evidence |
| --- | --- |
| Implementation | Complete for the original reliability scope and the frontend release gate |
| Local validation | 27 selected checks passed, including all applications and Health normal/SSO browsers |
| Script tests | 72 Cloudflare tests, 24 agent-check tests and 6 migration tests passed |
| Review | Self-review of the full change; no independent reviewer run claimed |
| Commit / push / PR | Implementation pushed at `878d557`; PR #81 open |
| Merge / deployment | Not performed |
| Operational acceptance | Legacy route closed, logs enabled, current-format exports and synthetic remote restore verified; scheduled workflows pending |

## Implemented

1. **Legacy anonymous access closed.** CloudBase `ModifyHTTPServiceRoute` disabled
   exactly `api.xiaotaozi.cc /oura/daily`. Cache-busted anonymous requests return 403.
   The callback, sync, login-status and wildcard routes were preserved; no stored data
   was deleted. Real data remains in the private Git history by the existing decision.
2. **Persistent observability.** All six production Worker settings were updated via
   API: persistent invocation logs, sampling rate 1, query-string redaction and Issues
   enabled. Matching logging configuration is in all six Wrangler files, enforced by
   the governance gate. The live telemetry API returned actual Health cron/task logs.
   Two account-email notification policies were created: platform incident
   `11766abf994c4e61adf7d19e7b956697` and Workers Issues
   `68eee86535f549a384704c8e69887244`. Email delivery itself was not exercised.
3. **Scheduled production monitor.** Every 30 minutes, verify Auth health, anonymous
   private API contracts, exact SSO destinations, continued closure of the legacy
   route and Health sync freshness. The workflow runs only on main in the production
   Environment, reusing `CLOUDFLARE_ACCOUNT_ID` / `CLOUDFLARE_API_TOKEN`. The strict D1
   flag makes missing credentials fail the scheduled job. HTTP and D1 operations are
   read-only; the reused credential still has deploy permissions. Notification receipt
   depends on the owner's GitHub settings.
4. **Encrypted D1 backup.** The five IDs in `d1-backup.mjs` are checked against actual
   Wrangler bindings. Each SQL export is gzipped and encrypted in memory with a fresh
   AES-256-GCM key; RSA-3072 OAEP/SHA-256 wraps the key. Envelope metadata is authenticated.
   Only the public recipient is in Git. The private key is outside Git at
   `~/.config/kdp.cool/backup/recovery-private-key.pem` (0600); matching key material and
   permissions were verified without printing it. The workflow stores ciphertext and
   a manifest in Actions artifacts with 14-day expiry; no backup repository, PAT or
   new Actions secret is required. See [the runbook](../cloudflare-backup-restore.md).
5. **Manual recovery.** `d1-restore.mjs` refuses the five production UUIDs and any
   destination containing business tables/views. It authenticates the envelope, uses
   the workspace-locked Wrangler and removes its temporary 0600 SQL file on success
   or failure. Provider SQL output is not echoed. A binding/traffic cutover is separate.
6. **Health compatibility.** API configuration moves from `2025-01-01` to `2026-10-15`;
   integration tests now read that date from the production configuration. All Health
   checks passed. The live Worker still needs the new release.
7. **Migration/quality/dependency checks.** Twenty historical migration hashes are
   frozen. Only the exact historical GU `0002_calendar.sql` / `0002_sso.sql` pair is
   grandfathered; a third file or a differently padded duplicate is rejected. Existing
   filenames/content were preserved. Zero-dependency syntax/JSON lint and weekly grouped
   Dependabot PRs were added. These checks and all script tests run in the deployment
   governance job; PR triggers include their paths and the new workflows.
8. **Frontend release gate.** Main run `39059543034` uploaded the Health frontend but
   failed in `verify runtime configuration`. The pure proxy passed no required-secret
   list to `resolve-worker`, which required a nonempty list. The frontend now supplies
   the explicit `--no-required-secrets` contract. Missing contracts still fail and the
   other apps retain their secret requirements. Regression tests reproduced the failure
   before the fix; the repaired command resolved the actual production Worker origin
   `https://codepi-health.kedoupi.workers.dev` through read-only API calls.

## Validation evidence (2026-10-18)

- Baseline and remote main both verified as `3d86d3e5449c3097da3ce1073c71e4d5837f4a6d`.
- `node scripts/agent/check.mjs --base 3d86d3e5449c3097da3ce1073c71e4d5837f4a6d --run`:
  27/27 checks passed. Local log: `/tmp/kdp-platform-reliability-check-20261018.log`.
- `node --test scripts/cloudflare/*.test.mjs scripts/agent/*.test.mjs`: all passed.
  Governance, migration baseline and syntax/JSON lint passed; `git diff --check` passed.
- Current-format production backup: all five databases exported and each authenticated
  decryption verified in memory. Encrypted-only local directory:
  `~/.local/share/kdp.cool/backups/2026-10-18T01-44-06-576Z`.
  This is a verified local copy, not an uploaded Actions artifact.
- Restore drill with the new envelope/script passed: production public recipient,
  local recovery key, the real restore script and the workspace-pinned Wrangler
  restored a synthetic table with 2 rows and checksum 42. A second import was refused
  because the target was no longer empty. Exercise files were removed.
- Temporary resource: `codepi-health-pr-81`, UUID
  `7685ecb8-fa28-4a4a-81bb-743b1c1e97d4`; classification `synthetic`;
  `expires_on: 2026-10-18`; `cleanup_evidence: DELETE returned 200, subsequent account
  D1 list contained exactly the original five production UUIDs`. No runtime bindings
  or production tables were modified for the exercise.
- PR CI started as platform run `39087816710` and SSO/GU run `39087816750`;
  SSO/GU passed. Platform status is checked separately; a PR check does not deploy.
- Live monitor: 10/11 pass; Health last success was `2026-10-15T15:16:55Z`, about 58h old.
  This is a real operational failure, not a test waived to obtain a green result.

## Health sync investigation

The cron runs and updates task attempts/backoff; live telemetry confirms scheduled task
execution. The current queue has 49 pending tasks and repeated `upstream_unavailable`.
The single stored token record was last updated `2026-10-15 06:23:40` and uses envelope v2.
Only operational metadata was queried; no credentials or health-record values were printed.

The code already maps Oura HTTP rejection statuses through `upstreamFetch`; the later
`!res.ok` branch in `ouraGet` is not proof that all provider responses lose their status.
The remaining generic code can represent a network failure, provider failure or another
error normalized by the sync caller. Current metadata does not establish a root cause.
Do not rotate `TOKEN_ENCRYPTION_KEY`, delete grants or promise that reauthorization will
solve the failure without further evidence. Website SSO is a separate lifecycle.

## Remaining and next steps

1. Owner-managed recovery-key escrow outside this machine is not verified. Preserve
   the private key; it is required to recover all backups addressed to this recipient.
2. Continue diagnosing Health's provider sync. The monitor is expected to remain red
   until the real failure is resolved; do not change the threshold to hide it.
   Latest trace evidence (2026-10-18, temporary traces on `codepi-health-api`):
   the failing cron execution shows only D1 spans and no outbound fetch span,
   while ordinary GET requests on the same Worker do show fetch spans. The failure
   happens before any Oura request is made, pointing at token read/decrypt or the
   D1 side rather than provider reachability. `DecryptError` (code
   `decrypt_failed`) is not an `ApiError` and is normalized to
   `upstream_unavailable` by the sync caller, which matches the observation but is
   not yet confirmed. Do not rotate `TOKEN_ENCRYPTION_KEY`, delete grants or promise
   that reauthorization will solve the failure without further evidence.
3. Local `gh` cannot retrieve a usable OAuth token; available token candidates
   (`GITHUB_TOKENS`) all return 401. The GitHub connector and Git SSH transport
   remain usable. Because of this, the first Actions backup artifact could not be
   downloaded for a decryption check; see the 2026-10-18 follow-up evidence below
   for the compensating verification that was performed.

## Follow-up evidence (2026-10-18, PR #91 / main `1816abf2`)

- PR #81 merged as `4842996`; main release run `39088985860` all jobs succeeded.
  Control plane afterwards showed `codepi-health-api` at BUILD_SHA `48429969c5c1`
  with `compatibility_date` `2026-10-15`; the Health frontend `verify runtime
  configuration` gate that had failed now passes.
- Deployment-overwrite bug found after PR #81: manually API-enabled observability
  flags that were not in wrangler config were reset by each deploy (six Workers
  lost `traces.enabled`; five of six lost `issues.enabled`).
- PR #91 (`d0a5859`, merged as `1816abf2`) added `[observability.issues]` to all
  six production wrangler configs, a `validate-governance.mjs` `issuesEnabled`
  check (TOML + JSONC paths, with a regression test), and path-scoped `push`
  triggers so `d1-backup` and `production-monitor` run on merge instead of
  waiting for cron. Local: 103/103 node tests, governance/lint/migration checks,
  `git diff --check` all passed.
- Main release run `39090056820`: all 13 jobs succeeded, including all six
  production deploys with evidence artifacts.
- Post-deploy settings API check (2026-10-18T02:30Z): all six Workers report
  `issues.enabled=true` and `traces.enabled=false` — the alert setting now
  survives deployment, and the temporary diagnostic traces on
  `codepi-health-api` were reset to the configured value as intended.
- First push-triggered `d1-backup` run `39090056809` succeeded and produced
  artifact `d1-backup-39090056809-1` (~1.5 MB). Direct decryption of that zip
  was not possible locally (no working GitHub token for the artifact download).
  Compensating checks: 5/5 `d1-backup` unit tests pass; repo public key and the
  local recovery private key share `key_id` prefix `346ac1bf375c4382`; an
  in-memory encrypt/decrypt roundtrip with the production recipient pair
  succeeded. Full artifact-level verification is pending a working token.
- First push-triggered `production-monitor` run `39090056823` failed as
  expected: Health's automatic sync is still red (last success about 59h ago).
  This is the real known failure, not a regression from this change.
