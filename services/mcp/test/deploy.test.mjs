import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { chmod, copyFile, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

const databaseId = '11111111-1111-4111-8111-111111111111';
async function releaseFixture(t) {
  const root = await realpath(await mkdtemp(path.join(tmpdir(), 'codepi-mcp-release-')));
  t.after(() => rm(root, { recursive: true, force: true }));
  const service = path.join(root, 'services/mcp');
  const bin = path.join(root, 'bin');
  await mkdir(path.join(service, 'scripts'), { recursive: true });
  await mkdir(bin);
  await copyFile(new URL('../scripts/deploy.mjs', import.meta.url), path.join(service, 'scripts/deploy.mjs'));
  await copyFile(new URL('../wrangler.toml', import.meta.url), path.join(service, 'wrangler.toml'));
  await writeFile(path.join(root, '.gitignore'), '.wrangler/\ncalls.jsonl\ncreated\n');
  const shim = path.join(bin, 'pnpm');
  await writeFile(shim, `#!${process.execPath}
import { appendFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
const args = process.argv.slice(2);
const configIndex = args.indexOf('--config');
appendFileSync(process.env.CALLS, JSON.stringify({ args,
  config: configIndex < 0 ? null : readFileSync(args[configIndex + 1], 'utf8') }) + '\\n');
if (args[2] === 'd1' && args[3] === 'list') {
  console.log(JSON.stringify(existsSync(process.env.CREATED)
    ? [{ name: 'codepi-mcp', uuid: '${databaseId}' }]
    : [{ name: 'codepi-health', uuid: '22222222-2222-4222-8222-222222222222' }]));
} else if (args[2] === 'd1' && args[3] === 'create') {
  writeFileSync(process.env.CREATED, '');
} else if (args[2] === 'd1' && args[3] === 'migrations' && process.env.FAIL_MIGRATE) {
  process.exit(1);
} else if (args[2] === 'deploy') {
  console.log('Current Version ID: 33333333-3333-4333-8333-333333333333');
}
`);
  await chmod(shim, 0o755);
  const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: 'pipe' }).trim();
  git('init', '-b', 'main');
  git('config', 'user.name', 'MCP test');
  git('config', 'user.email', 'mcp-test@example.invalid');
  git('add', '.');
  git('-c', 'core.hooksPath=/dev/null', '-c', 'commit.gpgsign=false', 'commit', '-m', 'synthetic release source');
  const sha = git('rev-parse', 'HEAD');
  const run = (sourceSha = sha, overrides = {}) => spawnSync(process.execPath,
    [path.join(service, 'scripts/deploy.mjs'), sourceSha], {
      cwd: root, encoding: 'utf8',
      env: { ...process.env, PATH: bin + path.delimiter + process.env.PATH,
        CALLS: path.join(root, 'calls.jsonl'), CREATED: path.join(root, 'created'), ...overrides },
    });
  const calls = async () => (await readFile(path.join(root, 'calls.jsonl'), 'utf8')).trim().split('\n').map(JSON.parse);
  return { root, service, sha, git, run, calls };
}

test('first release provisions only MCP D1 and migrates the same resolved config before deploy', async t => {
  const f = await releaseFixture(t), result = f.run();
  assert.equal(result.status, 0, result.stderr);
  const calls = await f.calls();
  assert.deepEqual(calls.map(c => c.args.slice(2, 4)), [
    ['d1', 'list'], ['d1', 'create'], ['d1', 'list'], ['d1', 'migrations'], ['deploy', '--config'],
  ]);
  assert.equal(calls[1].args[4], 'codepi-mcp');
  assert.equal(calls[3].config, calls[4].config);
  assert.ok(calls[3].config.includes(`database_id = "${databaseId}"`));
  assert.ok(calls[3].config.includes(`main = ${JSON.stringify(path.join(f.service, 'src/index.ts'))}`));
  assert.deepEqual(calls[4].args.slice(-2), ['--var', `BUILD_SHA:${f.sha.slice(0, 12)}`]);
  assert.equal(f.git('status', '--porcelain'), '', 'provisioning must not rewrite reviewed source');
  assert.doesNotMatch(await readFile(path.join(f.service, 'wrangler.toml'), 'utf8'), /database_id/);
  const second = f.run();
  assert.equal(second.status, 0, second.stderr);
  assert.equal((await f.calls()).filter(c => c.args[3] === 'create').length, 1, 'reuse the exact database on subsequent releases');
});

test('source mismatch, dirty changes and migration failures cannot deploy', async t => {
  const f = await releaseFixture(t);
  assert.notEqual(f.run('0'.repeat(40)).status, 0);
  await assert.rejects(() => f.calls(), { code: 'ENOENT' });
  await writeFile(path.join(f.service, 'unreviewed.txt'), 'unreviewed');
  assert.notEqual(f.run().status, 0);
  await assert.rejects(() => f.calls(), { code: 'ENOENT' });
  await rm(path.join(f.service, 'unreviewed.txt'));
  const failure = f.run(f.sha, { FAIL_MIGRATE: '1' });
  assert.notEqual(failure.status, 0);
  assert.ok((await f.calls()).every(c => c.args[2] !== 'deploy'));
});
