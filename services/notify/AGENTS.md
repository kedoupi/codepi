# Notify service boundary

`services/notify/` is the shared structured notification Worker. Producers submit validated
`notify.event/v1` records; only this service decides whether and when to send email.

- Do not add recipient, sender, HTML, attachment or provider credentials to events.
- Producer tokens are issued with `scripts/issue-token.mjs`; the script derives allowed kinds from `src/rules.ts`, writes the secret only to a new `0600` file, and writes a hash plus token id to SQL. `rpc` is an internal RPC source and cannot be issued as an HTTP token.
- Revoke by setting `revoked_at` for the token id in `producer_tokens`; verify the old token returns HTTP 401, then issue a replacement. Keep the plaintext file outside the repository.
- `NOTIFY_TO` is a runtime secret. The Worker passes it explicitly to Email Sending and fails closed when it is absent; after release, read back a synthetic `notify.selftest` delivery and its provider message id.

- `FEISHU_APP_ID`、`FEISHU_APP_SECRET`、`FEISHU_RECEIVE_OPEN_ID` 是运行时 secrets；事件不能指定收件人，飞书只发送给固定 `FEISHU_RECEIVE_OPEN_ID`。飞书为主渠道，邮件按严重度和飞书失败结果兜底。
- 渠道投递状态写入 `channel_attempts`；一次通知只占一次限额，多渠道发送和渠道重试不重复扣额。飞书 token 仅在 Worker 隔离内缓存，不写日志或数据库。
- Local checks: `pnpm test`, `pnpm typecheck` (uses this package's pinned TypeScript 7.0.2 and Cloudflare Workers types 5.20261104.1), `pnpm build`; release uses the root Cloudflare workflow.
- The service binds only its own D1 database `codepi-notify`; it has no business R2 bindings and no public route other than
  `notify-api.codepi.app`.
