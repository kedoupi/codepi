# Ops support service

Read the root AGENTS.md and `docs/development/cloudflare-operations.md`.
This service runs private scheduled operations; it is not a fifth product.

- No public route, workers.dev endpoint, admin HTTP token, business D1 or recovery private key.
- The sole service binding is `GU -> codepi-gu#GuMaterialsBackup`, a read-only
  capability for indexed originals. Do not bind the GU bucket or add paired secrets.
- Share assertions and backup format with `scripts/cloudflare/`; preserve local CLI entry points.
- Workflow outputs and logs contain metadata only. Never return SQL, credentials,
  OAuth values or D1 signed export URLs from a durable step.
- Backup steps write only public-key encrypted bytes to private R2. Publish the
  manifest only after all six exports and every indexed GU original succeed;
  record cross-platform replication separately. A D1-only receipt is not complete coverage.
- Fail closed on missing credentials, incomplete Git history and transfer failures.
- Reuse the workspace-locked Wrangler; no additional third-party dependencies.
- Use synthetic SQL and originals in tests. Production export and publish use the normal release lock.
