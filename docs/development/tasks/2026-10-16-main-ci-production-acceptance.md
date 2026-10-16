# Main CI and production acceptance

- Checkout: `<workspace>/Coding/kdp.cool`, branch `main`.
- Starting SHA: `cbbafe81810df00e410837d9378797e644cea94c`.
- Scope: continue the authorized main release, repair verified CI/runtime failures,
  and verify www/Desk, GU, GZH and Health. No publishing or private business writes.
- Initial run: <https://github.com/kedoupi/codepi/actions/runs/38838452036>.

## Confirmed failures and repairs

1. `www-build` did not install Auth's esbuild dependency before `web` integration
   tests built Auth. Install the independent fixture packages in the same job;
   cover the job-local dependency contract with a regression test.
2. Health's normal browser journey passed, but Chrome profile cleanup failed with
   `ENOTEMPTY`. Use bounded filesystem retries after stopping Chrome; persistent
   errors still fail. Normal and SSO browser scenarios remain mandatory.
3. GU production `/` and `/api/auth/login` returned 503 `auth_not_configured` after
   deployment `cdf14750-d926-4de3-b9e1-425cc19396bb`. Dashboard metadata alone did
   not identify the missing runtime binding. Add server-only diagnostics containing
   missing binding names, never credential values. Live logs subsequently confirmed
   missing/empty `AUTH_CLIENT_SECRET` in both new GU and www runtimes. The API's
   masked secret metadata cannot establish whether stored values were lost or
   excluded during deployment; do not claim a Wrangler regression without proof.

## Acceptance in progress

- Public homepage rendered the four retained products without retired tools.
- Health login reached the central Auth page; the browser needed a fresh OTP login.
- Auth and GZH initial deployment jobs succeeded; www and Health remained on older
  deployments. This is not an all-products successful release.
- Staging Auth secrets/Access and GitHub Environment protection verification remain
  separate pre-existing blockers; do not bypass them for this production repair.

## Repair run and recovery (2026-10-16)

- Repair SHA `451fc448b54d3ad700b7b660f32777a9e95fe862` was pushed to main.
- <https://github.com/kedoupi/codepi/actions/runs/38839333321>:
  all build/test jobs passed, including Health's normal and SSO browser journeys;
  GU smoke failed, so Health API/Pages deployments were correctly skipped.
- Separate SSO/GU validation run `38839333211` passed.
- Auth deployed version `0f239b50-7ee0-4171-a55e-ef569072f625`, health 200 JSON.
- GZH deployment `5ff78d7b-6b93-4ac1-9dda-d18ce7fdbf60` uses clean repair SHA.
- New GU `251b2683-5745-4601-88c7-624c8b6c029c` and www
  `baebe9e0-73ce-4e2c-a657-3a0094f5bbb0` both lacked the runtime client secret.
  www's root-only smoke incorrectly passed; actual Desk acceptance caught 503.
- Before rollback, verified old deployment private endpoints returned 401, the
  production D1 IDs were unchanged, and Desk migration `0001_desk_sso.sql` only
  used `CREATE ... IF NOT EXISTS`. No database rollback was performed.
- Cloudflare rollback restored www `3f902dd6-798d-4098-85c3-efd072ff45f8` and
  GU `824ee45a-65e9-4b2a-84ea-03a6f1da3fec`. These remain historical dirty
  deployments, not a clean-main release. New requests to both custom domains
  returned private API 401 and valid same-environment SSO redirects.
- Health remains `e1569fbe-7019-489c-b92b-01ff6d597b13`. Its live anonymous
  API/OAuth-discovery/MCP contract check passed. `/api/me` intentionally returns
  200 with `authenticated:false`; private health-data routes require 401.

## Follow-up verification and blockers

- Added Pages smoke checks for anonymous private API JSON and exact client,
  callback, same-environment Auth and PKCE redirects in all six www/GU/GZH deploy
  jobs. Public homepage 200 alone can no longer report a successful release.
- Local repair validation: 21 selected checks passed, plus a separate normal/SSO
  browser run. Follow-up smoke/workflow/agent tests: 53 passed; governance passed.
  New live smoke passed for www, GU and GZH after rollback.
- Browser: homepage desktop/mobile and retained product links checked; Desk, GU,
  GZH and Health login entrances inspected. Health reached central Auth. OTP help
  timed out; authenticated records, summaries, draft preview, logout, Oura
  connection and MCP authorization were NOT accepted as tested.
- Stop further automatic production deployment until matching Auth client secrets
  for GU and Desk are restored or a coordinated rotation is explicitly agreed.
  Do not reset one side only or expose/replay masked secret values. The follow-up
  smoke changes are kept locally, not pushed, to avoid replacing recovered sites
  with another known-broken deployment.
- Next: restore matching credentials, push the follow-up, rerun controlled release,
  verify provider SHA/version evidence, then complete authenticated browser flows
  with the owner's OTP assistance. No business data was edited or published.
