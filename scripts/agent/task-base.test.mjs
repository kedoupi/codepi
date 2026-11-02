import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { baselineRelativePath, main, readBaseline, recordBaseline } from './task-base.mjs';

const script = fileURLToPath(new URL('./task-base.mjs', import.meta.url));

function fixture(t) {
  const cwd = mkdtempSync(path.join(tmpdir(), 'kdp-task-base-'));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  const git = (...args) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: 'pipe' }).trim();
  git('init', '-q');
  git('config', 'user.name', 'Workflow test');
  git('config', 'user.email', 'workflow-test@example.invalid');
  git('config', 'commit.gpgsign', 'false');
  writeFileSync(path.join(cwd, 'README.md'), 'fixture\n');
  git('add', 'README.md');
  git('commit', '-qm', 'fixture');
  return { cwd, git, head: git('rev-parse', 'HEAD') };
}

test('record and read a full current HEAD baseline in the local ignored file', t => {
  const f = fixture(t);
  const result = recordBaseline(f.cwd);
  assert.equal(result.commit, f.head);
  assert.equal(result.target, path.join(realpathSync(f.cwd), baselineRelativePath));
  assert.equal(readFileSync(result.target, 'utf8'), `${f.head}\n`);
  assert.deepEqual(readBaseline(f.cwd), { commit: f.head, target: result.target });
});

test('an explicit ref is resolved once to a full commit', t => {
  const f = fixture(t);
  assert.equal(recordBaseline(f.cwd, 'HEAD').commit, f.head);
  assert.throws(() => recordBaseline(f.cwd, 'missing-reference'));
});

test('the baseline must be recorded from the repository root', t => {
  const f = fixture(t);
  const nested = path.join(f.cwd, 'apps/web');
  mkdirSync(nested, { recursive: true });
  assert.throws(() => recordBaseline(nested), /repository root/);
});

test('missing and malformed baselines fail with an actionable message', t => {
  const f = fixture(t);
  assert.throws(() => readBaseline(f.cwd), /pnpm task:base/);
  writeFileSync(path.join(f.cwd, '.agent-placeholder'), '');
  mkdirSync(path.join(f.cwd, '.agent'), { recursive: true });
  writeFileSync(path.join(f.cwd, baselineRelativePath), 'HEAD\n');
  assert.throws(() => readBaseline(f.cwd), /Invalid local task baseline/);
});

test('CLI defaults to setting the baseline and supports preview instructions', t => {
  const f = fixture(t);
  const result = spawnSync(process.execPath, [script], { cwd: f.cwd, encoding: 'utf8' });
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  assert.match(result.stdout, /pnpm check:task/);
  assert.equal(readFileSync(path.join(f.cwd, baselineRelativePath), 'utf8'), `${f.head}\n`);
  assert.equal(readBaseline(f.cwd).commit, f.head);
});

test('CLI show, clear, help and invalid arguments have explicit results', t => {
  const f = fixture(t);
  assert.equal(main(['--set'], f.cwd), 0);
  assert.equal(main(['--show'], f.cwd), 0);
  assert.equal(main(['--clear'], f.cwd), 0);
  assert.throws(() => readBaseline(f.cwd), /No local task baseline/);
  assert.equal(spawnSync(process.execPath, [script, '--help']).status, 0);
  assert.equal(spawnSync(process.execPath, [script, '--unknown'], { cwd: f.cwd }).status, 1);
  assert.equal(spawnSync(process.execPath, [script, '--set', 'HEAD', 'extra'], { cwd: f.cwd }).status, 1);
});
