import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, renameSync, readFileSync, chmodSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { changedFiles, makePlan, main, minimumNodeMajor } from './check.mjs';
import { allApps, packageCommands } from './check-plan.mjs';

const repo = fileURLToPath(new URL('../../', import.meta.url));
const script = fileURLToPath(new URL('./check.mjs', import.meta.url));

function fixture(t) {
  const cwd = mkdtempSync(path.join(tmpdir(), 'kdp-agent-check-'));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  const git = (...args) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: 'pipe' }).trim();
  const write = (name, data = 'fixture\n') => {
    const target = path.join(cwd, name);
    mkdirSync(path.dirname(target), { recursive: true });
    writeFileSync(target, data);
  };
  git('init', '-q');
  git('config', 'user.name', 'Workflow test');
  git('config', 'user.email', 'workflow-test@example.invalid');
  git('config', 'commit.gpgsign', 'false');
  write('README.md');
  write('.gitignore', '.test-bin/\n.agent/\n');
  git('add', '.');
  git('-c', 'core.hooksPath=/dev/null', 'commit', '-qm', 'fixture');
  const commit = () => {
    git('add', '.');
    git('-c', 'core.hooksPath=/dev/null', 'commit', '-qm', 'fixture');
    return git('rev-parse', 'HEAD');
  };
  return { cwd, git, write, commit, base: git('rev-parse', 'HEAD') };
}

function runFixture(f, args, status = 0) {
  const bin = path.join(f.cwd, '.test-bin');
  const marker = path.join(bin, 'invocations.txt');
  f.write('.test-bin/pnpm', `#!/usr/bin/env node
const { appendFileSync } = require('node:fs');
appendFileSync(${JSON.stringify(marker)}, process.argv.slice(2).join(' ') + '\\n');
process.exit(${status});
`);
  chmodSync(path.join(bin, 'pnpm'), 0o755);
  f.write('apps/gzh/change.js');
  const source = `import { main } from ${JSON.stringify(pathToFileURL(script).href)};
process.exitCode = await main(JSON.parse(process.argv[1]), process.argv[2]);`;
  const result = spawnSync(process.execPath, ['--input-type=module', '--eval', source, JSON.stringify(args), f.cwd], {
    encoding: 'utf8', env: { ...process.env, PATH: `${bin}${path.delimiter}${process.env.PATH}` },
  });
  return { ...result, marker };
}

test('workspace uses the required Node runtime and existing package scripts', () => {
  assert.equal(minimumNodeMajor, 24);
  for (const [app, { cwd, commands }] of Object.entries(packageCommands)) {
    const manifest = JSON.parse(readFileSync(path.join(repo, cwd, 'package.json'), 'utf8'));
    assert.ok(Object.hasOwn(allApps.includes(app) ? packageCommands : {}, app));
    for (const command of commands) assert.ok(manifest.scripts[command.name], `${app}: missing ${command.name}`);
  }
});

test('local changes stay isolated while retired paths validate all consumers', () => {
  assert.deepEqual(makePlan(['apps/web/src/pages/index.astro']).apps, ['web']);
  assert.deepEqual(makePlan(['calc/src/lib/mortgage.js']).apps, allApps);
  assert.deepEqual(makePlan(['apps/oura/workers/api/src/index.ts']).apps, ['health']);
});

test('shared and authentication changes preserve their full consumer coverage', () => {
  for (const file of ['services/auth/src/index.ts', 'packages/shared/auth/client.ts', 'packages/shared/styles/tokens.css', 'packages/shared/new-module.ts']) {
    const plan = makePlan([file]);
    assert.deepEqual(plan.apps, allApps);
    assert.ok(plan.checks.some(check => check.argv.includes('packages/shared/auth/client.test.mjs')));
  }
  assert.deepEqual(makePlan(['packages/shared/i18n/config.js']).apps, ['web']);
  assert.deepEqual(makePlan(['packages/shared/mcp/contract.ts']).apps, ['web', 'gu', 'health', 'project', 'me', 'mcp', 'cli']);
});

