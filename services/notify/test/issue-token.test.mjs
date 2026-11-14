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
  assert.doesNotThrow(() => issueToken({ source: 'surgeconf.watchdog', kinds: 'daily-review', out: path.join(dir, 'daily.token'), sql: path.join(dir, 'daily.sql'), randomId: Buffer.from('id-seed-daily'), randomSecret: Buffer.from('secret-seed-daily') }));
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
  await assert.rejects(async () => {
    execFileSync(process.execPath, [script.pathname, '--source', 'surgeconf.watchdog', '--kinds', 'unknown', '--out', path.join(dir, 'unknown.token'), '--sql', path.join(dir, 'unknown.sql')], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  }, /not allowed/);
});

test('issueToken derives both health kinds and rejects cross-source kinds', async t => {
  const dir = await mkdtemp(path.join(tmpdir(), 'notify-health-token-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const result = issueToken({ source: 'mybrain.job-health', kinds: 'job.health,job.unhealthy', out: path.join(dir, 'token'), sql: path.join(dir, 'token.sql'), randomId: Buffer.from('health-id'), randomSecret: Buffer.from('health-secret') });
  assert.deepEqual(result.selected, ['job.health', 'job.unhealthy']);
  assert.throws(() => issueToken({ source: 'mybrain.job-health', kinds: 'agent.stuck', out: path.join(dir, 'bad-watchdog-token'), sql: path.join(dir, 'bad-watchdog.sql') }), /not allowed/);
  assert.throws(() => issueToken({ source: 'surgeconf.watchdog', kinds: 'job.health', out: path.join(dir, 'bad-health-token'), sql: path.join(dir, 'bad-health.sql') }), /not allowed/);
});

test('issueToken derives only the ledger digest kind for mybrain.ledger', async t => {
  const dir = await mkdtemp(path.join(tmpdir(), 'notify-ledger-token-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const result = issueToken({ source: 'mybrain.ledger', kinds: 'ledger.digest', out: path.join(dir, 'token'), sql: path.join(dir, 'token.sql'), randomId: Buffer.from('ledger-id'), randomSecret: Buffer.from('ledger-secret') });
  assert.deepEqual(result.selected, ['ledger.digest']);
  assert.throws(() => issueToken({ source: 'mybrain.ledger', kinds: 'job.health', out: path.join(dir, 'bad-health-token'), sql: path.join(dir, 'bad-health.sql') }), /not allowed/);
  assert.throws(() => issueToken({ source: 'surgeconf.watchdog', kinds: 'ledger.digest', out: path.join(dir, 'bad-ledger-token'), sql: path.join(dir, 'bad-ledger.sql') }), /not allowed/);
});

test('issueToken derives the three magpie kinds for mybrain.magpie only', async t => {
  const dir = await mkdtemp(path.join(tmpdir(), 'notify-magpie-token-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const result = issueToken({ source: 'mybrain.magpie', kinds: 'magpie.unresponsive,magpie.source_disabled,magpie.spend', out: path.join(dir, 'token'), sql: path.join(dir, 'token.sql'), randomId: Buffer.from('magpie-id'), randomSecret: Buffer.from('magpie-secret') });
  assert.deepEqual(result.selected, ['magpie.unresponsive', 'magpie.source_disabled', 'magpie.spend']);
  assert.throws(() => issueToken({ source: 'mybrain.magpie', kinds: 'job.health', out: path.join(dir, 'bad-health-token'), sql: path.join(dir, 'bad-health.sql') }), /not allowed/);
  assert.throws(() => issueToken({ source: 'mybrain.job-health', kinds: 'magpie.spend', out: path.join(dir, 'bad-magpie-token'), sql: path.join(dir, 'bad-magpie.sql') }), /not allowed/);
});

test('issueToken derives each MyBrain alert kind only for its source', async t => {
  const dir = await mkdtemp(path.join(tmpdir(), 'notify-mybrain-token-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const cases = [
    ['mybrain.cert-expiry', 'cert-expiry', 'cert-id', 'cert-secret'],
    ['mybrain.cf-d1-backup', 'cf-d1-backup', 'backup-id', 'backup-secret'],
    ['mybrain.feishu-report', 'report.failed', 'report-id', 'report-secret'],
  ];
  for (const [source, kind, id, secret] of cases) {
    const result = issueToken({ source, kinds: kind, out: path.join(dir, `${kind}.token`), sql: path.join(dir, `${kind}.sql`), randomId: Buffer.from(id), randomSecret: Buffer.from(secret) });
    assert.deepEqual(result.selected, [kind]);
    assert.throws(() => issueToken({ source, kinds: 'agent.stuck', out: path.join(dir, `${kind}-bad.token`), sql: path.join(dir, `${kind}-bad.sql`) }), /not allowed/);
  }
});
