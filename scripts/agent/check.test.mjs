import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, renameSync, readFileSync, chmodSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { changedFiles, makePlan, staticApps, privateApps } from './check.mjs';

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
  // Commits exist only in this disposable synthetic repository.
  const commit = () => {
    git('add', '.');
    git('-c', 'core.hooksPath=/dev/null', 'commit', '-qm', 'fixture');
    return git('rev-parse', 'HEAD');
  };
  write('README.md');
  write('.gitignore', '.test-bin/\n');
  const base = commit();
  return { cwd, git, write, commit, base };
}

test('single static app stays isolated; calculator includes math tests', () => {
  assert.deepEqual(makePlan(['web/src/pages/index.astro']).apps, ['web']);
  assert.deepEqual(makePlan(['calc/src/lib/mortgage.js']).checks, [
    { cwd: 'calc', argv: ['npm', 'test'] },
    { cwd: 'calc', argv: ['npm', 'run', 'build'] },
  ]);
});

test('static shared code covers all six consumers', () => {
  const plan = makePlan(['shared/lib/url-state.js', 'shared/layouts/BaseLayout.astro']);
  assert.deepEqual(plan.apps, staticApps);
  assert.equal(plan.checks.filter(check => check.argv.join(' ') === 'npm test').length, 1);
});

test('SSO changes cover center, all three clients and shared client tests', () => {
  for (const file of ['auth/src/index.ts', 'shared/auth/client.ts', 'shared/auth/schema.sql']) {
    const plan = makePlan([file]);
    assert.deepEqual(plan.apps, privateApps);
    assert.ok(plan.checks.some(check => check.argv.includes('shared/auth/client.test.mjs')));
  }
});

test('brand, styles, email and new shared modules fall back to all apps', () => {
  for (const file of ['shared/styles/tokens.css', 'shared/brand.ts', 'shared/email/otp.ts', 'shared/new-module.ts']) {
    assert.deepEqual(makePlan([file]).apps, [...staticApps, ...privateApps]);
  }
});

test('Health keeps both browser modes via its existing runner', () => {
  assert.deepEqual(makePlan(['oura/apps/web/src/App.svelte']).checks.map(check => check.argv), [
    ['pnpm', 'test'], ['pnpm', 'typecheck'], ['pnpm', 'build'], ['pnpm', 'test:browser:built'],
  ]);
});

test('GU deployment check is explicitly local configuration only', () => {
  const checks = makePlan(['gu/worker/index.ts']).checks;
  assert.ok(checks.some(check => check.argv.includes('test:scripts')));
  assert.deepEqual(checks.at(-1).argv, ['npm', 'run', 'check:deploy', '--', '--mode', 'config']);
});

test('docs skip application builds but product Markdown remains covered', () => {
  assert.deepEqual(makePlan(['docs/architecture/example.md', 'oura/AGENTS.md', 'README.md']).checks, []);
  assert.deepEqual(makePlan(['web/src/content/post.md']).apps, ['web']);
  assert.deepEqual(makePlan(['.agents/skills/kdp-dev/SKILL.md']).checks, [
    { cwd: '.', argv: ['node', '--test', 'scripts/agent/check.test.mjs'] },
  ]);
});

test('CI changes select all applications; unknown paths need manual handling', () => {
  assert.deepEqual(makePlan(['.github/workflows/example.yml']).apps, [...staticApps, ...privateApps]);
  assert.deepEqual(makePlan(['new-app/index.ts', '.gitignore']).manual, ['new-app/index.ts', '.gitignore']);
});

test('tool entry points select workflow checks without building unrelated apps', () => {
  for (const file of [
    'CLAUDE.md', 'GEMINI.md', '.github/copilot-instructions.md',
    '.claude/skills/kdp-dev/SKILL.md', '.cursor/rules/project.mdc',
  ]) {
    const plan = makePlan([file]);
    assert.deepEqual(plan.apps, [], file);
    assert.deepEqual(plan.manual, [], file);
    assert.deepEqual(plan.checks, [
      { cwd: '.', argv: ['node', '--test', 'scripts/agent/check.test.mjs'] },
    ], file);
  }
});

test('tool runtime settings are not silently classified as instruction-only changes', () => {
  for (const file of ['.claude/settings.json', '.cursor/mcp.json', '.gemini/settings.json']) {
    assert.deepEqual(makePlan([file]).manual, [file]);
  }
});

test('every selected npm/pnpm command exists in the current app manifest', () => {
  const { checks } = makePlan(['.github/workflows/example.yml']);
  for (const { cwd, argv } of checks) {
    if (!['npm', 'pnpm'].includes(argv[0])) continue;
    const manifest = JSON.parse(readFileSync(path.join(repo, cwd, 'package.json'), 'utf8'));
    const name = argv[1] === 'run' ? argv[2] : argv[1];
    assert.ok(manifest.scripts[name], `${cwd}: missing ${name}`);
    assert.ok(!['deploy', 'deploy:api', 'deploy:web', 'db:migrate:remote', 'check:api', 'check:branding'].includes(name));
  }
});

