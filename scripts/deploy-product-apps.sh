#!/usr/bin/env bash
# Local deploy for monorepo product apps (fagao / oura / gzh-preview).
# Usage:
#   ./scripts/deploy-product-apps.sh            # all three
#   ./scripts/deploy-product-apps.sh fagao      # one app
#   ./scripts/deploy-product-apps.sh oura gzh-preview
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

ENV_FILE="${CLOUDFLARE_ENV_FILE:-$HOME/.config/env/cloudflare/kdp.env}"
if [[ -f "$ENV_FILE" ]]; then
  # shellcheck disable=SC1090
  set -a
  # shellcheck disable=SC1090
  source "$ENV_FILE"
  set +a
fi

if [[ -z "${CLOUDFLARE_API_TOKEN:-}" || -z "${CLOUDFLARE_ACCOUNT_ID:-}" ]]; then
  echo "Missing CLOUDFLARE_API_TOKEN or CLOUDFLARE_ACCOUNT_ID."
  echo "Put them in $ENV_FILE or export them first."
  exit 1
fi

apps=("${@:-all}")
if [[ "${apps[0]}" == "all" ]]; then
  apps=(fagao oura gzh-preview)
fi

deploy_fagao() {
  echo "=== fagao → Pages project fagao ==="
  (cd fagao && npm ci && npm run build)
  npx --yes wrangler@4 pages deploy fagao/dist --project-name=fagao --branch=main
}

deploy_oura() {
  echo "=== oura web → Pages project oura-kdp ==="
  (cd oura && corepack enable >/dev/null 2>&1 || true && pnpm i && pnpm --filter @oura-kdp/web build)
  npx --yes wrangler@4 pages deploy oura/apps/web/dist --project-name=oura-kdp --branch=main
  echo "(oura-kdp-api worker: cd oura/workers/api && npx wrangler deploy — secrets stay in CF)"
}

deploy_gzh() {
  echo "=== gzh-preview → Pages project gzh-preview (static public/) ==="
  (cd gzh-preview && npm ci && npm test)
  npx --yes wrangler@4 pages deploy gzh-preview/public --project-name=gzh-preview --branch=main
}

for app in "${apps[@]}"; do
  case "$app" in
    fagao) deploy_fagao ;;
    oura) deploy_oura ;;
    gzh-preview|gzh) deploy_gzh ;;
    *) echo "Unknown app: $app (use fagao|oura|gzh-preview|all)"; exit 1 ;;
  esac
done

echo "Done."
