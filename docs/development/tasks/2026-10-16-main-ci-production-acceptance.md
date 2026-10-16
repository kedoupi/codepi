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
   missing binding names, never credential values; runtime diagnosis remains open.

## Acceptance in progress

- Public homepage rendered the four retained products without retired tools.
- Health login reached the central Auth page; the browser needed a fresh OTP login.
- Auth and GZH initial deployment jobs succeeded; www and Health remained on older
  deployments. This is not an all-products successful release.
- Staging Auth secrets/Access and GitHub Environment protection verification remain
  separate pre-existing blockers; do not bypass them for this production repair.
