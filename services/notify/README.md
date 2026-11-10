# codepi-notify

`codepi-notify` accepts the shared `notify.event/v1` contract through the `NotifyApi` named
RPC entrypoint and the authenticated `notify-api.codepi.app/v1/events` endpoint. It stores
validated events, incident state and email outbox rows in its own D1 database.

Issue a producer token locally:

```bash
node scripts/issue-token.mjs --source surgeconf.watchdog --kinds agent.stuck,approval.pending,plans.orphan_digest,notify.selftest --out /path/to/token --sql /path/to/token.sql
```

The token file is created with mode `0600`; the SQL contains only a SHA-256 hash. Rotate by
revoking the old D1 row and issuing a new file. `NOTIFY_TO` is injected as a runtime secret
by the authorized release operator; it is never committed or stored in D1.
