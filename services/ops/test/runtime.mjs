import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { generateKeyPairSync } from 'node:crypto';
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { decrypt, DATABASES } from '../../../scripts/cloudflare/backup-core.mjs';

const require = createRequire(import.meta.url);
const { Miniflare, Response } = createRequire(require.resolve('wrangler'))('miniflare');
const keys = generateKeyPairSync('rsa', { modulusLength: 3072,
  publicKeyEncoding: { type: 'spki', format: 'pem' }, privateKeyEncoding: { type: 'pkcs8', format: 'pem' } });
const directory = await mkdtemp(path.join(tmpdir(), 'codepi-ops-runtime-'));
let runtime;
try {
  execFileSync('pnpm', ['exec', 'wrangler', 'deploy', '--config', 'test/wrangler.toml', '--dry-run', '--outdir', directory],
    { stdio: 'pipe', env: { ...process.env, WRANGLER_SEND_METRICS: 'false' } });
  const source = await readFile(path.join(directory, 'fixture-worker.js'), 'utf8');
  const values = object => Object.fromEntries(Object.entries(object).map(([key, value]) => [key, { type: 'json', value }]));
  const exports = [];
  runtime = new Miniflare({
    workers: [{
      config: {
        name: 'ops-synthetic', compatibilityDate: '2026-10-19', compatibilityFlags: ['nodejs_compat'],
        triggers: [{ type: 'fetch', pattern: 'ops.synthetic/*' }],
        manifest: { mainModule: 'index.js', modules: { 'index.js': { type: 'esm', contents: source } } },
        exports: { SyntheticWorkflow: { type: 'workflow', name: 'ops-synthetic' } },
        env: {
          ...values({ RECIPIENT: keys.publicKey, CLOUDFLARE_ACCOUNT_ID: 'synthetic-account',
            CLOUDFLARE_API_TOKEN: 'synthetic-token', BUILD_SHA: 'synthetic' }),
          BACKUPS: { type: 'r2', name: 'ops-synthetic' },
          OPERATIONS: { type: 'workflow', name: 'ops-synthetic', worker: 'ops-synthetic', exportName: 'SyntheticWorkflow' },
        },
      },
      dev: { outboundService: { type: 'fetcher', handler(request) {
        const url = new URL(request.url);
        if (url.hostname === 'api.cloudflare.com' && url.pathname.endsWith('/export')) {
          exports.push(url.pathname);
          return Response.json({ success: true, result: { status: 'complete',
            result: { signed_url: 'https://synthetic.r2.cloudflarestorage.com/export' } } });
        }
        if (url.hostname === 'synthetic.r2.cloudflarestorage.com') return new Response('CREATE TABLE synthetic(id);');
        throw new Error('runtime test attempted an unexpected external request');
      } } },
    }],
  });
  await runtime.ready;
  const result = await runtime.dispatchFetch('https://ops.synthetic/start');
  assert.equal(result.status, 200);
  let status;
  for (let i = 0; i < 60; i++) {
    status = await (await runtime.dispatchFetch('https://ops.synthetic/status')).json();
    if (['errored', 'complete'].includes(status.status)) break;
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  assert.equal(status.status, 'errored', 'missing GitHub token must keep the native workflow failed');
  const bucket = await runtime.getR2Bucket('BACKUPS', 'ops-synthetic');
  const prefix = 'backups/synthetic-native';
  const manifestObject = await bucket.get(`${prefix}/manifest.json`);
  assert.ok(manifestObject, `synthetic native workflow failed before manifest: ${JSON.stringify(status)}`);
  const manifest = await manifestObject.json();
  assert.equal(manifest.databases.length, 6);
  assert.equal(exports.length, Object.keys(DATABASES).length);
  for (const entry of manifest.databases) {
    const object = await bucket.get(`${prefix}/${entry.file}`);
    const decrypted = decrypt(Buffer.from(await object.arrayBuffer()), keys.privateKey);
    assert.equal(decrypted.sql.toString(), 'CREATE TABLE synthetic(id);');
    assert.equal(decrypted.metadata.database_id, DATABASES[entry.database]);
  }
  assert.equal(await bucket.get('reports/backup/offsite-success.json'), null);
  console.log('PASS native Workflows + R2 + six compatible encrypted exports; offsite failure remains visible');
} finally {
  await runtime?.dispose();
  await rm(directory, { recursive: true, force: true });
}
