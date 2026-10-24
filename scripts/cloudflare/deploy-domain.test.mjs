import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { deployDomain, DOMAINS } from './deploy-domain.mjs';

const databaseId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const version = '11111111-1111-4111-8111-111111111111';

async function fixture(t, app) {
  const cwd = await mkdtemp(path.join(tmpdir(), `deploy-domain-${app}-`));
  t.after(() => rm(cwd, { recursive: true, force: true }));
  const git = (...args) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: 'pipe' }).trim();
  git('init', '-b', 'main');
  git('config', 'user.name', 'Deploy test');
  git('config', 'user.email', 'test@example.invalid');
  git('config', 'commit.gpgsign', 'false');
  git('remote', 'add', 'origin', cwd);
  const domain = DOMAINS[app];
  const appDir = path.join(cwd, domain.appDir);
  await mkdir(path.join(appDir, 'migrations'), { recursive: true });
  await mkdir(path.join(appDir, 'worker'), { recursive: true });
  await writeFile(path.join(cwd, '.gitignore'), '.wrangler/\n');
  await writeFile(path.join(appDir, 'worker', 'index.ts'), 'export default { fetch() { return new Response(); } };\n');
  await writeFile(path.join(appDir, 'migrations', '0001_init.sql'), 'CREATE TABLE synthetic(id);\n');
  await writeFile(path.join(appDir, 'wrangler.toml'), `
name = "${domain.worker}"
main = "worker/index.ts"
routes = [{ pattern = "${app}.codepi.app", custom_domain = true }]
[assets]
directory = "./dist"
binding = "ASSETS"
run_worker_first = true
[[d1_databases]]
binding = "DB"
database_name = "${domain.database}"
migrations_dir = "migrations"
`);
  git('add', '.');
  git('-c', 'core.hooksPath=/dev/null', 'commit', '-m', 'fixture');
  const sha = git('rev-parse', 'HEAD');
  return { cwd, appDir, sha, git };
}

function executor({ databaseName, existing = [databaseId], create = true, inspect } = {}) {
  const calls = [];
  let databases = existing.map(uuid => ({ name: databaseName, uuid }));
  const execute = (command, args, options) => {
    calls.push({ command, args, options });
    const wrangler = args[0] === 'exec' && args[1] === 'wrangler' ? args.slice(2) : args;
    if (wrangler[0] === 'd1' && wrangler[1] === 'list') {
      return { status: 0, stdout: JSON.stringify(databases), stderr: '' };
    }
    if (wrangler[0] === 'd1' && wrangler[1] === 'create') {
      if (create) databases = [{ name: wrangler[2], uuid: databaseId }];
      return { status: 0, stdout: '', stderr: '' };
    }
    if (wrangler[0] === 'd1' && wrangler[1] === 'migrations') {
      inspect?.(readFileSyncConfig(wrangler));
      return { status: 0, stdout: '', stderr: '' };
    }
    if (wrangler[0] === 'deploy') {
      inspect?.(readFileSyncConfig(wrangler));
      return { status: 0, stdout: `Current Version ID: ${version}`, stderr: '' };
    }
    return { status: 1, stdout: '', stderr: 'unexpected synthetic command' };
  };
  return { calls, execute };
}

function readFileSyncConfig(args) {
  // The test executor is synchronous, matching spawnSync.
  return execFileSync(process.execPath, ['-e', `
    const fs = require('node:fs');
    process.stdout.write(fs.readFileSync(process.argv[1], 'utf8'));
  `, args[args.indexOf('--config') + 1]], { encoding: 'utf8' });
}

function wranglerArgs(call) {
  return call.args[0] === 'exec' && call.args[1] === 'wrangler' ? call.args.slice(2) : call.args;
}