test('domain changes select their actual MCP and Ops consumers', () => {
  assert.deepEqual(makePlan(['apps/health/workers/api/src/index.ts']).apps, ['health', 'mcp']);
  assert.deepEqual(makePlan(['apps/gu/worker/materials.ts']).apps, ['gu', 'mcp', 'ops']);
  assert.deepEqual(makePlan(['apps/gu/web/src/App.svelte']).apps, ['gu']);
  assert.deepEqual(makePlan(['apps/project/worker/card.ts']).apps, ['project', 'mcp']);
  assert.deepEqual(makePlan(['apps/me/worker/imports.ts']).apps, ['me', 'mcp', 'ops']);
  assert.deepEqual(makePlan(['packages/cli/src/config.mjs']).apps, ['cli']);
});

test('migration, governance and workflow checks remain local and explicit', () => {
  for (const file of ['apps/gu/migrations/0003_x.sql', 'scripts/agent/check-migrations.mjs']) {
    const plan = makePlan([file]);
    assert.ok(plan.checks.some(check => check.argv.includes('scripts/agent/check-migrations.mjs')));
  }
  for (const file of ['apps/web/wrangler.toml', 'scripts/cloudflare/backup.mjs', 'docs/development/cloudflare-governance.md']) {
    const plan = makePlan([file]);
    assert.ok(plan.checks.some(check => check.argv.includes('scripts/cloudflare/validate-governance.mjs')));
  }
  const workflow = makePlan(['.agents/skills/kdp-dev/SKILL.md']);
  assert.deepEqual(workflow.apps, []);
  assert.ok(workflow.checks.some(check => check.argv.includes('scripts/agent/lint.mjs')));
});

test('documentation, CI and unmapped paths have distinct handling', () => {
  assert.deepEqual(makePlan(['docs/architecture/example.md', 'apps/health/AGENTS.md', 'README.md', 'AGENTS.md', 'LICENSE']).checks, []);
  assert.deepEqual(makePlan(['apps/web/src/content/post.md']).apps, ['web']);
  assert.deepEqual(makePlan(['.github/workflows/example.yml']).apps, allApps);
  assert.deepEqual(makePlan(['new-app/index.ts', '.claude/settings.json']).manual, ['new-app/index.ts', '.claude/settings.json']);
});

test('quick mode excludes builds, browser and shared-auth full gates', () => {
  const full = makePlan(['apps/health/apps/web/src/App.svelte']);
  const quick = makePlan(['apps/health/apps/web/src/App.svelte'], 'quick');
  assert.ok(full.checks.some(check => check.argv.includes('build')));
  assert.ok(full.checks.some(check => check.argv.includes('test:browser:built')));
  assert.deepEqual(quick.checks.map(check => check.argv.at(-1)), ['test', 'typecheck']);
  const authQuick = makePlan(['services/auth/src/index.ts'], 'quick');
  assert.ok(!authQuick.checks.some(check => check.argv.includes('packages/shared/auth/client.test.mjs')));
  assert.ok(authQuick.checks.some(check => check.cwd === 'apps/web'));
});

test('all package commands use pnpm from the repository root', () => {
  for (const check of makePlan(['.github/workflows/example.yml']).checks.filter(check => check.argv[0] === 'pnpm')) {
    assert.deepEqual(check.argv.slice(0, 3), ['pnpm', '--filter', packageCommands[Object.keys(packageCommands).find(app => packageCommands[app].cwd === check.cwd)].name]);
  }
});

test('changed files include commits, staging, worktree and untracked paths', t => {
  const f = fixture(t);
  f.write('apps/web/committed.txt');
  f.commit();
  f.write('apps/gu/staged.txt');
  f.git('add', 'apps/gu/staged.txt');
  f.write('README.md', 'modified\n');
  f.write('apps/gzh/untracked file.txt');
  assert.deepEqual(changedFiles(f.cwd, f.base).files, ['README.md', 'apps/gu/staged.txt', 'apps/gzh/untracked file.txt', 'apps/web/committed.txt']);
  assert.ok(!changedFiles(f.cwd).files.includes('apps/web/committed.txt'));
});

