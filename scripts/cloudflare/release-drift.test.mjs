import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { affectedWorkers, checkReleaseDrift, compareBuild, remoteMain, WORKERS } from './release-drift.mjs';
import { deployWorker, DEPLOY_DIRS } from './deploy-worker.mjs';

const version = '11111111-1111-4111-8111-111111111111';
const env = { CLOUDFLARE_ACCOUNT_ID: 'acct', CLOUDFLARE_API_TOKEN: 'synthetic-token' };
const ok = result => Response.json({ success: true, result });

async function fixture(t) {
  const cwd = await mkdtemp(path.join(tmpdir(), 'codepi-release-drift-'));
  t.after(() => rm(cwd, { recursive: true, force: true }));
  const git = (...args) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: 'pipe' }).trim();
  git('init', '-b', 'main');
  git('config', 'user.name', 'Release test');
  git('config', 'user.email', 'test@example.invalid');
  git('config', 'commit.gpgsign', 'false');
  git('remote', 'add', 'origin', cwd);
  const commit = async (file, content = 'fixture\n') => {
    await mkdir(path.dirname(path.join(cwd, file)), { recursive: true });
    await writeFile(path.join(cwd, file), content);
    git('add', file);
    git('-c', 'core.hooksPath=/dev/null', 'commit', '-m', 'fixture');
    return git('rev-parse', 'HEAD');
  };
  const base = await commit('README.md');
  return { cwd, git, commit, base };
}

test('release scope separates Health Workers, includes shared dependencies, and preserves content Markdown', () => {
  assert.deepEqual(affectedWorkers(['docs/architecture/a.md', '.github/workflows/test.yml', 'services/mcp/README.md',
    'apps/gu/test/example.mjs', 'apps/health/shared/date.test.ts', 'services/mcp/scripts/check-live.mjs',
    'services/mcp/scripts/deploy.mjs']), []);
  assert.deepEqual(affectedWorkers(['apps/health/apps/web/src/main.ts']), ['health-web']);
  assert.deepEqual(affectedWorkers(['apps/health/workers/api/src/app.ts']), ['health-api', 'mcp']);
  assert.deepEqual(affectedWorkers(['apps/health/shared/date.ts']), ['health-api', 'health-web', 'mcp']);
  assert.deepEqual(affectedWorkers(['packages/shared/mcp/contract.ts']), ['health-api', 'mcp', 'gu', 'project', 'me']);
  assert.deepEqual(affectedWorkers(['apps/project/worker/index.ts']), ['project']);
  assert.deepEqual(affectedWorkers(['apps/me/migrations/0001_init.sql']), ['me']);
  assert.deepEqual(affectedWorkers(['apps/web/src/pages/about.md']), ['web']);
  assert.deepEqual(affectedWorkers(['apps/web/src/pages/docs/example.md']), ['web']);
  assert.deepEqual(affectedWorkers(['services/auth/scripts/build.mjs']).sort(), Object.keys(WORKERS).sort());
  for (const file of ['pnpm-lock.yaml', 'package.json', 'pnpm-workspace.yaml', '.npmrc',
    'packages/shared/auth/client.ts', 'services/auth/src/app.ts', 'new-build-input']) {
    assert.deepEqual(affectedWorkers([file]).sort(), Object.keys(WORKERS).sort(), file);
  }
});

test('merge-only changes are included even when neither parent branch touched that service', async t => {
  const f = await fixture(t);
  f.git('checkout', '-b', 'side');
  await f.commit('apps/gu/worker/app.ts');
  f.git('checkout', 'main');
  await f.commit('docs/release.md');
  f.git('merge', '--no-ff', '--no-commit', 'side');
  const main = await f.commit('apps/health/workers/api/src/merge-only.ts');
  assert.equal(compareBuild('health-api', f.base, main, f.cwd).current, false);
  assert.equal(compareBuild('mcp', f.base, main, f.cwd).current, false);
  assert.equal(compareBuild('health-web', f.base, main, f.cwd).current, true);
});

test('real history accepts docs-only gaps and catches multi-commit, reverted and deleted code', async t => {
  const f = await fixture(t);
  const docs = await f.commit('docs/release.md');
  assert.equal(remoteMain(f.cwd), docs);
  assert.equal(compareBuild('mcp', f.base.slice(0, 12), docs, f.cwd).current, true);
  const changed = await f.commit('apps/gu/worker/app.ts', 'new\n');
  await f.commit('apps/gu/worker/app.ts', 'previous\n');
  await rm(path.join(f.cwd, 'apps/gu/worker/app.ts'));
  f.git('add', '-u');
  f.git('-c', 'core.hooksPath=/dev/null', 'commit', '-m', 'remove');
  const main = await f.commit('docs/release.md', 'updated\n');
  assert.equal(compareBuild('gu', f.base, main, f.cwd).current, false);
  assert.equal(compareBuild('mcp', f.base, main, f.cwd).current, true);
  assert.equal(compareBuild('gu', changed, main, f.cwd).current, false);
  assert.equal(compareBuild('gu', main, main, f.cwd).current, true);
});

