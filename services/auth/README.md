# KDP unified login

`codepi-auth` is the first-party login Worker for Health, GU, GZH and the personal desk. It accepts no
registration or arbitrary email address. The owner email remains server-side.

The product brand is **kedoupi（codepi）**, defined in `packages/shared/brand.ts`.
`packages/shared/email/otp.ts` supplies the shared HTML/text OTP template for the center
and GU/gzh legacy mail paths. It retains the configured verified sender address
and sets the common brand as its display name. Never duplicate OTP templates per app.

## Configuration

The committed Wrangler configuration declares the independent D1 database and
`auth.codepi.app`. Configure these secrets through Cloudflare:

- `OWNER_EMAIL`: the fixed owner used by GU.
- `OTP_FROM`, `RESEND_API_KEY`: the verified sender and mail API credential.
- `OTP_PEPPER`, `SESSION_SECRET`: independent random secrets, at least 32 characters.
- `SSO_CLIENTS`: the registered client names, independent secrets and exact
  `/api/auth/callback` URLs defined by the shared SSO contract.

`SSO_EXTRA_REDIRECT_URIS` is an optional public JSON map of already registered
client IDs to additional exact callback URLs. It follows the same validation as
the secret registry and never accepts browser-supplied registrations. The URLs
are merged with each client's `SSO_CLIENTS.redirectUris`; adding a callback does
not require rotating unrelated client credentials. Removing one requires checking
both sources. Keep production and staging callbacks separate; current bindings
and dated verification evidence are in the [CF resource registry](../../docs/development/cloudflare-resource-registry.md).

Optional per-client secrets `SSO_CLIENT_SECRET_GU`, `SSO_CLIENT_SECRET_OURA`,
`SSO_CLIENT_SECRET_GZH` and `SSO_CLIENT_SECRET_DESK` override only the matching
registered client's secret. An absent override retains `SSO_CLIENTS.secret` for
existing clients; an empty or short override fails closed. Callback registration
still comes from the registry and `SSO_EXTRA_REDIRECT_URIS`.

Use these bindings to recover or rotate one client without reading or rewriting
other credentials in the write-only JSON registry. Set the same new value on the
center and that app's `AUTH_CLIENT_SECRET`, then redeploy the Pages app through
the release workflow. Keep the value out of logs and files. Existing sessions for
that app need a fresh login because their stored references use the old key.
This does not rotate the center session, OTP, provider or MCP credentials.

Applications bind `AUTH` to this Worker and configure their own `AUTH_CLIENT_ID`,
`AUTH_CLIENT_SECRET`, `AUTH_ORIGIN` and `SSO_ENABLED`.

## Validation

Run from the repository root:

```sh
pnpm install --frozen-lockfile
pnpm --dir services/auth test
pnpm --dir services/auth typecheck
pnpm --dir services/auth build
```

The tests run the built center plus four real shared-client Workers with service
bindings and independent D1 databases. Only mail delivery is replaced locally.
The test registry contains synthetic identities and secrets, and is never
included in the production bundle.

`node scripts/verify-production.mjs` is an explicit live acceptance test. It sends
one owner OTP, reads that message through the authorized Resend API without
logging its contents, signs into all three production apps, and revokes its own
browser session. It requires the existing `RESEND_API_KEY` environment variable.
Use `--pause-after-gu` during staged deployments to validate GU before continuing.
This test is intentionally not part of CI and does not run automatically.

For a local browser smoke test, run `node scripts/browser-fixture.mjs`, then open
`http://localhost:8801/api/auth/login`. The local center uses port 8795 and the
other clients use 8802/8803. Local fixture OTPs are available in the request-OTP
JSON response; production never exposes them.

## Security and operations

- OTP: six digits, eight-minute maximum lifetime, five attempts per generation;
  60-second resend cooldown, at most three sends per rolling 15 minutes and ten
  sends per UTC calendar day. Mail failures also consume a reserved send slot.
- Browser authorization transactions expire after ten minutes. Expired links
  must be restarted from the application.
- Center sessions: 30 days, independent for each browser. App logout revokes the
  center parent and all its client references/codes, without affecting provider
  OAuth, sync credentials or MCP grants.
- Authorization codes: 60 seconds, one use, exact client/callback/PKCE binding.
- Cookie tokens, references and codes are keyed hashes at rest. OTPs use a
  separate keyed hash. No OTP, mail body, full email or credential is logged.
- Internal routes require client credentials even when reached over the public
  domain. Browser POSTs require the exact configured Origin.
- A daily scheduled task removes expired auth records in bounded batches.
- Local OTP exposure requires a loopback auth origin, development/test mode and
  no mail credential. Missing production configuration fails closed.

Remote migrations and deployment use the controlled workflow defined in the
[CF governance rules](../../docs/development/cloudflare-governance.md), with acceptance
and recovery steps in the [integration/release workflow](../../docs/development/integration-release.md).
Do not use an ad hoc `npm run deploy` as the default release path.

The committed `wrangler.jsonc` selects production D1 `codepi-auth` and, under
`env.staging`, `codepi-auth-staging`, both through binding `DB`. Verify the selected
environment and resource ID against the registry before any authorized remote
migration. Migration state is not inferred from this README.

For local-only initialization, run from `services/auth/`:

```sh
npx wrangler d1 migrations apply codepi-auth --local
```

The [original SSO rollout plan](../../docs/superpowers/plans/2026-10-15-kdp-sso-rollout.md)
is historical context, not the current resource inventory or release procedure.