test('task base includes committed, staged, unstaged and untracked files without ignored files', t => {
  const f = fixture(t);
  f.write('.gitignore', '*.secret\n');
  f.write('web/committed.txt');
  f.commit();
  f.write('gu/staged.txt');
  f.git('add', 'gu/staged.txt');
  f.write('README.md', 'modified\n');
  f.write('fagao/untracked file.txt');
  f.write('fixture.secret');
  assert.deepEqual(changedFiles(f.cwd, f.base).files, [
    '.gitignore', 'README.md', 'fagao/untracked file.txt', 'gu/staged.txt', 'web/committed.txt',
  ]);
  assert.ok(!changedFiles(f.cwd).files.includes('web/committed.txt'));
});

test('cross-app rename retains both old and new consumers', t => {
  const f = fixture(t);
  f.write('web/file.txt');
  const base = f.commit();
  mkdirSync(path.join(f.cwd, 'gu'), { recursive: true });
  renameSync(path.join(f.cwd, 'web/file.txt'), path.join(f.cwd, 'gu/file.txt'));
  f.commit();
  const result = changedFiles(f.cwd, base);
  assert.deepEqual(result.files, ['gu/file.txt', 'web/file.txt']);
  assert.deepEqual(makePlan(result.files).apps, ['web', 'gu']);
});

test('staged changes are retained even when working copy restores HEAD content', t => {
  const f = fixture(t);
  f.write('web/file.txt', 'original\n');
  f.commit();
  f.write('web/file.txt', 'staged\n');
  f.git('add', '.');
  f.write('web/file.txt', 'original\n');
  assert.deepEqual(changedFiles(f.cwd).files, ['web/file.txt']);
});

test('comparison uses merge-base and excludes changes only on the base branch', t => {
  const f = fixture(t);
  f.git('checkout', '-qb', 'comparison');
  f.write('gu/base-only.txt');
  f.commit();
  f.git('checkout', '--detach', f.base);
  f.write('web/task.txt');
  f.commit();
  assert.deepEqual(changedFiles(f.cwd, 'comparison'), { mergeBase: f.base, files: ['web/task.txt'] });
});

test('invalid refs fail instead of falling back to an empty change list', t => {
  const f = fixture(t);
  assert.throws(() => changedFiles(f.cwd, 'missing-reference'));
});

test('CLI rejects invalid arguments and can show help without running checks', () => {
  assert.equal(spawnSync(process.execPath, [script, '--help']).status, 0);
  assert.equal(spawnSync(process.execPath, [script, '--base']).status, 1);
  assert.equal(spawnSync(process.execPath, [script, '--unknown']).status, 1);
});

function runFixture(f, args, status = 0) {
  const bin = path.join(f.cwd, '.test-bin');
  const marker = path.join(bin, 'invocations.txt');
  f.write('.test-bin/npm', `#!/usr/bin/env node
const { appendFileSync } = require('node:fs');
appendFileSync(${JSON.stringify(marker)}, process.argv.slice(2).join(' ') + '\\n');
process.exit(${status});
`);
  chmodSync(path.join(bin, 'npm'), 0o755);
  f.write('calc/change.js');
  const source = `import { main } from ${JSON.stringify(pathToFileURL(script).href)};
process.exitCode = main(JSON.parse(process.argv[1]), process.argv[2]);`;
  const result = spawnSync(process.execPath, ['--input-type=module', '--eval', source, JSON.stringify(args), f.cwd], {
    encoding: 'utf8',
    env: { ...process.env, PATH: `${bin}${path.delimiter}${process.env.PATH}` },
  });
  return { ...result, marker };
}

test('preview executes nothing; run executes selected local checks', t => {
  const preview = runFixture(fixture(t), []);
  assert.equal(preview.status, 0, preview.stderr);
  assert.equal(existsSync(preview.marker), false);
  const run = runFixture(fixture(t), ['--run']);
  assert.equal(run.status, 0, run.stderr);
  assert.equal(readFileSync(run.marker, 'utf8'), 'test\nrun build\n');
});

test('a failed check returns nonzero and stops subsequent commands', t => {
  const result = runFixture(fixture(t), ['--run'], 9);
  assert.equal(result.status, 1, result.stderr);
  assert.equal(readFileSync(result.marker, 'utf8'), 'test\n');
  assert.match(result.stderr, /FAILED/);
});

test('unmapped changes block execution instead of claiming a pass', t => {
  const f = fixture(t);
  f.write('new-app/file.js');
  const result = runFixture(f, ['--base', f.base, '--run']);
  assert.equal(result.status, 2, result.stderr);
  assert.equal(existsSync(result.marker), false);
  assert.match(result.stdout, /MANUAL: "new-app\/file.js"/);
});
