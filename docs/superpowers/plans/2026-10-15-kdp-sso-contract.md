# KDP SSO implementation contract

Approved scope: fixed GU owner email, GU/Oura/fagao, central 30-day session,
browser-wide logout, independent Oura provider and MCP grants.

## Shared client (owned by primary agent)

`shared/auth/client.ts` exports:

- `SsoEnv`: `DB: D1Database`, `AUTH?: Fetcher`, `AUTH_ORIGIN?: string`,
  `AUTH_CLIENT_ID?: string`, `AUTH_CLIENT_SECRET?: string`, `SSO_ENABLED?: string`.
- `SsoError extends Error`: `code: string`, `status: number`.
- `ssoEnabled(env): boolean` (only `SSO_ENABLED === "1"`).
- `beginLogin(request, env): Promise<Response>`: reads local `return` URL param.
- `finishLogin(request, env, { userId, ttlSeconds }): Promise<Response>`:
  verifies transaction and central code, stores shared local session, redirects.
  All clients accept central subject `kdp-owner` only.
- `readSsoSession(request, env): Promise<null | { id, userId, subject, expiresAt }>`:
  validates local and central session on each call, throws 503 on infrastructure
  failure, returns null only for absent/expired/revoked session.
- `logoutSso(request, env): Promise<Response>`: POST only, same origin,
  centrally revokes current browser session, clears client cookie, returns JSON.
- `ssoErrorResponse(error): Response`: typed safe error or generic 503.

Shared SQL schema in `shared/auth/schema.sql`. Every app adds a new migration
with identical statements (own migration directory, no changes to old tables).
Cookies are `__Host-kdp_<clientId>_session` / `_transaction` on HTTPS, without
`__Host-` on localhost. SameSite=Lax; never parent-domain cookies.
A separate `_logout` cookie retains only the revocation handle until central
expiry. It is never accepted for authentication. Expired local rows are retained
for up to 30 additional days so shorter app sessions can still revoke the parent.

SSO clients: `gu`, `oura`, `fagao`. Central env:
`OWNER_EMAIL` (secret), `OTP_PEPPER`, `SESSION_SECRET`, `SSO_CLIENTS` (JSON secret).
SSO_CLIENTS shape:
`{ "oura": { "secret": "...", "name": "Oura", "redirectUris":
["https://oura.kdp.cool/api/auth/callback"] }, ... }`.

## Auth server (owned by auth agent)

- GET `/authorize`: query `client_id`, `redirect_uri`, `state`,
  `code_challenge`, `code_challenge_method=S256`. Exact registered callback.
  Central session valid -> issue code and redirect. Otherwise login UI.
- OTP endpoints under `/api/auth/request-otp`, `/api/auth/verify-otp`;
  application transaction bound to browser; fixed recipient; no arbitrary email.
- On successful OTP, create 30-day central session then complete `/authorize`.
- `GET /api/health`: no secrets, status/configuration flags.

Internal calls use `env.AUTH.fetch("https://auth.internal/internal/...")`.
All three endpoints POST JSON and require Basic base64(clientId:clientSecret).
Public access must never bypass client credential checks.

- `/internal/exchange`: body `{code, redirect_uri, code_verifier}`.
  Atomically consume 60-second code, mint client-bound random session_ref.
  Response `{subject:"kdp-owner", session_ref:string, expires_at:number}` (ms).
- `/internal/session`: body `{session_ref}`.
  Response `{active:boolean, subject?:string, expires_at?:number}`.
  Ref must belong to authenticated client. Revalidate parent central session.
- `/internal/logout`: body `{session_ref}`.
  Revoke parent central session, all its refs/codes; return `{ok:true}`.
  Missing/already revoked ref returns success; wrong client must not revoke.

Do not expose raw central session ID/cookie in client responses. Hash codes,
cookie tokens, session refs at rest. Never log OTP, credentials or provider bodies.
All sensitive responses no-store, same-origin checks for cookie-backed POSTs.
Only loopback development/test can return dev_otp with no mail key.

## Client adapter responsibilities

- Add login/callback/logout routes, fail-closed when SSO enabled (no old OTP/OAuth
  website sessions accepted); compatibility flag off only for staged rollout.
- Oura maps subject to existing PERSONAL_OWNER_ID and adds kind `sso`.
  Oura provider callback requires same initiating authenticated user/session.
  Existing Oura ID, encrypted tokens, health archives and MCP grants preserved.
- Fagao maps to existing `acc_owner_kdp`, retains roles/data and only owner login.
- GU maps to `gu-owner`, preserves dashboard ingestion credentials and data.
- Frontend periodic/focus check (30s) clears private memory on confirmed 401 or
  authenticated:false, preserves error/retry state on service outages.
- Local TTL: Oura 30d; GU/fagao 7d, capped by central expiry.
- New production configuration stays disabled until auth domain, client secrets,
  bindings and acceptance checks pass. Do not deploy from subagents.
