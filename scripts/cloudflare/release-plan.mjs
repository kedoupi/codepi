import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WORKERS, affectedWorkers } from './release-scope.mjs';
import { MIGRATION_DIRS } from '../agent/check-migrations.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
const order = ['auth', 'web', 'gu', 'health-api', 'project', 'me', 'rhythm', 'mcp', 'health-web', 'ops'];
const migrationDirs = {
  auth: 'services/auth', web: 'apps/web', gu: 'apps/gu', project: 'apps/project', me: 'apps/me',
  mcp: 'services/mcp', 'health-api': 'apps/health', rhythm: 'apps/rhythm',
};
const buildDirs = { auth: 'services/auth', web: 'apps/web', gu: 'apps/gu', project: 'apps/project', me: 'apps/me', rhythm: 'apps/rhythm', 'health-api': 'apps/health/workers/api', mcp: 'services/mcp', 'health-web': 'apps/health/apps/web', ops: 'services/ops' };

function git(cwd, args) {
  return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

export function releasePlan(files, sha = null) {
  const services = order.filter(service => affectedWorkers(files).includes(service));
  return {
    read_only: true,
    source_sha: sha,
    services,
    steps: services.map((service, index) => ({
      order: index + 1,
      service,
      worker: WORKERS[service],
      directory: buildDirs[service],
      migration: migrationDirs[service] ? `Review and apply only new migrations in ${Object.keys(MIGRATION_DIRS).filter(directory => MIGRATION_DIRS[directory] === migrationDirs[service]).join(', ')}` : null,
      dependency: service === 'mcp' && services.includes('web') ? 'Publish and accept Web/Blog before MCP.' : null,
    })),
    required: [
      'Run the affected full checks on the merged source.',
      'Confirm clean source, exact remote main, release lock and authorized credentials.',
      'Publish each service in order; stop after any migration, deployment or smoke failure.',
      'Complete service-specific production acceptance and the single release observation.',
    ],
  };
}

export function main(args = process.argv.slice(2), cwd = root) {
  let base;
  for (let index = 0; index < args.length; index++) {
    if (args[index] === '--') continue;
    if (args[index] === '--base' && args[index + 1]) base = args[++index];
    else throw new Error('Usage: pnpm release:plan -- --base <last-successful-source-SHA>');
  }
  assert.ok(base, 'Pass --base with the last successful production source SHA.');
  const commit = git(cwd, ['rev-parse', '--verify', '--end-of-options', `${base}^{commit}`]);
  const sha = git(cwd, ['rev-parse', 'HEAD']);
  git(cwd, ['merge-base', '--is-ancestor', commit, sha]);
  const files = git(cwd, ['log', '--format=', '--name-only', '-z', '--no-renames', '--diff-merges=first-parent', `${commit}..${sha}`, '--']).split('\0').filter(Boolean);
  console.log(JSON.stringify(releasePlan(files, sha), null, 2));
  return 0;
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  try { process.exitCode = main(); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
