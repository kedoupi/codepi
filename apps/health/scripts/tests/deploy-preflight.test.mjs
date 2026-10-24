import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { chmod, copyFile, mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { parseWranglerConfig, readWranglerConfig } from '../lib/wrangler-config.mjs';

const config = `name = "test-worker"
main = "src/index.ts"
[triggers]
crons = ["*/2 * * * *"]
[[d1_databases]]
binding = "DB"
database_name = "test-db"
`;
const activeVersion = '00000000-0000-4000-8000-000000000001';

test('deployment reads the checked-in Worker, D1 binding and schedule', () => {
  const dir = fileURLToPath(new URL('../../workers/api/', import.meta.url));
  assert.deepEqual(readWranglerConfig(join(dir, 'wrangler.toml'), { dir }), {
    name: 'codepi-health-api', main: 'src/index.ts', databaseName: 'codepi-health', crons: ['*/2 * * * *'],
  });
});

test('preflight rejects missing or unusable deploy settings', () => {
  for (const [remove, message] of [
    ['name = "test-worker"', /Worker name/],
    ['main = "src/index.ts"', /entrypoint/],
    ['database_name = "test-db"', /database_name/],
    ['crons = ["*/2 * * * *"]', /crons list/],
  ]) {
    assert.throws(() => parseWranglerConfig(config.replace(remove, '')), message);
  }
  assert.throws(() => parseWranglerConfig(config, { dir: '/absent', fileExists: () => false }), /does not exist/);
  assert.throws(() => parseWranglerConfig(config.replace('["*/2 * * * *"]', '["bad",]')), /not valid JSON/);
  assert.throws(() => parseWranglerConfig(config.replace('["*/2 * * * *"]', '[]')), /non-empty list/);
  assert.throws(() => parseWranglerConfig(config.replace('["*/2 * * * *"]', '[123]')), /cron strings/);
  assert.throws(() => parseWranglerConfig(config.replace('["*/2 * * * *"]', '[" "]')), /cron strings/);
});

test('preflight selects production settings and the DB binding rather than another environment', () => {
  const otherDb = `[[d1_databases]]
binding = "ARCHIVE"
database_name = "other-db"
`;
  const text = config.replace('[[d1_databases]]', `${otherDb}[[d1_databases]]`)
    + '[env.preview]\nname = "preview-worker"\n';
  assert.equal(parseWranglerConfig(text).name, 'test-worker');
  assert.equal(parseWranglerConfig(text).databaseName, 'test-db');
  assert.throws(() => parseWranglerConfig(text.replace('name = "test-worker"', '')), /Worker name/);
  assert.throws(() => parseWranglerConfig(text.replace('binding = "DB"', 'binding = "OTHER"')), /database_name/);
  assert.throws(() => parseWranglerConfig(config + config.slice(config.indexOf('[[d1_databases]]'))), /ambiguous D1/);
  assert.throws(() => parseWranglerConfig(config.replace('name = "test-worker"', 'name = "one"\nname = "two"')), /ambiguous name/);
});

test('preflight tolerates comments and multiline schedules without selecting env triggers', () => {
  const text = config.replace('name = "test-worker"', 'name = "test-worker" # production')
    .replace('crons = ["*/2 * * * *"]', '# scheduler\ncrons = [\n"*/2 * * * *"\n]')
    + '[env.preview.triggers]\ncrons = ["0 0 * * *"]\n';
  assert.deepEqual(parseWranglerConfig(text).crons, ['*/2 * * * *']);
});

async function fixture(t, { dryRunFails = false, credentialsDenied = false, deploymentsFail = false } = {}) {
  const root = await mkdtemp(join(tmpdir(), 'health-deploy-preflight-'));
  const requests = [];
  const server = createServer((req, res) => {
    requests.push({ method: req.method, path: req.url });
    const prefix = '/client/v4/accounts/test-account/workers/scripts/test-worker';
    const schedules = req.method === 'GET' && req.url === `${prefix}/schedules`;
    const deployments = req.method === 'GET' && req.url === `${prefix}/deployments`;
    const ok = !credentialsDenied && (schedules || (deployments && !deploymentsFail));
    const result = schedules
      ? { schedules: [{ cron: '*/2 * * * *' }] }
      : { deployments: [{ versions: [{ version_id: activeVersion, percentage: 100 }] }] };
    res.writeHead(ok ? 200 : 403, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(ok
      ? { success: true, result }
      : { success: false, errors: [{ message: 'test permission denied' }] }));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => {
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
    await rm(root, { recursive: true, force: true });
  });
  await Promise.all([
    mkdir(join(root, 'scripts/lib'), { recursive: true }),
    mkdir(join(root, 'workers/api/src'), { recursive: true }),
    mkdir(join(root, 'bin'), { recursive: true }),
  ]);
  await Promise.all([
    copyFile(new URL('../deploy-api.mjs', import.meta.url), join(root, 'scripts/deploy-api.mjs')),
    copyFile(new URL('../lib/wrangler-config.mjs', import.meta.url), join(root, 'scripts/lib/wrangler-config.mjs')),
    writeFile(join(root, 'workers/api/wrangler.toml'), config),
    writeFile(join(root, 'workers/api/src/index.ts'), 'export default {};'),
    writeFile(join(root, 'bin/pnpm'), `#!${process.execPath}
const fs = require('node:fs');
const args = process.argv.slice(2);
fs.appendFileSync(process.env.PREFLIGHT_COMMAND_LOG, JSON.stringify(args) + '\\n');
if (JSON.stringify(args) !== JSON.stringify(['exec', 'wrangler', 'deploy', '--dry-run', '--outdir=.deploy-preflight'])) {
  console.error('Unexpected mutating command'); process.exit(90);
}
fs.mkdirSync('.deploy-preflight', { recursive: true });
process.exit(${dryRunFails ? 1 : 0});
`),
  ]);
  await chmod(join(root, 'bin/pnpm'), 0o755);

  return {
    requests, root,
    async run(overrides = {}) {
      const output = [];
      const child = spawn(process.execPath, [join(root, 'scripts/deploy-api.mjs'), '--preflight-only'], {
        cwd: root,
        env: {
          ...process.env,
          PATH: `${join(root, 'bin')}:${process.env.PATH}`,
          CLOUDFLARE_API_TOKEN: 'test-token',
          CLOUDFLARE_ACCOUNT_ID: 'test-account',
          CLOUDFLARE_API_BASE_URL: `http://127.0.0.1:${server.address().port}/client/v4`,
          HEALTH_PREVIOUS_VERSION: '',
          PREFLIGHT_COMMAND_LOG: join(root, 'commands.jsonl'),
          ...overrides,
        },
      });
      child.stdout.on('data', chunk => output.push(chunk));
      child.stderr.on('data', chunk => output.push(chunk));
      const status = await new Promise((resolve, reject) => {
        child.once('error', reject);
        child.once('close', resolve);
      });
      const log = await readFile(join(root, 'commands.jsonl'), 'utf8').catch(() => '');
      return { status, output: Buffer.concat(output).toString(), commands: log.trim().split('\n').filter(Boolean).map(JSON.parse) };
    },
  };
}

test('--preflight-only validates locally and reads the active version without production mutations', async t => {
  const f = await fixture(t);
  const run = await f.run();
  assert.equal(run.status, 0, run.output);
  assert.match(run.output, new RegExp(`active=${activeVersion}`));
  assert.match(run.output, /stopping before any remote change/);
  assert.deepEqual(run.commands, [['exec', 'wrangler', 'deploy', '--dry-run', '--outdir=.deploy-preflight']]);
  assert.deepEqual(f.requests, [
    { method: 'GET', path: '/client/v4/accounts/test-account/workers/scripts/test-worker/schedules' },
    { method: 'GET', path: '/client/v4/accounts/test-account/workers/scripts/test-worker/deployments' },
  ]);
  await assert.rejects(stat(join(f.root, 'workers/api/.deploy-preflight')), { code: 'ENOENT' });
});
test('release evidence facts are optional and invalid caller facts fail closed', async t => {
  const source = await readFile(new URL('../deploy-api.mjs', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /migration_applied:\s*true|secret_changed:\s*true|binding_changed:\s*true|external_side_effects:\s*true/);
  const f = await fixture(t);
  const run = await f.run({ HEALTH_MIGRATION_APPLIED: 'maybe' });
  assert.equal(run.status, 1);
  assert.match(run.output, /HEALTH_MIGRATION_APPLIED must be true or false/);
  assert.deepEqual(f.requests, []);
});

test('missing credentials stop before the bundle or network is touched', async t => {
  const f = await fixture(t);
  for (const env of [{ CLOUDFLARE_API_TOKEN: '' }, { CLOUDFLARE_ACCOUNT_ID: '' }]) {
    const run = await f.run(env);
    assert.equal(run.status, 1, run.output);
    assert.match(run.output, /Deploy requires/);
    assert.deepEqual(run.commands, []);
    assert.deepEqual(f.requests, []);
  }
});

test('a failed dry run stops before any Cloudflare call and cleans its output', async t => {
  const f = await fixture(t, { dryRunFails: true });
  const run = await f.run();
  assert.equal(run.status, 1, run.output);
  assert.match(run.output, /Deploy aborted before any remote change/);
  assert.deepEqual(f.requests, []);
  await assert.rejects(stat(join(f.root, 'workers/api/.deploy-preflight')), { code: 'ENOENT' });
});

test('a token without Worker access stops before migration, upload or traffic changes', async t => {
  const f = await fixture(t, { credentialsDenied: true });
  const run = await f.run();
  assert.equal(run.status, 1, run.output);
  assert.match(run.output, /permission denied/);
  assert.equal(run.commands.length, 1);
  assert.equal(f.requests.length, 1);
  assert.ok(f.requests.every(req => req.method === 'GET'));
});

test('an unreadable active deployment fails the gate instead of losing rollback context silently', async t => {
  const f = await fixture(t, { deploymentsFail: true });
  const run = await f.run();
  assert.equal(run.status, 1, run.output);
  assert.match(run.output, /deployments failed/);
  assert.equal(run.commands.length, 1);
  assert.equal(f.requests.length, 2);
  assert.ok(f.requests.every(req => req.method === 'GET'));
});
