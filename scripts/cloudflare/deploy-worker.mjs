import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { extractWorkerVersion } from './deployment-evidence.mjs';
import { remoteMain } from './release-drift.mjs';

export const DEPLOY_DIRS = {
  auth: 'services/auth', web: 'apps/web', gu: 'apps/gu', gzh: 'apps/gzh',
  'health-web': 'apps/health/apps/web', ops: 'services/ops',
};
const root = fileURLToPath(new URL('../../', import.meta.url));

// Called inside the release coordinator's lock, after build/migrations.
// Health API and MCP retain their specialized deployment scripts.
export function deployWorker(service, sha, { cwd = root, execute = spawnSync } = {}) {
  assert.ok(Object.hasOwn(DEPLOY_DIRS, service), 'expected auth|web|gu|gzh|health-web|ops');
  assert.match(sha ?? '', /^[a-f0-9]{40}$/, 'pass the full merged source SHA');
  const git = args => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  assert.equal(git(['rev-parse', 'HEAD']), sha, 'source does not match HEAD');
  assert.equal(git(['status', '--porcelain']), '', 'release source must be clean');
  assert.equal(remoteMain(cwd), sha, 'release source must equal current remote main');
  const result = execute('pnpm', ['exec', 'wrangler', 'deploy', '--var', `BUILD_SHA:${sha.slice(0, 12)}`], {
    cwd: path.join(cwd, DEPLOY_DIRS[service]), encoding: 'utf8',
    env: { ...process.env, CI: 'true', GITHUB_SHA: sha, WRANGLER_SEND_METRICS: 'false' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  assert.ok(!result.error && result.status === 0, `Worker deployment failed (exit ${result.status ?? 'unavailable'}); smoke not completed`);
  const version = extractWorkerVersion(result.stdout);
  assert.ok(version, 'deployment did not report a Worker version; do not mark the release successful');
  return {
    service, source_sha: sha, version, smoke: 'pending',
    previous_version: '', new_version: version,
    migration_applied: true, secret_changed: true,
    binding_changed: true, external_side_effects: true,
  };
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  try {
    assert.equal(process.argv.length, 4, 'Usage: deploy-worker.mjs <auth|web|gu|gzh|health-web|ops> <full-source-SHA>');
    console.log(JSON.stringify(deployWorker(process.argv[2], process.argv[3])));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