test('deploy-domain supports the required --app form and injects one exact-name D1 into a temporary config', async t => {
  for (const app of Object.keys(DOMAINS)) {
    const f = await fixture(t, app);
    let rendered;
    const e = executor({ databaseName: DOMAINS[app].database, inspect: text => { rendered = text; } });
    const result = await deployDomain(app, { cwd: f.cwd, execute: e.execute });
    assert.equal(result.app, app);
    assert.equal(result.database, DOMAINS[app].database);
    assert.equal(result.database_id, databaseId);
    assert.equal(result.migrations, 1);
    assert.equal(result.source_sha, f.sha);
    assert.equal(result.version, version);
    assert.match(rendered, new RegExp(`database_id = "${databaseId}"`));
    assert.ok(rendered.includes(`main = ${JSON.stringify(path.join(f.appDir, 'worker/index.ts'))}`));
    assert.match(rendered, /migrations_dir = "[^"]+\/migrations"/);
    assert.match(rendered, /directory = "[^"]+\/dist"/);
    assert.equal(e.calls.filter(call => wranglerArgs(call)[0] === 'deploy').length, 1);
    assert.equal(e.calls.filter(call => wranglerArgs(call)[0] === 'd1'
      && wranglerArgs(call)[1] === 'migrations').length, 1);
    assert.ok(!(await readFile(path.join(f.appDir, 'wrangler.toml'), 'utf8')).includes('database_id'));
    const leftover = execFileSync('find', [path.join(f.appDir, '.wrangler'), '-mindepth', '1', '-maxdepth', '1'],
      { encoding: 'utf8' }).trim();
    assert.equal(leftover, '');
  }
});

test('missing D1 remains fail-closed unless the first-deploy command explicitly authorizes exact-name provisioning', async t => {
  const f = await fixture(t, 'project');
  const noProvision = executor({ databaseName: 'codepi-project', existing: [] });
  await assert.rejects(deployDomain('project', { cwd: f.cwd, execute: noProvision.execute }), /provision-d1/);
  assert.equal(noProvision.calls.filter(call => wranglerArgs(call)[1] === 'create').length, 0);
  const provision = executor({ databaseName: 'codepi-project', existing: [] });
  const result = await deployDomain('project', { cwd: f.cwd, execute: provision.execute, provisionD1: true });
  assert.equal(result.database_id, databaseId);
  assert.equal(provision.calls.filter(call => wranglerArgs(call)[1] === 'create').length, 1);
  assert.deepEqual(wranglerArgs(provision.calls.find(call => wranglerArgs(call)[1] === 'create')).slice(0, 4),
    ['d1', 'create', 'codepi-project', '--update-config=false']);
});

test('dirty source and duplicate migration prefixes stop before any Wrangler mutation', async t => {
  const f = await fixture(t, 'me');
  await writeFile(path.join(f.appDir, 'migrations', '0001_duplicate.sql'), 'SELECT 1;\n');
  f.git('add', '.');
  f.git('-c', 'core.hooksPath=/dev/null', 'commit', '-m', 'duplicate');
  const e = executor({ databaseName: 'codepi-me' });
  await assert.rejects(deployDomain('me', { cwd: f.cwd, execute: e.execute }), /duplicate migration prefix/);
  assert.equal(e.calls.length, 0);
  await rm(path.join(f.appDir, 'migrations', '0001_duplicate.sql'));
  await writeFile(path.join(f.appDir, 'unreviewed'), 'dirty\n');
  await assert.rejects(deployDomain('me', { cwd: f.cwd, execute: e.execute }), /clean/);
  assert.equal(e.calls.length, 0);
});
test('deploy-domain rechecks remote main after discovery before remote mutation', async t => {
  const f = await fixture(t, 'project');
  const e = executor({ databaseName: 'codepi-project' });
  let listed = false;
  const execute = (command, args, options) => {
    const result = e.execute(command, args, options);
    const wrangler = wranglerArgs({ args });
    if (!listed && wrangler[0] === 'd1' && wrangler[1] === 'list') {
      listed = true;
      f.git('commit', '--allow-empty', '-m', 'remote moved');
    }
    return result;
  };
  await assert.rejects(
    deployDomain('project', { cwd: f.cwd, execute }),
    /immediately before remote mutation/,
  );
  assert.equal(e.calls.filter(call => ['create', 'migrations', 'deploy'].includes(wranglerArgs(call)[1]
    ?? wranglerArgs(call)[0])).length, 0);
});
