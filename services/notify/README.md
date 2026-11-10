# codepi-notify

`codepi-notify` accepts the shared `notify.event/v1` contract through the `NotifyApi` named
RPC entrypoint and the authenticated `notify-api.codepi.app/v1/events` endpoint. It stores
validated events, incident state and email outbox rows in its own D1 database.

Issue an HTTP producer token locally:

```bash
node scripts/issue-token.mjs --source surgeconf.watchdog --kinds agent.stuck,approval.pending,plans.orphan_digest,notify.selftest --out /path/to/token --sql /path/to/token.sql
```

The token file is created with mode `0600`; SQL stores only the token id, SHA-256 hash, source and allowed kinds. `rpc` is reserved for the named RPC entrypoint and cannot be issued here. To revoke, set `revoked_at` for the token id in `producer_tokens`; the old token must then return HTTP 401 before replacement use.

`NOTIFY_TO` is injected as a runtime secret by the authorized release operator; it is never committed or stored in D1. After release, read back a synthetic `notify.selftest` event and confirm the delivery status and provider message id. Binding success means accepted for delivery, not mailbox receipt.
