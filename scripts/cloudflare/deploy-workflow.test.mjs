import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';

const root = new URL('../../', import.meta.url);
const workspaceFiles = ['package.json', 'pnpm-lock.yaml', 'pnpm-workspace.yaml', '.npmrc'];

test('all workflow actions are pinned to immutable official commits', async () => {
  for (const name of ['d1-backup', 'deploy-platform', 'production-monitor']) {
    const workflow = await readFile(new URL(`.github/workflows/${name}.yml`, root), 'utf8');
    const uses = workflow.split('\n').filter(line => /\buses:/.test(line));
    assert.ok(uses.length > 0, `${name}: expected Actions uses`);
    for (const line of uses) assert.match(line, /uses: [^@]+@[0-9a-f]{40} # v(?:4|6|7)$/);
  }
  assert.equal(existsSync(new URL('.github/workflows/validate-sso.yml', root)), false);
});

test('CI uses the shared check plan and preserves browser artifacts', async () => {
  const workflow = await readFile(new URL('.github/workflows/deploy-platform.yml', root), 'utf8');
  assert.match(workflow, /ci-plan\.mjs --base "\$PR_BASE"/);
  assert.match(workflow, /include: \$\{\{ fromJSON\(needs\.plan\.outputs\.jobs\) \}\}/);
  assert.match(workflow, /const commands = JSON\.parse\(process\.env\.COMMANDS\)/);
  for (const variable of ['HEALTH_BROWSER_ARTIFACTS', 'MCP_BROWSER_ARTIFACTS', 'PROJECT_SMOKE_ARTIFACTS', 'ME_SMOKE_ARTIFACTS', 'DESK_BROWSER_ARTIFACTS']) {
    assert.match(workflow, new RegExp(variable));
  }
  assert.match(workflow, /if: \$\{\{ always\(\)/);
  assert.doesNotMatch(workflow, /all_trigger=/);
});

test('every install uses the pinned workspace lockfile', async () => {
  const workflow = await readFile(new URL('.github/workflows/deploy-platform.yml', root), 'utf8');
  assert.ok(workflow.includes('run: pnpm install --frozen-lockfile'));
  for (const [, lockfile] of workflow.matchAll(/cache-dependency-path: ([^\n]+)/g)) {
    assert.equal(lockfile, 'pnpm-lock.yaml');
    assert.ok(existsSync(new URL(lockfile, root)));
  }
});

test('workspace changes trigger validation and PR concurrency is isolated', async () => {
  const workflow = await readFile(new URL('.github/workflows/deploy-platform.yml', root), 'utf8');
  const triggers = workflow.split('\npermissions:')[0];
  assert.doesNotMatch(triggers.split('  push:')[1].split('  pull_request:')[0], /paths:/);
  for (const file of [...workspaceFiles, 'AGENTS.md', '.github/workflows/deploy-platform.yml']) {
    assert.ok(triggers.includes(`      - '${file}'`), file);
  }
  assert.match(workflow, /group: platform-\$\{\{ github\.event\.pull_request\.number \|\| github\.ref \}\}/);
});

test('platform Actions cannot deploy or obtain production credentials', async () => {
  const workflow = await readFile(new URL('.github/workflows/deploy-platform.yml', root), 'utf8');
  assert.doesNotMatch(workflow, /environment: production|CLOUDFLARE_API_TOKEN|secrets\.|wrangler (?:deploy|versions|pages)|deploy:api|migrations apply.*--remote/);
  assert.equal(existsSync(new URL('.github/workflows/retry-health-deploy.yml', root)), false);
});

test('CI plan executes PR scope without uncommitted files leaking in', () => {
  const result = spawnSync(process.execPath, ['scripts/agent/ci-plan.mjs', '--base', 'HEAD'], {
    cwd: new URL('../../', import.meta.url), encoding: 'utf8',
  });
  assert.equal(result.status, 0, result.stderr);
  const plan = JSON.parse(result.stdout);
  assert.deepEqual(plan.jobs, []);
  assert.deepEqual(plan.manual, []);
});

test('CI push plans use the pushed source rather than unrelated worktree changes', () => {
  const result = spawnSync(process.execPath, ['scripts/agent/ci-plan.mjs'], {
    cwd: new URL('../../', import.meta.url), encoding: 'utf8', env: { ...process.env, GITHUB_EVENT_NAME: 'push', GITHUB_SHA: 'HEAD' },
  });
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout).jobs, []);
});

test('manual fallback monitoring remains strict and read-only', async () => {
  const workflow = await readFile(new URL('.github/workflows/production-monitor.yml', root), 'utf8');
  assert.match(workflow, /fetch-depth: 0/);
  assert.match(workflow, /production-monitor\.mjs --require-d1 --require-versions/);
  assert.doesNotMatch(workflow, /^  (?:schedule|push):/m);
  assert.match(workflow, /^  workflow_dispatch:/m);
  assert.doesNotMatch(workflow, /continue-on-error|contents: write/);
});