test('rename retains both old and new application consumers', t => {
  const f = fixture(t);
  f.write('apps/web/file.txt');
  const base = f.commit();
  mkdirSync(path.join(f.cwd, 'apps/gu'), { recursive: true });
  renameSync(path.join(f.cwd, 'apps/web/file.txt'), path.join(f.cwd, 'apps/gu/file.txt'));
  f.commit();
  const result = changedFiles(f.cwd, base);
  assert.deepEqual(result.files, ['apps/gu/file.txt', 'apps/web/file.txt']);
  assert.deepEqual(makePlan(result.files).apps, ['web', 'gu']);
});

test('comparison uses merge-base and invalid refs fail', t => {
  const f = fixture(t);
  f.git('checkout', '-qb', 'comparison');
  f.write('apps/gu/base-only.txt');
  f.commit();
  f.git('checkout', '--detach', f.base);
  f.write('apps/web/task.txt');
  f.commit();
  assert.deepEqual(changedFiles(f.cwd, 'comparison'), { mergeBase: f.base, files: ['apps/web/task.txt'] });
  assert.throws(() => changedFiles(f.cwd, 'missing-reference'));
});

test('CLI validates exclusive scopes and help', async t => {
  assert.equal(spawnSync(process.execPath, [script, '--help']).status, 0);
  assert.equal(spawnSync(process.execPath, [script, '--base']).status, 1);
  assert.equal(spawnSync(process.execPath, [script, '--unknown']).status, 1);
  assert.equal(spawnSync(process.execPath, [script, '--task', '--base', 'HEAD']).status, 1);
  assert.equal(spawnSync(process.execPath, [script, '--all', '--task']).status, 1);
  assert.equal(spawnSync(process.execPath, [script, '--base', 'HEAD', '--quick']).status, 1);
  assert.equal(await main([], fixture(t).cwd), 0);
});

test('task mode requires a baseline and includes committed full checks', t => {
  const f = fixture(t);
  f.write('apps/web/committed.txt');
  f.commit();
  const missing = runFixture(f, ['--task']);
  assert.equal(missing.status, 1);
  assert.match(missing.stderr, /pnpm task:base/);
  f.write('.agent/task-base', `${f.base}\n`);
  const result = runFixture(f, ['--task', '--run']);
  assert.equal(result.status, 0, result.stderr);
  const invocations = readFileSync(result.marker, 'utf8');
  assert.match(invocations, /--filter web test/);
  assert.match(invocations, /--filter web build/);
});

test('quick preview executes nothing and quick run omits full commands', t => {
  const preview = runFixture(fixture(t), []);
  assert.equal(preview.status, 0, preview.stderr);
  assert.equal(existsSync(preview.marker), false);
  const run = runFixture(fixture(t), ['--run']);
  assert.equal(run.status, 0, run.stderr);
  assert.deepEqual(readFileSync(run.marker, 'utf8').trim().split('\n').sort(), ['--filter publish-desk test', '--filter publish-desk typecheck']);
});

test('all mode selects full checks for every application', t => {
  const f = fixture(t);
  const plan = makePlan(allApps.map(app => `${packageCommands[app].cwd}/`));
  for (const app of allApps) assert.ok(plan.checks.some(check => check.cwd === packageCommands[app].cwd && check.argv.at(-1) === 'test'));
  assert.ok(plan.checks.some(check => check.cwd === 'apps/web' && check.argv.at(-1) === 'build'));
});

test('failed parallel checks are all reported with nonzero exit', t => {
  const result = runFixture(fixture(t), ['--run'], 9);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /FAILED/);
});

test('unmapped changes block execution instead of claiming a pass', t => {
  const f = fixture(t);
  f.write('new-app/file.js');
  const result = runFixture(f, ['--run']);
  assert.equal(result.status, 2);
  assert.equal(existsSync(result.marker), false);
  assert.match(result.stdout, /MANUAL: "new-app\/file.js"/);
  assert.match(result.stderr, /no checks executed/);
});
