import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

const script = new URL('./ci-plan.mjs', import.meta.url);

test('CI plan rejects an unknown base without running checks', () => {
  const cwd = mkdtempSync(path.join(tmpdir(), 'codepi-ci-plan-'));
  tCleanup(cwd);
  assert.throws(() => execFileSync(process.execPath, [script.pathname, '--base', 'missing'], { cwd, encoding: 'utf8', stdio: 'pipe' }), /Command failed/);
});

test('CI plan does not include uncommitted files in a PR scope', t => {
  const cwd = mkdtempSync(path.join(tmpdir(), 'codepi-ci-scope-'));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  const git = (...args) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: 'pipe' }).trim();
  git('init', '-q');
  git('config', 'user.name', 'CI test');
  git('config', 'user.email', 'ci@example.invalid');
  git('config', 'commit.gpgsign', 'false');
  execFileSync('cp', ['-R', new URL('.', import.meta.url).pathname, path.join(cwd, 'scripts')]);
  git('add', '.');
  git('-c', 'core.hooksPath=/dev/null', 'commit', '-qm', 'base');
  const base = git('rev-parse', 'HEAD');
  writeFileSync(path.join(cwd, 'unknown.txt'), 'uncommitted');
  const result = execFileSync(process.execPath, [script.pathname, '--base', base], { cwd, encoding: 'utf8' });
  assert.deepEqual(JSON.parse(result).jobs, []);
});

function tCleanup(cwd) {
  process.once('exit', () => rmSync(cwd, { recursive: true, force: true }));
}
