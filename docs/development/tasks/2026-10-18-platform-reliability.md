# Production reliability follow-up

- Status: original reliability work deployed through PR #81 / #91; Actions backup
  artifact verified. Health sync recovery is locally verified and pushed as PR #93;
  CI runner startup is blocked, so merge and release acceptance are pending.
- Worktree: `/Users/codepi/.worktrees/kdp.cool/codex/platform-reliability`.
- Branch: `codex/health-sync-recovery`.
- Original baseline: `3d86d3e5449c3097da3ce1073c71e4d5837f4a6d`.
- Health recovery baseline: `58f7848740db3b6f0fb3935201500d46c97744d7`.
- Health recovery implementation: `2414d416cc5ca29fba6b71cf6ee2bac9a607a78c`.
- Original implementation commit: `878d557494329e4335c49ac87d46b3aaaabf5e25`;
  the follow-up commit only records the operational verification.
- PR: https://github.com/kedoupi/kdp.cool/pull/81.
- Recovery PR: https://github.com/kedoupi/kdp.cool/pull/93.
- Owner: this Codex session, the sole writer of application configuration, scripts and CI.
- User scope: close the legacy health-data leak; add recovery, monitoring, migration and
  quality checks; update Health runtime compatibility. No new dependencies.
- Preserve: private Git history, applied GU migrations, `local + production`, existing
  product/authentication contracts and the single deployment entry point.

## Delivery state

| Stage | Evidence |
| --- | --- |
| Implementation | Original reliability scope and frontend release gate complete; Health decrypt-failure classification implemented |
| Local validation | Original 27 selected checks passed; Health recovery passed all 9 selected checks, including normal and SSO browsers |
| Script tests | 72 Cloudflare tests, 24 agent-check tests and 6 migration tests passed |
| Review | Self-review of the full change; no independent reviewer run claimed |
| Commit / push / PR | PR #81 / #91 / #92 merged; Health recovery pushed at `2414d41` in open PR #93 |
| Recovery CI | Run `39094891244` attempts 1 and 2 failed before any runner/steps started; no CI test result available |
| Merge / deployment | Original reliability released at `4842996`; observability persistence released at `1816abf2` |
| Operational acceptance | Legacy route closed, logs/Issues enabled, scheduled backup artifact decrypted and synthetic restore verified; Health provider recovery and off-machine private-key escrow pending |

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
execution. The queue has 49 tasks and repeated `upstream_unavailable`.
The single stored token record was last updated `2026-10-15 06:23:40` and uses envelope v2.
Only operational metadata was queried; no credentials or health-record values were printed.

The code already maps Oura HTTP rejection statuses through `upstreamFetch`; the later
`!res.ok` branch in `ouraGet` is not proof that all provider responses lose their status.
The remaining generic code can represent a network failure, provider failure or another
error normalized by the sync caller. The initial metadata did not establish a root cause;
the recovery section below records the reproducible classification defect.
Do not rotate `TOKEN_ENCRYPTION_KEY`, delete grants or promise that reauthorization will
solve the failure without further evidence. Website SSO is a separate lifecycle.

## Remaining and next steps

1. Owner-managed recovery-key escrow outside this machine is not verified. Preserve
   the private key; it is required to recover all backups addressed to this recipient.
2. Release and verify Health's provider sync classification fix below. The monitor is expected to remain red
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
   remain usable. The connector successfully downloaded the first Actions backup
   artifact; artifact verification is complete as recorded below.

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

## Actions backup artifact acceptance (2026-10-18)

- The GitHub connector downloaded artifact `12122019076`,
  `d1-backup-39090056809-1`, from successful run `39090056809`; no replacement
  GitHub token was needed.
- Archive SHA-256
  `a25dc3aa0cab6dcfd2a33421e4645fc6658ba290a45e31f68901557c2a53755b`
  matches the API digest. Contents are exactly five `.sql.enc` files and
  `manifest.json`; each encrypted file's bytes and SHA-256 match its manifest entry.
- All five databases passed authenticated in-memory decryption with the existing
  recovery private key. The manifest, repository public key and local private key
  share `key_id` prefix `346ac1bf375c4382`; database names, UUIDs and export timestamps
  were authenticated as GCM AAD. SQL plaintext was not written to disk or printed;
  decrypted buffers were cleared after verification.