test('missing, malformed, unknown and non-ancestor source SHAs fail closed', async t => {
  const f = await fixture(t);
  for (const value of [undefined, 'local', '--all', 'PRIVATE TOKEN', 'a'.repeat(40)]) {
    assert.throws(() => compareBuild('mcp', value, f.base, f.cwd));
  }
  f.git('checkout', '-b', 'side');
  const side = await f.commit('services/mcp/src/change.ts');
  f.git('checkout', 'main');
  const main = await f.commit('docs/next.md');
  assert.throws(() => compareBuild('mcp', side, main, f.cwd), /history could not be verified/);
});

function workerRequests(build, override = () => undefined) {
  return async url => {
    const pathname = new URL(url).pathname;
    const custom = override(pathname);
    if (custom) return custom;
    if (pathname.endsWith('/deployments')) return ok({ deployments: [{ versions: [{ version_id: version, percentage: 100 }] }] });
    if (pathname.endsWith('/versions/' + version)) return ok({
      resources: { bindings: [{ type: 'plain_text', name: 'BUILD_SHA', text: build }] },
    });
    throw new Error('unexpected request');
  };
}

test('drift checks every declared Worker and never silently skips unknown builds', async t => {
  const f = await fixture(t);
  const main = await f.commit('apps/health/apps/web/src/main.ts');
  const results = await checkReleaseDrift({ env, cwd: f.cwd, request: workerRequests(f.base) });
  assert.equal(results.length, Object.keys(WORKERS).length);
  assert.equal(results.filter(r => !r.ok).length, 1);
  assert.match(results.find(r => !r.ok).name, /codepi-health active/);
  assert.match(results.find(r => !r.ok).detail, /unreleased changes/);
  const missing = await checkReleaseDrift({ env, cwd: f.cwd, request: workerRequests(undefined) });
  assert.equal(missing.filter(r => !r.ok).length, Object.keys(WORKERS).length);
  const current = await checkReleaseDrift({ env, cwd: f.cwd, request: workerRequests(main.slice(0, 12)) });
  assert.ok(current.every(r => r.ok && r.main === main.slice(0, 12)));
});

test('split traffic, provider failures, missing credentials and shallow history cannot turn green', async t => {
  const f = await fixture(t);
  const split = await checkReleaseDrift({ env, cwd: f.cwd, request: workerRequests(f.base, pathname =>
    pathname.endsWith('/deployments') ? ok({ deployments: [{ versions: [
      { version_id: version, percentage: 50 }, { version_id: version, percentage: 50 },
    ] }] }) : undefined) });
  assert.ok(split.every(r => !r.ok && /100%/.test(r.detail)));
  const errors = await checkReleaseDrift({ env, cwd: f.cwd, request: async () =>
    Response.json({ success: false, errors: [{ message: 'PRIVATE CREDENTIALS' }] }, { status: 403 }) });
  assert.ok(errors.every(r => !r.ok && /HTTP 403/.test(r.detail) && !r.detail.includes('PRIVATE')));
  assert.equal((await checkReleaseDrift({ env: {} }))[0].skipped !== undefined, true);
  assert.equal((await checkReleaseDrift({ env: {}, requireVersions: true }))[0].ok, false);
  const unknown = await checkReleaseDrift({ env, cwd: f.cwd, request: workerRequests('b'.repeat(40)) });
  assert.ok(unknown.every(r => !r.ok && /history could not be verified/.test(r.detail)));
});

test('SHA-stamped deploy targets only the five simple Workers and requires exact clean remote main', async t => {
  const f = await fixture(t);
  const calls = [];
  const execute = (command, args, options) => {
    calls.push({ command, args, options });
    return { status: 0, stdout: `Current Version ID: ${version}` };
  };
  for (const [service, dir] of Object.entries(DEPLOY_DIRS)) {
    const result = deployWorker(service, f.base, { cwd: f.cwd, execute });
    assert.equal(result.version, version);
    assert.equal(result.smoke, 'pending');
    const call = calls.at(-1);
    assert.equal(call.options.cwd, path.join(f.cwd, dir));
    assert.deepEqual(call.args, ['exec', 'wrangler', 'deploy', '--var', `BUILD_SHA:${f.base.slice(0, 12)}`]);
    assert.equal(call.options.env.GITHUB_SHA, f.base);
  }
  assert.throws(() => deployWorker('health-api', f.base, { cwd: f.cwd, execute }), /expected/);
  await writeFile(path.join(f.cwd, 'dirty'), 'unreviewed');
  assert.throws(() => deployWorker('auth', f.base, { cwd: f.cwd, execute }), /clean/);
  await rm(path.join(f.cwd, 'dirty'));
  f.git('checkout', '-b', 'unmerged');
  const side = await f.commit('services/mcp/src/change.ts');
  assert.throws(() => deployWorker('auth', side, { cwd: f.cwd, execute }), /remote main/);
  assert.equal(calls.length, Object.keys(DEPLOY_DIRS).length);
});
