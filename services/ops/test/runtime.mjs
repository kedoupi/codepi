import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash, generateKeyPairSync, randomBytes } from 'node:crypto';
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
  const exports = [], expected = new Map(), assets = [];
  let release;
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
      dev: { outboundService: { type: 'fetcher', async handler(request) {
        const url = new URL(request.url);
        if (url.hostname === 'api.cloudflare.com' && url.pathname.endsWith('/export')) {
          exports.push(url.pathname);
          return Response.json({ success: true, result: { status: 'complete',
            result: { signed_url: `https://synthetic.r2.cloudflarestorage.com/${url.pathname.split('/').at(-2)}` } } });
        }
        if (url.hostname === 'synthetic.r2.cloudflarestorage.com') {
          const id = url.pathname.slice(1), hash = createHash('sha256');
          const rows = id === DATABASES['codepi-health'] ? 1024 : 1;
          let row = 0, bytes = 0;
          return new Response(new ReadableStream({
            pull(controller) {
              if (row++ > rows) {
                expected.set(id, { sha256: hash.digest('hex'), bytes });
                return controller.close();
              }
              const chunk = Buffer.from(row === 1 ? 'CREATE TABLE synthetic(value TEXT);\n'
                : `INSERT INTO synthetic VALUES('${randomBytes(32768).toString('hex')}');\n`);
              hash.update(chunk); bytes += chunk.length;
              controller.enqueue(chunk);
            },
          }, { highWaterMark: 0 }));
        }
        if (url.hostname === 'api.github.com') {
          if (url.pathname.includes('/releases/tags/')) return release
            ? Response.json(release) : new Response('', { status: 404 });
          if (request.method === 'POST') {
            release = { id: 42, tag_name: (await request.json()).tag_name };
            return Response.json(release);
          }
          return Response.json(assets);
        }
        if (url.hostname === 'uploads.github.com') {
          const hash = createHash('sha256');
          let bytes = 0;
          for await (const chunk of request.body) { bytes += chunk.byteLength; hash.update(chunk); }
          assert.equal(Number(request.headers.get('content-length')), bytes,
            'native R2 stream upload must preserve a fixed content length');
          const asset = { name: url.searchParams.get('name'), state: 'uploaded',
            digest: `sha256:${hash.digest('hex')}` };
          assets.push(asset);
          return Response.json(asset);
        }
        throw new Error('runtime test attempted an unexpected external request');
      } } },
    }],
  });
  await runtime.ready;
  const bucket = await runtime.getR2Bucket('BACKUPS', 'ops-synthetic');
  for (const withGithub of [false, true]) {
    const query = withGithub ? '?withGithub=1' : '';
    const result = await runtime.dispatchFetch(`https://ops.synthetic/start${query}`);
    assert.equal(result.status, 200);
    let status;
    for (let i = 0; i < 240; i++) {
      status = await (await runtime.dispatchFetch(`https://ops.synthetic/status${query}`)).json();
      if (['errored', 'complete'].includes(status.status)) break;
      await new Promise(resolve => setTimeout(resolve, 250));
    }
    assert.equal(status.status, withGithub ? 'complete' : 'errored',
      `native workflow status: ${JSON.stringify(status)}`);
    const prefix = `backups/${withGithub ? 'synthetic-offsite' : 'synthetic-native'}`;
    const manifestObject = await bucket.get(`${prefix}/manifest.json`);
    assert.ok(manifestObject, `synthetic native workflow failed before manifest: ${JSON.stringify(status)}`);
    const manifest = await manifestObject.json();
    assert.equal(manifest.databases.length, 6);
    for (const entry of manifest.databases) {
      const object = await bucket.get(`${prefix}/${entry.file}`);
      const encrypted = Buffer.from(await object.arrayBuffer());
      assert.equal(createHash('sha256').update(encrypted).digest('hex'), entry.sha256);
      const decrypted = decrypt(encrypted, keys.privateKey);
      const source = expected.get(DATABASES[entry.database]);
      assert.equal(createHash('sha256').update(decrypted.sql).digest('hex'), source.sha256);
      assert.equal(decrypted.metadata.database_id, DATABASES[entry.database]);
      if (entry.database === 'codepi-health') {
        assert.ok(source.bytes > 64 * 1024 * 1024);
        assert.ok(encrypted.length > 16 * 1024 * 1024);
      }
    }
    const report = await (await bucket.get('reports/backup/latest.json')).json();
    assert.equal(report.r2, 'complete');
    assert.equal(report.ok, withGithub);
    assert.equal(!!await bucket.get('reports/backup/offsite-success.json'), withGithub);
  }
  assert.equal(exports.length, 2 * Object.keys(DATABASES).length);
  assert.equal(assets.length, 7);
  assert.equal(assets.at(-1).name, 'manifest.json');
  console.log('PASS native Workflows + multipart R2: 64+ MiB SQL, v1 recovery, missing token failure and streaming offsite copy');
} finally {
  await runtime?.dispose();
  await rm(directory, { recursive: true, force: true });
}
