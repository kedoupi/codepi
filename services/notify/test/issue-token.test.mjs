import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { chmod, mkdtemp, readFile, stat, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { issueToken } from '../scripts/issue-token.mjs';

const script = new URL('../scripts/issue-token.mjs', import.meta.url);

test('issueToken validates rules and emits only a hash SQL row', async t => {
  const dir = await mkdtemp(path.join(tmpdir(), 'notify-token-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const out = path.join(dir, 'token');
  const sql = path.join(dir, 'token.sql');
  const result = issueToken({ source: 'surgeconf.watchdog', kinds: 'agent.stuck,notify.selftest', out, sql, randomId: Buffer.from('id-seed-1'), randomSecret: Buffer.from('secret-seed-1') });
  assert.match(result.token, /^cpn_[A-Za-z0-9_-]+_[A-Za-z0-9_-]+$/);
  assert.equal(result.insert.includes(result.token), false);
  assert.equal(result.insert.includes(result.hash), true);
  assert.equal(result.insert.includes(result.id), true);
  assert.throws(() => issueToken({ source: 'surgeconf.watchdog', kinds: 'unknown', out, sql }), /not allowed/);
  assert.throws(() => issueToken({ source: 'rpc', kinds: 'notify.selftest', out, sql }), /rpc source/);
});

test('issue-token subprocess writes 0600 files, hides plaintext and rejects reuse', async t => {
  const dir = await mkdtemp(path.join(tmpdir(), 'notify-token-cli-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const out = path.join(dir, 'token');
  const sql = path.join(dir, 'token.sql');
  const args = ['--source', 'surgeconf.watchdog', '--kinds', 'agent.stuck,notify.selftest', '--out', out, '--sql', sql];
  const stdout = execFileSync(process.execPath, [script.pathname, ...args], { encoding: 'utf8' });
  const plaintext = (await readFile(out, 'utf8')).trim();
  const sqlText = await readFile(sql, 'utf8');
  assert.equal((await stat(out)).mode & 0o777, 0o600);
  assert.equal((await stat(sql)).mode & 0o777, 0o600);
  assert.equal(stdout.includes(plaintext), false);
  assert.equal(sqlText.includes(plaintext), false);
  assert.match(sqlText, /INSERT INTO producer_tokens/);
  assert.match(sqlText, /[a-f0-9]{64}/);
  await assert.rejects(async () => {
    execFileSync(process.execPath, [script.pathname, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  }, /already exists/);
  await chmod(out, 0o600);
  await writeFile(path.join(dir, 'rpc.sql'), '');
  await assert.rejects(async () => {
    execFileSync(process.execPath, [script.pathname, '--source', 'rpc', '--kinds', 'notify.selftest', '--out', path.join(dir, 'rpc.token'), '--sql', path.join(dir, 'rpc.sql')], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  }, /rpc source/);
});
