# codepi-notify

`codepi-notify` accepts the shared `notify.event/v1` contract through the `NotifyApi` named
RPC entrypoint and the authenticated `notify-api.codepi.app/v1/events` endpoint. It stores
validated events, incident state, channel attempts and one outbox delivery row per notification in its own D1 database. Feishu is the primary channel; critical and selftest notifications use both Feishu and email, while warning notifications fall back to email after a permanent or exhausted Feishu failure.

Issue an HTTP producer token locally:

```bash
node scripts/issue-token.mjs --source surgeconf.watchdog --kinds agent.stuck,approval.pending,plans.orphan_digest,notify.selftest --out /path/to/token --sql /path/to/token.sql
```

The token file is created with mode `0600`; SQL stores only the token id, SHA-256 hash, source and allowed kinds. `rpc` is reserved for the named RPC entrypoint and cannot be issued here. To revoke, set `revoked_at` for the token id in `producer_tokens`; the old token must then return HTTP 401 before replacement use.

For the health producer, issue a token with both event kinds:

```bash
node scripts/issue-token.mjs --source mybrain.job-health --kinds job.health,job.unhealthy --out /path/to/job-health-token --sql /path/to/job-health-token.sql
```

`job.health` info events are alert deliveries sent through Cron, with each daily card delivered alone so its original title, summary and facts remain intact. `job.unhealthy` warning events send firing and, after a successful firing delivery, resolved notifications; firing events received during Beijing 23:00–08:00 quiet hours are deferred until 08:00. Both kinds use Feishu first with the existing email fallback. Feishu card titles carry the `[通知] ` prefix.

`NOTIFY_TO` is injected as a runtime secret by the authorized release operator; it is never committed or stored in D1. After release, read back a synthetic `notify.selftest` event and confirm the delivery status and provider message id. Binding success means accepted for delivery, not mailbox receipt.

Feishu uses the runtime secrets `FEISHU_APP_ID`, `FEISHU_APP_SECRET` and `FEISHU_RECEIVE_OPEN_ID`; they are never committed, returned by the read-back API or written to logs. Token caching is isolated to the Worker runtime and keyed by app id. The card UUID is `notify-<minimum delivery id>` and Feishu's one-hour idempotency window means a retry after that window may produce a duplicate message. Conversely, if Feishu accepted a send but the Worker timed out locally, a batch with the same minimum id within one hour may be deduplicated by Feishu and the new content may not be delivered.

`channel_attempts` is the source for per-channel retry state. A notification reserves quota once; channel fan-out, fallback and retries do not reserve additional quota. The `0002_channel_attempts.sql` migration is additive and must be applied after `0001_notify.sql`. Rollback keeps the migration applied and requires a Worker version that understands the new table.

## 发布与回滚

`NOTIFY_TO` 是 Worker runtime secret，固定实际收件地址；`NOTIFY_DESTINATION_ADDRESS` 只在授权的 `deploy-domain.mjs --app notify` 过程中注入临时 Wrangler 配置的 Email Sending destination，占位配置和 Git 中不保存真实地址。两者都不写入事件或 D1。

发布前运行受影响检查和 `pnpm --filter @codepi/notify build`，再执行 `pnpm --dir services/notify deploy -- --sha <reviewed-source-sha>`。发布后用合成 `notify.selftest` 读回 delivery 状态和 provider message id。回滚沿用根发布流程的已核对 Worker version；D1 migration 不随 Worker 回滚，任何 schema 不兼容都先停止。
