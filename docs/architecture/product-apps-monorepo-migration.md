# Product apps monorepo migration (gzh / fagao / oura)

> 2026-10-10: standalone apps moved into `kedoupi/kdp.cool` and CF projects rebound to this repo.

## Mapping

| Former GitHub | Monorepo path | CF |
| --- | --- | --- |
| `kedoupi/gzh-preview` (branch workbench MVP) | `gzh-preview/` | Pages project `gzh-preview` (Worker+assets; deploy with wrangler) |
| `kedoupi/publish-desk` (branch `ui-detail-samepage-readgate`) | `fagao/` | Pages project `fagao` |
| `kedoupi/oura-kdp` (`main`) | `oura/` | Pages `oura-kdp` + Worker `oura-kdp-api` |

## CF Git (expected)

All Pages projects: repo `kedoupi/kdp.cool`, branch `main`.

| Project | root_dir | build_command | destination_dir |
| --- | --- | --- | --- |
| fagao | `fagao` | `npm run build` | `dist` |
| oura-kdp | `oura` | `corepack enable && pnpm i && pnpm --filter @oura-kdp/web build` | `apps/web/dist` |
| gzh-preview | n/a (wrangler) | — | deploy via `wrangler deploy` from `gzh-preview/` |

## Secrets

Do not commit. Use existing wrangler secrets / D1 bindings already attached to CF projects (`fagao` D1, `oura_kdp` D1, KV for gzh).

## AdSense

These hostnames are outside the calculator review surface. Apex AdSense content strategy is unchanged (`docs/architecture/adsense-review-hardening-record.md`).
