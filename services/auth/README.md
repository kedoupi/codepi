# KDP unified login

`codepi-auth` is the first-party login Worker for Health, GU, GZH, the personal desk and CodePi MCP. It accepts no
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
both sources. Keep synthetic local callbacks separate from production; staging is retired. Current bindings
and dated verification evidence are in the [CF resource registry](../../docs/development/cloudflare-resource-registry.md).

Optional per-client secrets `SSO_CLIENT_SECRET_GU`, `SSO_CLIENT_SECRET_OURA`,
`SSO_CLIENT_SECRET_GZH`, `SSO_CLIENT_SECRET_DESK` and `SSO_CLIENT_SECRET_MCP` override only the matching
registered client's secret. An absent override retains `SSO_CLIENTS.secret` for
existing clients; an empty or short override fails closed. Callback registration
still comes from the registry and `SSO_EXTRA_REDIRECT_URIS`.

MCP also has an opt-in registration: when `SSO_CLIENT_SECRET_MCP` is present and
the JSON registry has no `mcp` entry, the center adds that client with the exact
`https://mcp.codepi.app/api/auth/callback` URI. Extra callbacks are then validated
normally. Pair its secret with `codepi-mcp/AUTH_CLIENT_SECRET` using the dedicated
procedure in [local release](../../docs/development/local-release.md#mcp-secret-配对与修复);
do not rewrite `SSO_CLIENTS` or rotate the other clients to add MCP.

Use these bindings to recover or rotate one client without reading or rewriting
other credentials in the write-only JSON registry. Set the same new value on the
center and that client's `AUTH_CLIENT_SECRET` through the authorized pairing/release
procedure. Keep the value out of logs and files. Existing website sessions for
that app need a fresh login because their stored references use the old key.
This does not rotate the center session, OTP or provider credentials, and does not
revoke existing MCP bearer grants.

Health's SSO logic and `AUTH_CLIENT_SECRET` are consumed by `codepi-health-api`;
its frontend Worker only forwards API requests. To rotate client ID `oura`,
update the API Worker's binding, not the frontend. All products now use Workers;
deployment follows the local release procedure.

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

The Auth test harness runs the built center plus four synthetic shared-client Workers with service
bindings and independent D1 databases. Only mail delivery is replaced locally.
The test registry contains synthetic identities and secrets, and is never
included in the production bundle. MCP opt-in registration is tested here;
the MCP service's own checks cover its protocol, RPC and browser authorization flow.

`scripts/verify-production.mjs` is a legacy live acceptance script, not the
current release entry. It sends an owner OTP and reads mail through Resend;
it still includes the retired `codepi-gu.pages.dev` target and does not cover
Desk/MCP. Correct its targets and obtain the required live-mail authorization
before using it. Current probes and acceptance steps are in
[local release](../../docs/development/local-release.md); ordinary tests do not send mail.

For a local browser smoke test, run `node scripts/browser-fixture.mjs`, then open
`http://localhost:8801/api/auth/login`. The local center uses port 8795 and the
other clients use 8802/8803/8804. Local fixture OTPs are available in the request-OTP
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

The committed `wrangler.jsonc` selects production D1 `codepi-auth`;
the retired `env.staging` (`codepi-auth-staging`) was removed on 2026-10-18. Verify the selected
environment and resource ID against the registry before any authorized remote
migration. Migration state is not inferred from this README.

For local-only initialization, run from `services/auth/`:

```sh
pnpm exec wrangler d1 migrations apply codepi-auth --local
```

The [original SSO rollout plan](../../docs/superpowers/plans/2026-10-15-kdp-sso-rollout.md)
is historical context, not the current resource inventory or release procedure.
