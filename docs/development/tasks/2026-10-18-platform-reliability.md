# Production reliability follow-up

- Status: implemented and locally verified; pending PR, merge and post-release acceptance.
- Worktree: `/Users/codepi/.worktrees/kdp.cool/codex/platform-reliability`.
- Branch: `codex/platform-reliability`.
- Baseline: `3d86d3e5449c3097da3ce1073c71e4d5837f4a6d`.
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
| Commit / push / PR | Not performed yet |
| Merge / deployment | Not performed |
| Operational acceptance | Legacy route closed, logs enabled, current-format production exports verified; scheduled workflows and current restore drill pending |

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
- Restore drill with the new envelope/script: pending. The earlier symmetric-format
  auth restore is historical and is not evidence for the replacement implementation.
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

1. Finish a synthetic remote restore drill using this envelope and restore script.
2. Commit/push the reviewed paths and open a PR. Merge remains the separate release
   step; do not treat a branch push as a production deployment.
3. After merge, verify the repaired frontend deployment, persistent logs, first backup
   artifact and both scheduled workflows. No additional Actions secrets are required.
4. Owner-managed recovery-key escrow outside this machine is not verified. Preserve
   the private key; it is required to recover all backups addressed to this recipient.
5. Continue diagnosing Health's provider sync. The monitor is expected to remain red
   until the real failure is resolved; do not change the threshold to hide it.
6. Local `gh` cannot retrieve a usable OAuth token; available token candidates return
   401. The GitHub connector and Git SSH transport remain usable. This is local
   authentication state, not evidence of repository or Cloudflare failure.
