import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

const root = new URL('../../', import.meta.url);
const workspaceFiles = ['package.json', 'pnpm-lock.yaml', 'pnpm-workspace.yaml', '.npmrc'];

test('every install runs from the workspace root with the pinned pnpm and root lockfile', async () => {
  for (const name of ['deploy-platform', 'validate-sso']) {
    const workflow = await readFile(new URL(`.github/workflows/${name}.yml`, root), 'utf8');
    const installs = [...workflow.matchAll(/- name: Install dependencies\n\s+working-directory: ([^\n]+)\n\s+run: ([^\n]+)/g)];
    assert.ok(installs.length > 0);
    for (const [, cwd, command] of installs) {
      assert.equal(cwd, '${{ github.workspace }}', 'Actions does not expand shell variables in working-directory');
      assert.equal(command, 'pnpm install --frozen-lockfile');
    }
    assert.doesNotMatch(workflow, /pnpm\/action-setup@v4\n\s+with:/, 'packageManager is the single pnpm version source');
    for (const [, lockfile] of workflow.matchAll(/cache-dependency-path: ([^\n]+)/g)) {
      assert.equal(lockfile, 'pnpm-lock.yaml');
      assert.ok(existsSync(new URL(lockfile, root)));
    }
  }
});

test('workspace-only changes trigger validation of all consumers', async () => {
  for (const name of ['deploy-platform', 'validate-sso']) {
    const workflow = await readFile(new URL(`.github/workflows/${name}.yml`, root), 'utf8');
    const triggers = workflow.split('\npermissions:')[0];
    if (name === 'deploy-platform') {
      assert.doesNotMatch(triggers.split('  push:')[1].split('  pull_request:')[0], /paths:/,
        'every main update must start validation');
    }
    for (const file of workspaceFiles) {
      assert.equal(triggers.split(`      - '${file}'`).length - 1, name === 'deploy-platform' ? 1 : 2,
        `${name}: push and pull_request must include ${file}`);
    }
  }
  const workflow = await readFile(new URL('.github/workflows/deploy-platform.yml', root), 'utf8');
  const pattern = workflow.match(/all_trigger='([^']+)'/)?.[1];
  assert.ok(pattern);
  for (const file of workspaceFiles) {
    execFileSync('grep', ['-qE', pattern], { input: `${file}\n` });
  }
});

test('platform Actions cannot deploy or obtain production credentials', async () => {
  const workflow = await readFile(new URL('.github/workflows/deploy-platform.yml', root), 'utf8');
  assert.doesNotMatch(workflow, /deploy-production:|environment: production|CLOUDFLARE_API_TOKEN|secrets\.|wrangler (?:deploy|versions|pages)|deploy:api|migrations apply.*--remote/);
  assert.doesNotMatch(workflow, /inputs\.(?:target|app)|actions: write/);
  assert.equal(existsSync(new URL('.github/workflows/retry-health-deploy.yml', root)), false,
    'old workflow retries could resurrect a cloud deployment');
});

test('validation maps PR consumers and rejects invalid ranges and events', async t => {
  const workflow = await readFile(new URL('.github/workflows/deploy-platform.yml', root), 'utf8');
  const job = workflow.split('\n  affected:')[1].split('\n  #')[0];
  const script = job.split('        run: |\n')[1].split('\n').map(line => line.replace(/^          /, '')).join('\n');
  const cwd = await mkdtemp(path.join(tmpdir(), 'codepi-validation-range-'));
  t.after(() => rm(cwd, { recursive: true, force: true }));
  const git = (...args) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: 'pipe' }).trim();
  git('init', '-b', 'main');
  git('config', 'user.name', 'Validation test');
  git('config', 'user.email', 'test@example.invalid');
  git('config', 'commit.gpgsign', 'false');
  const commit = async file => {
    await mkdir(path.dirname(path.join(cwd, file)), { recursive: true });
    await writeFile(path.join(cwd, file), 'synthetic fixture\n');
    git('add', file);
    git('-c', 'core.hooksPath=/dev/null', 'commit', '-m', 'fixture');
    return git('rev-parse', 'HEAD');
  };
  const base = await commit('README.md');
  await commit('apps/health/change.ts');
  const output = path.join(cwd, 'outputs');
  const run = async (event = 'pull_request', prBase = base) => {
    await writeFile(output, '');
    execFileSync('bash', ['-euo', 'pipefail', '-c', script], {
      cwd, stdio: 'pipe', env: { ...process.env, EVENT: event,
        PR_BASE: prBase, PR_HEAD: git('rev-parse', 'HEAD'), GITHUB_OUTPUT: output },
    });
    return Object.fromEntries((await readFile(output, 'utf8')).trim().split('\n').map(line => line.split('=')));
  };
  const all = { auth: 'yes', web: 'yes', gu: 'yes', gzh: 'yes', health: 'yes', mcp: 'yes' };
  assert.deepEqual(await run(), { auth: 'no', web: 'no', gu: 'no', gzh: 'no', health: 'yes', mcp: 'yes' });
  assert.deepEqual(await run('push'), all);
  assert.deepEqual(await run('workflow_dispatch'), all);
  await assert.rejects(run('unknown'), /unsupported validation event/);
  await assert.rejects(run('pull_request', 'missing-sha'), /could not determine changed paths/);
  await commit('packages/shared/auth/change.ts');
  assert.deepEqual(await run(), all);
});

test('isolated www-build installs cross-product fixture dependencies before Desk tests', async () => {
  const workflow = await readFile(new URL('../../.github/workflows/deploy-platform.yml', import.meta.url), 'utf8');
  const job = workflow.split('\n  www-build:')[1]?.split('\n  gu-build:')[0];
  assert.ok(job, 'www-build must exist');
  const beforeTests = job.split('      - run: npm test')[0];
  assert.match(job, /- run: npm test/);
  assert.match(beforeTests, /uses: pnpm\/action-setup@v4/);
  assert.match(beforeTests, /pnpm install --frozen-lockfile/);
});

test('MCP CI checks the real Health RPC and browser flow without deployment', async () => {
  const workflow = await readFile(new URL('.github/workflows/deploy-platform.yml', root), 'utf8');
  assert.match(workflow, /'services\/mcp\/\*\*'/);
  const build = workflow.split('\n  mcp-build:')[1]?.split('\n  auth-build:')[0];
  assert.ok(build);
  assert.match(build, /pnpm test/);
  assert.match(build, /pnpm typecheck/);
  assert.match(build, /pnpm test:browser:built/);
  assert.doesNotMatch(workflow, /mcp-deploy-production:|pnpm run deploy/);
});
