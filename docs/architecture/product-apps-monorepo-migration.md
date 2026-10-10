# Product apps monorepo migration (gzh / fagao / oura)

> 2026-10-10: standalone apps moved into `kedoupi/kdp.cool` and CF projects rebound to this repo.

## Mapping

| Former GitHub | Monorepo path | CF |
| --- | --- | --- |
| `kedoupi/gzh-preview` (branch workbench MVP) | `gzh-preview/ (redirect-only retire shell)` | Pages project `gzh-preview` (Worker+assets; deploy with wrangler) |
| `kedoupi/publish-desk` (branch `ui-detail-samepage-readgate`) | `fagao/` | Pages project `fagao` |
| `kedoupi/oura-kdp` (`main`) | `oura/` | Pages `oura-kdp` + Worker `oura-kdp-api` |

## CF Git (expected)

All Pages projects: repo `kedoupi/kdp.cool`, branch `main`.

| Project | root_dir | build_command | destination_dir |
| --- | --- | --- | --- |
| fagao | `fagao` | `npm run build` | `dist` |
| oura-kdp | `oura` | `corepack enable && pnpm i && pnpm --filter @oura-kdp/web build` | `apps/web/dist` |
| gzh-preview | n/a (wrangler) | — | deploy via `wrangler deploy` from `gzh-preview/ (redirect-only retire shell)` |

## Secrets

Do not commit. Use existing wrangler secrets / D1 bindings already attached to CF projects (`fagao` D1, `oura_kdp` D1, KV for gzh).

## AdSense

These hostnames are outside the calculator review surface. Apex AdSense content strategy is unchanged (`docs/architecture/adsense-review-hardening-record.md`).


## Git deploy path (Direct Upload projects)

Cloudflare Pages projects created as **Direct Upload** cannot attach a Git `source` via API (`8000069`). Deleting/recreating them in-place is blocked without explicit infra approval (custom domains + D1 risk).

Until the dashboard converts them to Git-connected projects, deploy from this monorepo via:

- GitHub Actions: `.github/workflows/deploy-product-apps.yml` (path-filtered on `main`)
- Secrets required on the GitHub repo: `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`

Optional later: in CF UI, delete+recreate each project as Git-connected to `kedoupi/kdp.cool` with the root/build table above, then re-add custom domains and D1 bindings.


See also: `docs/architecture/wechat-desk-unification.md`.
