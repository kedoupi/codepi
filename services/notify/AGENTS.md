# Notify service boundary

`services/notify/` is the shared structured notification Worker. Producers submit validated
`notify.event/v1` records; only this service decides whether and when to send email.

- Do not add recipient, sender, HTML, attachment or provider credentials to events.
- `NOTIFY_TO` is a runtime secret. The Worker passes it explicitly to Email Sending and
  fails closed when it is absent.
- Producer tokens are hashed in D1 and should be issued with `scripts/issue-token.mjs`.
- Local checks: `pnpm test`, `pnpm build`; release uses the root Cloudflare workflow.
- The service has no business D1/R2 bindings and no public route other than
  `notify-api.codepi.app`.
