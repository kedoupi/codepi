# Ops support service

Read the root AGENTS.md and `docs/development/cloudflare-operations.md`.
This service runs private scheduled operations; it is not a product.

- No public route, workers.dev endpoint, admin HTTP token, business D1 or recovery private key.
- The only service bindings are `GU -> codepi-gu#GuMaterialsBackup`,
  `ME -> codepi-me#MeImportsBackup` and `BLOG -> codepi-www#BlogMediaBackup`,
  read-only capabilities for indexed originals.
  Do not bind any business bucket or add paired secrets.
- Share assertions and backup format with `scripts/cloudflare/`; preserve local CLI entry points.
- Workflow outputs and logs contain metadata only. Never return SQL, credentials,
  OAuth values or D1 signed export URLs from a durable step.
- Backup steps write only public-key encrypted bytes to private R2. Resolve every
  required D1 by exact name or an explicit complete ID map. Publish the manifest only
  after all exports and every indexed GU, Me and blog original succeed; record cross-platform
  replication separately. A D1-only receipt is not complete coverage.
- The current manifest is v4 and covers every `ORIGINAL_COLLECTIONS` entry. Keep v2
  GU-only and v3 GU+Me manifests readable by local recovery, but do not emit incomplete
  v4 collections.
- Recover current v4 and legacy v2/v3 manifests with
  `scripts/cloudflare/originals-restore.mjs`; the old GU-only recovery entry point
  remains legacy-v2 specific.
- Fail closed on missing credentials, incomplete Git history and transfer failures.
- Reuse the workspace-locked Wrangler; no additional third-party dependencies.
- Use synthetic SQL and originals in tests. Production export and publish use the normal release lock.
