# Shared SSO client

Raw TypeScript source imported by the GU, Oura and fagao Worker bundles. This
directory is not a package and introduces no runtime dependency. Keep application
roles, data access and provider OAuth in the individual applications.

`client.ts` owns the browser transaction, PKCE exchange, encrypted local reference,
central session validation and global browser logout. Each application applies
`schema.sql` through its own versioned D1 migration.

Required configuration when `SSO_ENABLED=1`:

- `DB`: the application's existing database with the SSO migration applied.
- `AUTH`: service binding to the central auth Worker.
- `AUTH_ORIGIN`: the central HTTPS origin, without a path or query.
- `AUTH_CLIENT_ID`: `gu`, `oura` or `fagao`.
- `AUTH_CLIENT_SECRET`: a separate secret per application, also registered centrally.

Only the central subject `kdp-owner` is accepted. The application supplies the
existing local owner ID to `finishLogin`; no user ID comes from a browser input.
Session cookies are host-only and HttpOnly. A separate logout-only cookie survives
until the central expiry so a seven-day app session can still revoke the central
browser session after expiring. It is never accepted for authentication. Expired
local references remain available for revocation for up to 30 additional days.
The local database stores a hash of
the cookie and an AES-GCM encrypted central reference bound to client, row and
owner. Rotating the client secret makes existing encrypted references unreadable;
coordinate rotation and require fresh login rather than treating it as a
transparent configuration change.

Call `readSsoSession` for every protected request. `null` means absent, expired or
revoked authentication; an exception means infrastructure or configuration failure.
Never turn the latter into a successful logout or a new anonymous session.

Run the tests with Node 24 after installing the Oura workspace dependencies:

```sh
cd oura
pnpm install --frozen-lockfile
cd ..
node --experimental-strip-types --test shared/auth/client.test.mjs
```

The tests reuse Miniflare from the existing Oura Wrangler dependency and run SQL
against D1. The central auth and each application also have their own integration
tests. See the [protocol](../../docs/superpowers/plans/2026-10-15-kdp-sso-contract.md)
and [rollout checklist](../../docs/superpowers/plans/2026-10-15-kdp-sso-rollout.md).
