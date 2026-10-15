# KDP unified login

`kdp-auth` is the first-party login Worker for Oura, GU, gzh and the personal desk. It accepts no
registration or arbitrary email address. The owner email remains server-side.

The product brand is **kedoupi（codepi）**, defined in `shared/brand.ts`.
`shared/email/otp.ts` supplies the shared HTML/text OTP template for the center
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
the secret registry and never accepts browser-supplied registrations. GU's verified
custom domain `gu.codepi.app` is registered here alongside its original Pages URL,
so adding the domain does not require rotating unrelated clients' credentials.

Applications bind `AUTH` to this Worker and configure their own `AUTH_CLIENT_ID`,
`AUTH_CLIENT_SECRET`, `AUTH_ORIGIN` and `SSO_ENABLED`.

## Validation

```sh
npm ci
npm test
npm run typecheck
npm run build
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

Apply migrations before code deployment:

```sh
npx wrangler d1 migrations apply kdp-auth --remote
npm run deploy
```

Production rollout and recovery are documented in
`../docs/superpowers/plans/2026-10-15-kdp-sso-rollout.md`.
