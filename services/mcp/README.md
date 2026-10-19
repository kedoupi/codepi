# CodePi MCP

One remote MCP entry at `https://mcp.codepi.app/mcp`. Health is the first module;
this is infrastructure, not a fifth product. The official SDK handles stateless
Streamable HTTP. No standalone SSE endpoint or Durable Object is required.

## Boundaries

- This Worker's D1 stores SSO browser sessions and resource-bound MCP grants only.
- `AUTH` uses the shared SSO client with client ID `mcp`; `AUTH_CLIENT_SECRET`
  must match Auth's opt-in `SSO_CLIENT_SECRET_MCP`. Existing SSO clients keep their credentials.
- `HEALTH` binds specifically to `codepi-health-api`'s `HealthMcp` RPC export.
  Public Health HTTP does not expose the RPC. No Health DB or Oura secrets are bound here.
- Tool modules are registered in `src/modules.ts`; only implemented and granted
  modules appear. New product scopes require new explicit consent.
- Queries may persist refresh jobs; their annotations deliberately do not claim
  read-only execution. Saved data returns immediately, with coverage and sync state.

## Local checks

Install once at repository root with `pnpm install --frozen-lockfile`.

```sh
pnpm --dir apps/health/workers/api build
pnpm --dir services/mcp test
pnpm --dir services/mcp typecheck
pnpm --dir services/mcp test:browser:built
```

Tests use the built MCP and Health Workers, real local D1 and named RPC. Only
central SSO is stubbed, and provider network requests fail the tests. The SDK
client test performs initialization and tool calls across stateless HTTP requests.
Browser acceptance uses an isolated Chrome profile, synthetic SSO session and a
real browser form flow, including a callback on a different origin, approve,
deny and revocation. It also checks desktop/mobile layout and escaped client names.
Requests from a browser must use the canonical origin or an exact origin in the
optional comma-separated `MCP_ALLOWED_ORIGINS` runtime variable (for example a
local MCP Inspector). Requests from server clients do not need an Origin header.

For interactive local SSO use Wrangler multi-worker development with MCP, Auth
and Health configs and paired **synthetic local** secrets. Set MCP_ORIGIN to its
loopback URL and configure Auth's local callback for the MCP client. Ordinary
`wrangler dev` does not apply migrations; use `pnpm db:migrate:local` first.
Never copy production databases or credentials into a development worktree.

## Release and cutover

The tracked config reserves the `codepi-mcp` name and deliberately has no invented
D1 ID. The release script resolves or creates exactly this database, writes an
ignored temporary config with its returned ID and migrates before deploying.
The source remains the reviewed commit. Record the actual UUID/version in the
resource registry after the first release; a planned registry row is not readiness.

1. Deploy compatible Auth support and Health's named RPC first.
2. For an explicitly authorized credential initialization/rotation, run
   `node scripts/cloudflare/pair-mcp-secret.mjs --rotate` from the repository root,
   before acquiring the normal release lock. It generates one value, updates only
   Auth's `SSO_CLIENT_SECRET_MCP` and this Worker's `AUTH_CLIENT_SECRET`, and checks
   readiness. Partial failures stop the operation. Never rotate the four existing clients.
3. Follow `docs/development/local-release.md`: hold the production release lock
   and use the clean, merged source matching remote main. Run
   `pnpm --dir services/mcp run deploy <full-source-SHA>` locally.
4. Deploy automatically runs `check:live` with the expected SHA; any failed readiness,
   discovery or anonymous rejection check fails the release after preserving the uploaded
   version ID. To check separately, run
   `MCP_EXPECT_BUILD=<short-SHA> pnpm --dir services/mcp check:live`.
5. Reauthorize and test ChatGPT, Claude and the actual Agent CLI. Test sleep trends,
   month comparisons, missing data, automatic refresh and revocation.
6. Verify Health's old `/mcp`, `/oauth/*` and discovery URLs return 404 JSON.
   Health settings must advertise only this service and its `/connections` page.

An SDK integration test proves the transport works, not that a real ChatGPT,
Claude or CLI account has been configured. The user chose a direct cutover:
the old Health MCP code and grant management API are removed in this release.
Old client grants do not transfer; each client must connect to the new endpoint
and authorize again. Historical Health migrations/tables, saved records and Oura
credentials remain intact. There is no legacy enable/disable switch.

MCP D1 is included in the six-database encrypted backup. Never restore historical
token/revocation state directly into production; invalidate restored credentials and
require reauthorization as described in `docs/development/cloudflare-backup-restore.md`.
The production monitor checks this origin and compares each active Worker version's
`BUILD_SHA` with relevant changes on main, not merely with the latest commit string.