- Ciphertext-only copy:
  `~/.local/share/kdp.cool/backups/actions-39090056809-1/`
  (directory `0700`, files `0600`). This closes the previously pending artifact-level
  verification; the earlier synthetic restore drill remains the restore-script evidence.
- Off-machine/offline private-key escrow is still owner-managed and unverified.

## Health sync recovery (baseline main `58f7848`)

- Reproduced defect: `loadEncryptedTokenRecord` raises `DecryptError` for an
  unreadable provider grant; the sync caller normalized it to
  `upstream_unavailable`, consumed retries and stayed `running` instead of
  indicating that consent must be renewed.
- Minimal fix in `oura-access.ts`: translate only `DecryptError` from token
  loading into `ApiError("reconnect_required", 401)`. D1 and other errors retain
  their existing handling. Both daily scores and detailed collections use this
  boundary; SSO and MCP authorization are unchanged.
- Four synthetic integration cases cover wrong encryption keys / owner AAD for
  `heartrate` and `__scores`. Before the fix: 0/4 passed, with `running` and
  `upstream_unavailable`. After the fix: 4/4 passed, with `blocked` and
  `reconnect_required`, no upstream calls, no consumed retries, unchanged stored
  ciphertext, no later cron retries, and completion after a fresh OAuth callback.
- No production encryption key or stored authorization was changed. Production
  decrypt failure remains a hypothesis until the released cron reports the new
  classification. A reconnect is not claimed as a verified production recovery.
- Verification:
  `pnpm build && node --experimental-strip-types --test --test-name-pattern='unreadable Oura grant' test/integration/auto-sync.test.mjs`
  in `apps/health/workers/api` reproduced 4 failures before the fix and passed all
  4 afterwards.
  `node scripts/agent/check.mjs --base 58f7848740db3b6f0fb3935201500d46c97744d7 --run`
  passed all 9 selected checks: Cloudflare tests/governance, agent checks/lint,
  Health tests/typecheck/build/assets and normal/SSO browser journeys.
  This includes 48 API unit tests and 120 integration cases; Svelte reported no
  errors or warnings. Log: `/tmp/kdp-health-sync-recovery-check-20261018.log`.
- Self-review covered the complete four-file diff and both token-access callers;
  no independent reviewer run is claimed.
- Before release, the production read-only query at `2026-10-18T03:46:00Z` still
  showed `running` / `upstream_unavailable`, 49 tasks (27 pending / 22 failed) and
  last success `2026-10-15T15:16:55.898Z`; the query wrote no rows.

### Release blocker (PR #93)

- Pushed implementation `2414d41`; PR #93 targets unchanged main `58f7848`.
- Platform run `39094891244`, attempts 1 and 2: `governance` and `affected`
  failed in 2-3 seconds with `runner_id=0`, blank runner names and `steps=[]`;
  downstream build/deploy jobs were skipped. The retry used the failed-jobs API.
  There is no evidence that a repository check or test ran in either attempt.
- The failed job's log endpoint returned `BlobNotFound`; the check-run collection
  reports two annotations on each failed job but the connector does not support
  fetching that annotation endpoint. The underlying startup reason is unverified;
  billing, quota or an outage must not be recorded as a confirmed cause.
- At `2026-10-18T03:50:30Z`, the Health API settings still reported
  `BUILD_SHA=1816abf2a78b`, compatibility date `2026-10-15`, persistent logs and
  Issues enabled. The recovery code is not deployed.
- The failure is account-wide, not PR-specific: the scheduled retry workflow run
  `39096787241` on main (`58f7848`, `2026-10-18T04:21Z`) also failed before
  runner assignment. Run creation and scheduling still work, so this is isolated
  to hosted runner startup for this account. Local `gh` and the `GITHUB_TOKENS`
  environment variable are both expired (`Bad credentials`), and the connector
  cannot read check-run annotations, so the exact startup reason stays
  unverified (billing/quota/outage not confirmed).
- A rerun of run `39096787241` at `2026-10-18T05:01Z` (attempt 2, job
  `117591546797`) failed identically: `runner_id=0`, blank runner name,
  `steps=[]`, three-second duration, no logs. Hosted runner startup remains
  blocked for the account at that time.
- Continue by resolving Actions runner startup, rerunning PR #93 checks, merging
  only after CI passes, and verifying the main release and next real cron.
  If it reports `blocked/reconnect_required`, the owner must reconnect Oura in
  Health before production sync recovery can be accepted. Preserve the current
  encrypted grant and encryption key.
