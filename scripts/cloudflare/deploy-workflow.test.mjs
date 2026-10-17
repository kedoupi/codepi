import assert from 'node:assert/strict';
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
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

test('workspace-only changes trigger validation and deployment of all consumers', async () => {
  for (const name of ['deploy-platform', 'validate-sso']) {
    const workflow = await readFile(new URL(`.github/workflows/${name}.yml`, root), 'utf8');
    const triggers = workflow.split('\npermissions:')[0];
    if (name === 'deploy-platform') {
      assert.doesNotMatch(triggers.split('  push:')[1].split('  pull_request:')[0], /paths:/,
        'every main update must start a run that can pick up a superseded release');
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

test('Health Pages deployment evidence resolves from its nested frontend directory', async () => {
  const workflow = await readFile(new URL('.github/workflows/deploy-platform.yml', root), 'utf8');
  const job = workflow.split('\n  health-pages-deploy-production:')[1];
  const publish = job.split('      - name: publish frontend')[1]?.split('      - name: check deployment')[0];
  const cwd = publish?.match(/working-directory: ([^\n]+)/)?.[1];
  assert.ok(cwd);
  for (const [, script] of publish.matchAll(/node (\S+deployment-evidence\.mjs)/g)) {
    assert.ok(existsSync(new URL(`${cwd}/${script}`, root)), `${cwd}/${script} must exist`);
  }
  assert.doesNotMatch(workflow, /npx wrangler(?:@|\s)/, 'deploy with the workspace-locked Wrangler');
});

test('production releases serialize and include changes from failed or coalesced pushes', async t => {
  const workflow = await readFile(new URL('.github/workflows/deploy-platform.yml', root), 'utf8');
  assert.match(workflow, /\nconcurrency:\n  group: platform-/);
  assert.match(workflow, /cancel-in-progress: \$\{\{ github\.event_name == 'pull_request' \}\}/);
  const job = workflow.split('\n  affected:')[1].split('\n  #')[0];
  const script = job.split('        run: |\n')[1].split('\n').map(line => line.replace(/^          /, '')).join('\n');
  assert.ok(script);
  const cwd = await mkdtemp(path.join(tmpdir(), 'codepi-release-range-'));
  t.after(() => rm(cwd, { recursive: true, force: true }));
  const git = (...args) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: 'pipe' }).trim();
  git('init', '-b', 'main');
  git('config', 'user.name', 'Release test');
  git('config', 'user.email', 'release-test@example.invalid');
  git('config', 'commit.gpgsign', 'false');
  git('remote', 'add', 'origin', cwd);
  const commit = async file => {
    await mkdir(path.dirname(path.join(cwd, file)), { recursive: true });
    await writeFile(path.join(cwd, file), 'synthetic fixture\n');
    git('add', file);
    git('-c', 'core.hooksPath=/dev/null', 'commit', '-m', 'fixture');
    return git('rev-parse', 'HEAD');
  };
  const released = await commit('README.md');
  const pending = await commit('apps/gu/change.ts');
  const latest = await commit('apps/gzh/change.ts');
  const bin = path.join(cwd, 'bin');
  await mkdir(bin);
  await writeFile(path.join(bin, 'gh'), '#!/bin/sh\nprintf "%s\\n" "$TEST_RELEASE_BASE"\n');
  await chmod(path.join(bin, 'gh'), 0o755);
  const output = path.join(cwd, 'outputs');
  const run = async (base, sha = git('rev-parse', 'HEAD'), event = 'push', app = '') => {
    await writeFile(output, '');
    execFileSync('bash', ['-euo', 'pipefail', '-c', script], {
      cwd, stdio: 'pipe',
      env: { ...process.env, PATH: `${bin}${path.delimiter}${process.env.PATH}`,
        EVENT: event, APP: app, SHA: sha, GH_REPO: 'fixture/repo', GITHUB_OUTPUT: output, TEST_RELEASE_BASE: base },
    });
    return Object.fromEntries((await readFile(output, 'utf8')).trim().split('\n').map(line => line.split('=')));
  };
  assert.deepEqual(await run(released), { auth: 'no', web: 'no', gu: 'yes', gzh: 'yes', health: 'no' });
  assert.deepEqual(await run(''), { auth: 'yes', web: 'yes', gu: 'yes', gzh: 'yes', health: 'yes' });
  assert.deepEqual(await run(released, latest, 'workflow_dispatch', 'web'),
    { auth: 'no', web: 'yes', gu: 'yes', gzh: 'yes', health: 'no' },
    'a manual deployment that replaces a queued push must include its unpublished changes');
  await assert.rejects(run(released, pending), /older than main/);
  await commit('docs/release.md');
  await assert.rejects(run(released, latest), /older than main/);
  assert.deepEqual(await run(released), { auth: 'no', web: 'no', gu: 'yes', gzh: 'yes', health: 'no' },
    'the docs-only successor must pick up pending application changes');
  git('rm', 'apps/gu/change.ts', 'apps/gzh/change.ts');
  git('-c', 'core.hooksPath=/dev/null', 'commit', '-m', 'revert partially deployed applications');
  assert.deepEqual(await run(released), { auth: 'no', web: 'no', gu: 'yes', gzh: 'yes', health: 'no' },
    'a revert must redeploy consumers even when the net application diff is empty');
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

test('Pages deployment smoke includes private endpoints and SSO, not just homepage status', async () => {
  const workflow = await readFile(new URL('../../.github/workflows/deploy-platform.yml', import.meta.url), 'utf8');
  for (const app of ['web', 'gu', 'gzh']) for (const target of ['production']) {
    const name = app === 'web' ? 'www' : app;
    const job = workflow.split(`\n  ${name}-deploy-${target}:`)[1]?.split(/\n  [a-z][a-z-]+:/)[0];
    assert.ok(job?.includes(`node ../../scripts/cloudflare/check-pages.mjs ${app} ${target}`));
  }
});

test('GU Workers release checks runtime metadata before probing the new Worker', async () => {
  const workflow = await readFile(new URL('../../.github/workflows/deploy-platform.yml', import.meta.url), 'utf8');
  const job = workflow.split('\n  gu-deploy-production:')[1]?.split(/\n  [a-z][a-z-]+:/)[0];
  assert.ok(job, 'gu-deploy-production must exist');
  const steps = [...job.matchAll(/- name: ([^\n]+)/g)].map(match => match[1]);
  const order = ['deploy', 'verify runtime configuration', 'smoke new Worker (pre-cutover)', 'smoke', 'record deployment evidence'];
  const positions = order.map(name => steps.indexOf(name));
  assert.ok(positions.every(index => index !== -1), `missing exact steps in ${steps.join(', ')}`);
  for (let i = 1; i < positions.length; i += 1) {
    assert.ok(positions[i] > positions[i - 1], `step order must be strictly increasing: ${order.join(' → ')}`);
  }
  const gate = job.split('verify runtime configuration')[1]?.split('- name:')[0];
  assert.match(gate, /id: runtime/);
  assert.match(gate, /deployment-evidence\.mjs resolve-worker/);
  assert.match(gate, /--script codepi-gu --required-secrets AUTH_CLIENT_SECRET,DESK_SUMMARY_TOKEN/);
  assert.match(gate, /echo "origin=\$origin" >> "\$GITHUB_OUTPUT"/);
  assert.doesNotMatch(job, /GU_SECRETS_BOOTSTRAPPED|WORKERS_DEV_SUBDOMAIN|SESSION_SECRET|OTP_PEPPER/,
    'release must not require manual attestations or unused legacy OTP secrets');
  const preCutover = job.split('smoke new Worker (pre-cutover)')[1]?.split('- name:')[0];
  assert.match(preCutover, /WORKER_ORIGIN: \$\{\{ steps\.runtime\.outputs\.origin \}\}/,
    'smoke must use the origin verified by the Cloudflare API');
  assert.match(preCutover, /check-pages\.mjs gu production --origin/, 'pre-cutover smoke must target the new Worker origin, not the domain still on Pages');
});
