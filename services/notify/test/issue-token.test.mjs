import assert from 'node:assert/strict';
import { mkdtemp, stat, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { issueToken } from '../scripts/issue-token.mjs';

test('issueToken validates rules and emits only a hash SQL row', async t => {
  const dir = await mkdtemp(path.join(tmpdir(), 'notify-token-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const out = path.join(dir, 'token');
  const sql = path.join(dir, 'token.sql');
  const result = issueToken({ source: 'surgeconf.watchdog', kinds: 'agent.stuck,notify.selftest', out, sql, random: Buffer.from('012345678901234567890123456789') });
  assert.match(result.token, /^cpn_[A-Za-z0-9_-]+_[A-Za-z0-9_-]+$/);
  assert.equal(result.insert.includes(result.token), false);
  assert.equal(result.insert.includes(result.hash), true);
  await import('node:fs/promises').then(({ writeFile, chmod: setMode }) => writeFile(out, `${result.token}\n`, { mode: 0o600 }).then(() => setMode(out, 0o600)));
  assert.equal((await stat(out)).mode & 0o777, 0o600);
  assert.throws(() => issueToken({ source: 'surgeconf.watchdog', kinds: 'unknown', out, sql, random: Buffer.from('012345678901234567890123456789') }), /not allowed/);
});
