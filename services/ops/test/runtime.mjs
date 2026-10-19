import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash, createHmac, generateKeyPairSync, randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { readFile, readdir, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { decrypt, DATABASES } from '../../../scripts/cloudflare/backup-core.mjs';
import { restoreBackup } from '../../../scripts/cloudflare/d1-restore.mjs';
import { restoreMaterials } from '../../../scripts/cloudflare/gu-materials-restore.mjs';

const require = createRequire(import.meta.url);
const { Miniflare, Response } = createRequire(require.resolve('wrangler'))('miniflare');
const keys = generateKeyPairSync('rsa', { modulusLength: 3072,
  publicKeyEncoding: { type: 'spki', format: 'pem' }, privateKeyEncoding: { type: 'pkcs8', format: 'pem' } });
const directory = await mkdtemp(path.join(tmpdir(), 'codepi-ops-runtime-'));
const sessionSecret = 'synthetic-recovery-session-secret';
const originals = [Buffer.from('# Synthetic original\n'), randomBytes(6 * 1024 * 1024)];
const materialRows = originals.map((bytes, i) => {
  const id = `00000000-0000-4000-8000-${String(i + 1).padStart(12, '0')}`;
  return { id, object_key: `materials/${id}`, name: `synthetic-${i}.txt`, content_type: 'text/plain',
    size: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex'), created_at: '2026-10-19T00:00:00Z' };
});
let runtime;
try {
  execFileSync('pnpm', ['exec', 'wrangler', 'deploy', '--config', 'test/wrangler.toml', '--dry-run', '--outdir', directory],
    { stdio: 'pipe', env: { ...process.env, WRANGLER_SEND_METRICS: 'false' } });
  const source = await readFile(path.join(directory, 'fixture-worker.js'), 'utf8');
  const guDirectory = path.join(directory, 'gu');
  execFileSync('pnpm', ['--dir', '../../apps/gu', 'exec', 'wrangler', 'deploy', '--config', 'wrangler.test.toml',
    '--dry-run', '--outdir', guDirectory],
  { stdio: 'pipe', env: { ...process.env, WRANGLER_SEND_METRICS: 'false' } });
  const guSource = await readFile(path.join(guDirectory, 'index.js'), 'utf8');
  const migrationDirectory = new URL('../../../apps/gu/migrations/', import.meta.url);
  const migrations = await Promise.all((await readdir(migrationDirectory)).filter(file => file.endsWith('.sql')).sort()
    .map(file => readFile(new URL(file, migrationDirectory), 'utf8')));
  const guSql = migrations.join('\n') + '\n' + materialRows.map(row =>
    `INSERT INTO gu_materials(id,object_key,name,content_type,size,sha256,created_at) VALUES('${row.id}','${row.object_key}','${row.name}','${row.content_type}',${row.size},'${row.sha256}','${row.created_at}');`).join('\n');
  const values = object => Object.fromEntries(Object.entries(object).map(([key, value]) => [key, { type: 'json', value }]));
  const guWorker = name => ({ config: {
    name, compatibilityDate: '2026-10-19', compatibilityFlags: ['nodejs_compat'],
    triggers: [{ type: 'fetch', pattern: `${name}.synthetic/*` }],
    manifest: { mainModule: 'index.js', modules: { 'index.js': { type: 'esm', contents: guSource } } },
    exports: { GuMaterialsBackup: { type: 'worker' } },
    env: { DB: { type: 'd1', name: `${name}-db` }, MATERIALS: { type: 'r2', name: `${name}-materials` },
      ...values({ ENVIRONMENT: 'test', SESSION_SECRET: sessionSecret }) },
  } });
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
          GU: { type: 'worker', worker: 'gu-source', exportName: 'GuMaterialsBackup' },
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
          if (id === DATABASES['codepi-gu']) {
            const bytes = Buffer.from(guSql);
            expected.set(id, { sha256: hash.update(bytes).digest('hex'), bytes: bytes.length });
            return new Response(bytes);
          }
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
    }, guWorker('gu-source'), guWorker('gu-recovery')],
  });
  await runtime.ready;
  const bucket = await runtime.getR2Bucket('BACKUPS', 'ops-synthetic');
  const guDb = await runtime.getD1Database('DB', 'gu-source');
  const guBucket = await runtime.getR2Bucket('MATERIALS', 'gu-source');
  const statements = sql => sql.replace(/--[^\n]*/g, '').split(';').filter(part => part.trim());
  await guDb.batch(statements(guSql).map(sql => guDb.prepare(sql)));
  for (const [i, row] of materialRows.entries()) await guBucket.put(row.object_key, originals[i]);
  // Unindexed leftovers from an uncertain upload are retained by GU but cannot
  // be presented as indexed originals in a backup.
  await guBucket.put('materials/unindexed-synthetic', 'Synthetic orphan');
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
    assert.equal(manifest.materials.objects, originals.length);
    for (const entry of manifest.materials.entries) {
      const ciphertext = Buffer.from(await (await bucket.get(`${prefix}/materials/${entry.file}`)).arrayBuffer());
      assert.equal(createHash('sha256').update(ciphertext).digest('hex'), entry.sha256);
      const recovered = decrypt(ciphertext, keys.privateKey);
      assert.equal(createHash('sha256').update(recovered.sql).digest('hex'), entry.source_sha256);
      assert.equal(recovered.sql.length, entry.source_bytes);
    }
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
  assert.equal(assets.length, 7 + originals.length);
  assert.equal(assets.at(-1).name, 'manifest.json');

  const prefix = 'backups/synthetic-offsite';
  const manifest = await (await bucket.get(`${prefix}/manifest.json`)).json();
  const backupDir = path.join(directory, 'download');
  await mkdir(path.join(backupDir, 'materials'), { recursive: true, mode: 0o700 });
  await writeFile(path.join(backupDir, 'manifest.json'), JSON.stringify(manifest), { mode: 0o600 });
  for (const file of ['codepi-gu.sql.enc', ...manifest.materials.entries.map(entry => `materials/${entry.file}`)]) {
    const object = await bucket.get(`${prefix}/${file}`);
    await writeFile(path.join(backupDir, file), Buffer.from(await object.arrayBuffer()), { mode: 0o600 });
  }
  const privateKeyFile = path.join(directory, 'synthetic-recovery.pem');
  await writeFile(privateKeyFile, keys.privateKey, { mode: 0o600 });
  const databaseId = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
  const env = { CLOUDFLARE_ACCOUNT_ID: 'synthetic', CLOUDFLARE_API_TOKEN: 'synthetic' };
  const recoveryDb = await runtime.getD1Database('DB', 'gu-recovery');
  let importedSql;
  await restoreBackup({ file: path.join(backupDir, 'codepi-gu.sql.enc'), privateKeyFile, databaseId, env,
    request: async () => {
      const result = await recoveryDb.prepare("SELECT count(*) AS n FROM sqlite_master WHERE type IN ('table','view') AND name NOT GLOB '_cf_*' AND name NOT GLOB 'sqlite_*'").all();
      return globalThis.Response.json({ success: true, result: [{ success: true, results: result.results }] });
    },
    execute: (_command, args) => {
      // Execute the recovered SQL through the native local D1 API below.
      importedSql = readFileSync(args[args.indexOf('--file') + 1], 'utf8');
      return { status: 0 };
    },
  });
  await recoveryDb.batch(statements(importedSql).map(sql => recoveryDb.prepare(sql)));
  const outDir = path.join(directory, 'recovered');
  const restored = await restoreMaterials({ backupDir, privateKeyFile, databaseId, outDir, env,
    request: async () => {
      const result = await recoveryDb.prepare('SELECT id,object_key,size,sha256 FROM gu_materials ORDER BY object_key').all();
      return globalThis.Response.json({ success: true, result: [{ success: true, results: result.results }] });
    },
  });
  assert.equal(restored.indexed, originals.length);
  const recoveryBucket = await runtime.getR2Bucket('MATERIALS', 'gu-recovery');
  for (const row of materialRows) await recoveryBucket.put(row.object_key, await readFile(path.join(outDir, row.object_key)));
  const recovery = await runtime.getWorker('gu-recovery');
  const cookie = '__Host-gu_session=synthetic-recovery-session';
  await recoveryDb.prepare('INSERT INTO sessions(id,expires_at) VALUES(?,?)')
    .bind(createHmac('sha256', sessionSecret).update('synthetic-recovery-session').digest('hex'), Date.now() + 3600000).run();
  for (const [i, row] of materialRows.entries()) {
    const url = `https://gu-recovery.synthetic/api/materials/${row.id}`;
    assert.equal((await recovery.fetch(url)).status, 401);
    const downloaded = await recovery.fetch(url, { headers: { Cookie: cookie } });
    assert.equal(downloaded.status, 200);
    assert.equal(downloaded.headers.get('cache-control'), 'no-store');
    assert.match(downloaded.headers.get('content-disposition'), /^attachment;/);
    assert.deepEqual(Buffer.from(await downloaded.arrayBuffer()), originals[i]);
  }
  for (const url of ['/api/internal/materials-backup', '/api/internal/backup/materials']) {
    assert.equal((await recovery.fetch(`https://gu-recovery.synthetic${url}`)).status, 401);
    assert.equal((await recovery.fetch(`https://gu-recovery.synthetic${url}`, { headers: { Cookie: cookie } })).status, 404);
  }
  console.log('PASS native Workflows + named GU RPC + multipart R2: 64+ MiB SQL, encrypted originals, offsite digests, isolated D1/R2 recovery and authenticated downloads');
} finally {
  await runtime?.dispose();
  await rm(directory, { recursive: true, force: true });
}
