export const WORKERS = {
  auth: 'codepi-auth', web: 'codepi-www', gu: 'codepi-gu', gzh: 'codepi-gzh',
  project: 'codepi-project', me: 'codepi-me',
  'health-api': 'codepi-health-api', 'health-web': 'codepi-health', mcp: 'codepi-mcp', ops: 'codepi-ops',
};
const all = Object.keys(WORKERS);

// Release scope differs from test scope: the two Health Workers deploy separately.
// Inspect every intervening commit, including changes later reverted.
export function affectedWorkers(files) {
  const affected = new Set();
  const add = services => services.forEach(service => affected.add(service));
  for (const file of files) {
    if (/^scripts\/cloudflare\/(?:backup-core|backup-public-key|monitor-core|mcp-checks|worker-api|release-scope|github-api|github-release-drift|originals-restore|deploy-domain|pair-mcp-secret|traffic-monitor|observability-api|rollback-worker|github-notify)\./.test(file)
      && !/\.test\.mjs$/.test(file)) {
      add(['ops']);
      continue;
    }
    if (/^(docs\/|\.github\/|\.agents\/|\.claude\/|\.cursor\/|scripts\/(?:agent|cloudflare)\/)/.test(file)
      || /(^|\/)(?:README|AGENTS|CLAUDE|GEMINI)\.md$/.test(file)
      || /(^|\/)(?:test|tests|__tests__)\//.test(file)
      || /^(?:apps\/(?:web|gu|gzh|health)|services\/(?:auth|mcp))\/docs\//.test(file)
      || /\.(?:test|spec)\.[cm]?[jt]sx?$/.test(file)
      || /\/scripts\/(?:check[^/]*|verify[^/]*|deploy[^/]*|browser[^/]*|test[^/]*)\.mjs$/.test(file)
      || file === '.gitignore') continue;
    if (file.startsWith('packages/shared/mcp/')) add(['health-api', 'mcp', 'gu', 'project', 'me', 'web']);
    else if (file.startsWith('packages/shared/')) add(all);
    else if (file.startsWith('services/auth/')) add(all);
    else if (file.startsWith('services/mcp/')) add(['mcp']);
    else if (file.startsWith('services/ops/')) add(['ops']);
    else if (file.startsWith('apps/health/apps/web/')) add(['health-web']);
    else if (file.startsWith('apps/health/workers/api/') || file.startsWith('apps/health/migrations/')) add(['health-api', 'mcp']);
    else if (file.startsWith('apps/health/')) add(['health-api', 'health-web', 'mcp']);
    else if (file.startsWith('apps/project/')) add(['project', 'mcp']);
    else if (file.startsWith('apps/me/')) add(['me', 'mcp']);
    else if (file.startsWith('apps/web/')) add(['web', 'mcp']);
    else if (file.startsWith('apps/gu/')) add(['gu', 'mcp']);
    else if (file.startsWith('apps/gzh/')) add(['gzh']);
    else add(all); // Unknown build inputs must not silently bypass monitoring.
  }
  return [...affected];
}

