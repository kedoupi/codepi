import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash, createHmac, generateKeyPairSync, randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { readFile, readdir, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { DATABASES, DATABASE_NAMES, decrypt } from '../../../scripts/cloudflare/backup-core.mjs';
import { restoreBackup } from '../../../scripts/cloudflare/d1-restore.mjs';
import { inspectRestoreSql } from '../../../scripts/cloudflare/d1-restore-sql.mjs';
import { restoreOriginals } from '../../../scripts/cloudflare/originals-restore.mjs';
const require = createRequire(import.meta.url);
const { Miniflare, Response } = createRequire(require.resolve('wrangler'))('miniflare');
const keys = generateKeyPairSync('rsa', { modulusLength: 3072,
  publicKeyEncoding: { type: 'spki', format: 'pem' }, privateKeyEncoding: { type: 'pkcs8', format: 'pem' } });
const directory = await mkdtemp(path.join(tmpdir(), 'codepi-ops-runtime-'));
const sessionSecret = 'synthetic-recovery-session-secret';
const databaseIds = Object.fromEntries(DATABASE_NAMES.map((name, i) => [name,
  DATABASES[name] ?? `99999999-9999-4999-8999-${String(i + 1).padStart(12, '0')}`]));
const originals = [Buffer.from('# Synthetic original\n'), randomBytes(6 * 1024 * 1024)];
const materialRows = originals.map((bytes, i) => {
  const id = `00000000-0000-4000-8000-${String(i + 1).padStart(12, '0')}`;
  return { id, object_key: `materials/${id}`, name: `synthetic-${i}.txt`, content_type: 'text/plain',
    size: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex'), created_at: '2026-10-19T00:00:00Z' };
});
const meOriginals = [Buffer.from('# Synthetic Me import\n'), randomBytes(6 * 1024 * 1024)];
const meRows = meOriginals.map((bytes, i) => {
  const id = `01J${String(i + 1).padStart(23, '0')}`;
  return { id, r2_key: `imports/${id}`, size: bytes.length,
    sha256: createHash('sha256').update(bytes).digest('hex'), created_at: '2026-10-19T00:00:00Z' };
});
const blogOriginals = [Buffer.from('# Synthetic blog media\n'), randomBytes(64 * 1024)];
const blogRows = blogOriginals.map((bytes, i) => {
  const id = `11111111-1111-4111-8111-${String(i + 1).padStart(12, '0')}`;
  return { id, object_key: `media/${id}`, size: bytes.length,
    sha256: createHash('sha256').update(bytes).digest('hex'), created_at: '2026-10-19T00:00:00Z' };
});
const guTarget = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const meTarget = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const blogTarget = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
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
  const meDirectory = path.join(directory, 'me');
  execFileSync('pnpm', ['exec', 'wrangler', 'deploy', '--config', 'test/wrangler.me.toml', '--dry-run',
    '--outdir', meDirectory],
  { stdio: 'pipe', env: { ...process.env, WRANGLER_SEND_METRICS: 'false' } });
  const meSource = await readFile(path.join(meDirectory, 'fixture-me-worker.js'), 'utf8');
  const blogDirectory = path.join(directory, 'blog');
  execFileSync('pnpm', ['exec', 'wrangler', 'deploy', '--config', 'test/wrangler.blog.toml', '--dry-run',
    '--outdir', blogDirectory],
  { stdio: 'pipe', env: { ...process.env, WRANGLER_SEND_METRICS: 'false' } });
  const blogSource = await readFile(path.join(blogDirectory, 'fixture-blog-worker.js'), 'utf8');

  const migrationDirectory = new URL('../../../apps/gu/migrations/', import.meta.url);
  const migrations = await Promise.all((await readdir(migrationDirectory)).filter(file => file.endsWith('.sql')).sort()
    .map(file => readFile(new URL(file, migrationDirectory), 'utf8')));
  const guSql = migrations.join('\n') + '\n' + materialRows.map(row =>
    `INSERT INTO gu_materials(id,object_key,name,content_type,size,sha256,created_at) VALUES('${row.id}','${row.object_key}','${row.name}','${row.content_type}',${row.size},'${row.sha256}','${row.created_at}');`).join('\n');
  const meSchema = `CREATE TABLE imports (
    id TEXT PRIMARY KEY,
    r2_key TEXT NOT NULL,
    bytes INTEGER NOT NULL,
    sha256 TEXT NOT NULL,
    created_at TEXT NOT NULL
  );`;
  const meSql = meSchema + '\n' + meRows.map(row =>
    `INSERT INTO imports(id,r2_key,bytes,sha256,created_at) VALUES('${row.id}','${row.r2_key}',${row.size},'${row.sha256}','${row.created_at}');`).join('\n');
  const blogSchema = `CREATE TABLE blog_media (
    id TEXT PRIMARY KEY,
    object_key TEXT NOT NULL UNIQUE,
    content_type TEXT,
    bytes INTEGER NOT NULL,
    sha256 TEXT NOT NULL,
    created_at TEXT NOT NULL
  );`;
  const blogSql = blogSchema + '\n' + blogRows.map(row =>
    `INSERT INTO blog_media(id,object_key,content_type,bytes,sha256,created_at) VALUES('${row.id}','${row.object_key}','image/png',${row.size},'${row.sha256}','${row.created_at}');`).join('\n');

  const values = object => Object.fromEntries(Object.entries(object).map(([key, value]) => [key, { type: 'json', value }]));
  const guWorker = name => ({ config: {
    name, compatibilityDate: '2026-10-19', compatibilityFlags: ['nodejs_compat'],
    triggers: [{ type: 'fetch', pattern: `${name}.synthetic/*` }],
    manifest: { mainModule: 'index.js', modules: { 'index.js': { type: 'esm', contents: guSource } } },
    exports: { GuMaterialsBackup: { type: 'worker' } },
    env: { DB: { type: 'd1', name: `${name}-gu-db` }, MATERIALS: { type: 'r2', name: `${name}-materials` },
      ...values({ ENVIRONMENT: 'test', SESSION_SECRET: sessionSecret }) },
  } });
  const meWorker = name => ({ config: {
    name, compatibilityDate: '2026-10-19', compatibilityFlags: ['nodejs_compat'],
    triggers: [{ type: 'fetch', pattern: `${name}.synthetic/*` }],
    manifest: { mainModule: 'index.js', modules: { 'index.js': { type: 'esm', contents: meSource } } },
    exports: { MeImportsBackup: { type: 'worker' } },
    env: { DB: { type: 'd1', name: `${name}-me-db` }, IMPORTS: { type: 'r2', name: `${name}-imports` } },
  } });
  const blogWorker = name => ({ config: {
    name, compatibilityDate: '2026-10-19', compatibilityFlags: ['nodejs_compat'],
    triggers: [{ type: 'fetch', pattern: `${name}.synthetic/*` }],
    manifest: { mainModule: 'index.js', modules: { 'index.js': { type: 'esm', contents: blogSource } } },
    exports: { BlogMediaBackup: { type: 'worker' } },
    env: { BLOG: { type: 'd1', name: `${name}-blog-db` }, BLOG_MEDIA: { type: 'r2', name: `${name}-media` } },
  } });
  const exports = [], expected = new Map();
  const rollbackRequests = [];
  let rollbackVersion = 'synthetic-new-version';
  const sqlById = new Map([
    [databaseIds['codepi-gu'], guSql],
    [databaseIds['codepi-me'], meSql],
    [databaseIds['codepi-blog'], blogSql],
  ]);
  runtime = new Miniflare({
    workers: [{
      config: {
        name: 'ops-synthetic', compatibilityDate: '2026-10-19', compatibilityFlags: ['nodejs_compat'],
        triggers: [{ type: 'fetch', pattern: 'ops.synthetic/*' }],
        manifest: { mainModule: 'index.js', modules: { 'index.js': { type: 'esm', contents: source } } },
        exports: { SyntheticWorkflow: { type: 'workflow', name: 'ops-synthetic' } },
        env: {
          ...values({ RECIPIENT: keys.publicKey, CLOUDFLARE_ACCOUNT_ID: 'synthetic-account',
            CLOUDFLARE_API_TOKEN: 'synthetic-token', CLOUDFLARE_ROLLBACK_TOKEN: 'synthetic-rollback-token',
            D1_DATABASE_IDS: JSON.stringify(databaseIds),
            BUILD_SHA: 'synthetic' }),
          BACKUPS: { type: 'r2', name: 'ops-synthetic' },
          GU: { type: 'worker', worker: 'gu-source', exportName: 'GuMaterialsBackup' },
          ME: { type: 'worker', worker: 'me-source', exportName: 'MeImportsBackup' },
          BLOG: { type: 'worker', worker: 'blog-source', exportName: 'BlogMediaBackup' },
          OPERATIONS: { type: 'workflow', name: 'ops-synthetic', worker: 'ops-synthetic', exportName: 'SyntheticWorkflow' },
        },
      },
      dev: { outboundService: { type: 'fetcher', async handler(request) {
        const url = new URL(request.url);
        if (url.hostname === 'api.cloudflare.com' && url.pathname.endsWith('/workers/scripts/codepi-ops-pr-192/deployments')) {
          assert.equal(request.headers.get('authorization'), 'Bearer synthetic-rollback-token');
          rollbackRequests.push(request.method);
          if (request.method === 'POST') {
            assert.deepEqual(await request.json(), { strategy: 'percentage', versions: [{ version_id: 'synthetic-old-version', percentage: 100 }] });
            rollbackVersion = 'synthetic-old-version';
            return Response.json({ success: true, result: {} });
          }
          return Response.json({ success: true, result: { deployments: [{ versions: [{ version_id: rollbackVersion, percentage: 100 }] }] } });
        }
        if (url.hostname === 'api.cloudflare.com' && url.pathname === '/client/v4/graphql') {
          return Response.json({ data: { viewer: { zones: [{ httpRequests1hGroups: [{
            dimensions: { datetime: '2026-10-22T09:00:00Z' }, sum: { requests: 10, threats: 1, bytes: 100 },
            uniq: { uniques: 2 },
          }] }] } } });
        }
        if (url.hostname === 'api.cloudflare.com' && url.pathname.endsWith('/export')) {
          exports.push(url.pathname);
          return Response.json({ success: true, result: { status: 'complete',
            result: { signed_url: `https://synthetic.r2.cloudflarestorage.com/${url.pathname.split('/').at(-2)}` } } });
        }
        if (url.hostname === 'synthetic.r2.cloudflarestorage.com') {
          const id = url.pathname.slice(1), hash = createHash('sha256');
          if (sqlById.has(id)) {
            const bytes = Buffer.from(sqlById.get(id));
            expected.set(id, { sha256: hash.update(bytes).digest('hex'), bytes: bytes.length });
            return new Response(bytes);
          }
          const rows = id === databaseIds['codepi-health'] ? 1024 : 1;
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
        throw new Error('runtime test attempted an unexpected external request');
      } } },
    }, guWorker('gu-source'), guWorker('gu-recovery'),
    meWorker('me-source'), meWorker('me-recovery'),
    blogWorker('blog-source'), blogWorker('blog-recovery')],
  });
  await runtime.ready;
  const rollbackResponse = await runtime.dispatchFetch('https://ops.synthetic/rollback');
  assert.equal(rollbackResponse.status, 200);
  assert.equal((await rollbackResponse.json()).active_version, 'synthetic-old-version');
  assert.deepEqual(rollbackRequests, ['GET', 'POST', 'GET']);
  const bucket = await runtime.getR2Bucket('BACKUPS', 'ops-synthetic');
  const guDb = await runtime.getD1Database('DB', 'gu-source');
  const guBucket = await runtime.getR2Bucket('MATERIALS', 'gu-source');
  const meDb = await runtime.getD1Database('DB', 'me-source');
  const meBucket = await runtime.getR2Bucket('IMPORTS', 'me-source');
  const blogDb = await runtime.getD1Database('BLOG', 'blog-source');
  const blogBucket = await runtime.getR2Bucket('BLOG_MEDIA', 'blog-source');
  const statements = sql => sql.replace(/--[^\n]*/g, '').split(';').filter(part => part.trim());
  await guDb.batch(statements(guSql).map(sql => guDb.prepare(sql)));
  await meDb.batch(statements(meSql).map(sql => meDb.prepare(sql)));
  await blogDb.batch(statements(blogSql).map(sql => blogDb.prepare(sql)));
  for (const [i, row] of materialRows.entries()) await guBucket.put(row.object_key, originals[i]);
  for (const [i, row] of meRows.entries()) await meBucket.put(row.r2_key, meOriginals[i]);
  for (const [i, row] of blogRows.entries()) await blogBucket.put(row.object_key, blogOriginals[i]);
  // Unindexed leftovers from uncertain uploads are excluded from complete backup coverage.
  await guBucket.put('materials/unindexed-synthetic', 'Synthetic orphan');
  await meBucket.put('imports/unindexed-synthetic', 'Synthetic orphan');
  await blogBucket.put('media/unindexed-synthetic', 'Synthetic orphan');

  const result = await runtime.dispatchFetch('https://ops.synthetic/start');
  assert.equal(result.status, 200);
  let status;
  for (let i = 0; i < 240; i++) {
    status = await (await runtime.dispatchFetch('https://ops.synthetic/status')).json();
    if (['errored', 'complete'].includes(status.status)) break;
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  assert.equal(status.status, 'complete', `native workflow status: ${JSON.stringify(status)}`);
  const prefix = 'backups/synthetic-native';
  const manifestObject = await bucket.get(`${prefix}/manifest.json`);
  assert.ok(manifestObject, `native workflow failed before manifest: ${JSON.stringify(status)}`);
  const manifest = await manifestObject.json();
  assert.equal(manifest.version, 4);
  assert.equal(manifest.databases.length, DATABASE_NAMES.length);
  assert.deepEqual(manifest.materials.collections.map(collection => collection.source),
    ['codepi-gu', 'codepi-me', 'codepi-blog']);
  assert.equal(manifest.materials.objects, originals.length + meOriginals.length + blogOriginals.length);
  const originalsBySource = { 'codepi-gu': originals, 'codepi-me': meOriginals, 'codepi-blog': blogOriginals };
  for (const collection of manifest.materials.collections) {
    const sourceOriginals = originalsBySource[collection.source];
    for (const [i, entry] of collection.entries.entries()) {
      const ciphertext = Buffer.from(await (await bucket.get(`${prefix}/materials/${entry.file}`)).arrayBuffer());
      assert.equal(createHash('sha256').update(ciphertext).digest('hex'), entry.sha256);
      const recovered = decrypt(ciphertext, keys.privateKey);
      assert.equal(createHash('sha256').update(recovered.sql).digest('hex'), entry.source_sha256);
      assert.equal(recovered.sql.length, entry.source_bytes);
      assert.deepEqual(recovered.sql, sourceOriginals[i]);
      assert.equal(recovered.metadata.kind, collection.kind);
    }
  }
  for (const entry of manifest.databases) {
    const object = await bucket.get(`${prefix}/${entry.file}`);
    const encrypted = Buffer.from(await object.arrayBuffer());
    assert.equal(createHash('sha256').update(encrypted).digest('hex'), entry.sha256);
    const decrypted = decrypt(encrypted, keys.privateKey);
    const source = expected.get(databaseIds[entry.database]);
    assert.ok(source, `missing synthetic export for ${entry.database}`);
    assert.equal(createHash('sha256').update(decrypted.sql).digest('hex'), source.sha256);
    assert.equal(decrypted.metadata.database_id, databaseIds[entry.database]);
    if (entry.database === 'codepi-health') {
      assert.ok(source.bytes > 64 * 1024 * 1024);
      assert.ok(encrypted.length > 16 * 1024 * 1024);
    }
  }
  const report = await (await bucket.get('reports/backup/latest.json')).json();
  assert.equal(report.r2, 'complete');
  assert.equal(report.ok, true);
  assert.deepEqual([...report.database_names].sort(), [...DATABASE_NAMES].sort());
  assert.deepEqual([...report.materials.sources].sort(), ['codepi-blog', 'codepi-gu', 'codepi-me']);
  const backupDir = path.join(directory, 'download');
  await mkdir(path.join(backupDir, 'materials'), { recursive: true, mode: 0o700 });
  await writeFile(path.join(backupDir, 'manifest.json'), JSON.stringify(manifest), { mode: 0o600 });
  const files = [
    ...manifest.databases.map(entry => entry.file),
    ...manifest.materials.collections.flatMap(collection =>
      collection.entries.map(entry => `materials/${entry.file}`)),
  ];
  for (const file of files) {
    const object = await bucket.get(`${prefix}/${file}`);
    await writeFile(path.join(backupDir, file), Buffer.from(await object.arrayBuffer()), { mode: 0o600 });
  }
  const privateKeyFile = path.join(directory, 'synthetic-recovery.pem');
  await writeFile(privateKeyFile, keys.privateKey, { mode: 0o600 });
  const env = {
    CLOUDFLARE_ACCOUNT_ID: 'synthetic', CLOUDFLARE_API_TOKEN: 'synthetic',
    D1_DATABASE_IDS: JSON.stringify(databaseIds),
  };
  const guRecoveryDb = await runtime.getD1Database('DB', 'gu-recovery');
  const meRecoveryDb = await runtime.getD1Database('DB', 'me-recovery');
  const blogRecoveryDb = await runtime.getD1Database('BLOG', 'blog-recovery');
  let importedSql;
  const localRequest = async (url, init) => {
    try {
      const id = url.match(/\/database\/([^/]+)\/query$/)?.[1];
      const db = id === guTarget ? guRecoveryDb : id === meTarget ? meRecoveryDb : id === blogTarget ? blogRecoveryDb : undefined;
      assert.ok(db, 'unexpected isolated recovery database');
      const body = JSON.parse(init.body);
      if (importedSql && body.sql.includes('SELECT name FROM sqlite_master')) {
        return globalThis.Response.json({
          success: true,
          result: [{ success: true, results: inspectRestoreSql(importedSql).map(table => ({ name: table.name })) }],
        });
      }
      if (importedSql && body.sql.includes('SELECT count(*) AS n FROM')) {
        const tableName = body.sql.match(/FROM "((?:[^"]|"")+)"/)?.[1]?.replaceAll('""', '"');
        const table = inspectRestoreSql(importedSql).find(item => item.name === tableName);
        return globalThis.Response.json({
          success: true,
          result: [{ success: true, results: [{ n: table?.count ?? 0 }] }],
        });
      }
      const result = await db.prepare(body.sql).all();
      return globalThis.Response.json({ success: true, result: [{ success: true, results: result.results }] });
    } catch (error) {
      console.error(`local recovery request failed: ${error.message}`);
      throw error;
    }
  };
  const restoreDatabase = async (database, target, recoveryDb) => {
    await restoreBackup({
      file: path.join(backupDir, `${database}.sql.enc`), privateKeyFile, databaseId: target, env,
      request: localRequest,
      execute: (_command, args) => {
        importedSql = readFileSync(args[args.indexOf('--file') + 1], 'utf8');
        return { status: 0 };
      },
    });
    await recoveryDb.batch(statements(importedSql).map(sql => recoveryDb.prepare(sql)));
  };
  await restoreDatabase('codepi-gu', guTarget, guRecoveryDb);
  await restoreDatabase('codepi-me', meTarget, meRecoveryDb);
  await restoreDatabase('codepi-blog', blogTarget, blogRecoveryDb);

  const outDir = path.join(directory, 'recovered');
  const restored = await restoreOriginals({
    backupDir, privateKeyFile, databaseIds: { 'codepi-gu': guTarget, 'codepi-me': meTarget, 'codepi-blog': blogTarget },
    outDir, env, request: localRequest,
  });
  assert.deepEqual(restored.collections.map(item => [item.source, item.objects, item.indexed, item.extra_objects]), [
    ['codepi-gu', originals.length, originals.length, 0],
    ['codepi-me', meOriginals.length, meOriginals.length, 0],
    ['codepi-blog', blogOriginals.length, blogOriginals.length, 0],
  ]);

  const guRecoveryBucket = await runtime.getR2Bucket('MATERIALS', 'gu-recovery');
  for (const row of materialRows) {
    await guRecoveryBucket.put(row.object_key, await readFile(path.join(outDir, 'codepi-gu', row.object_key)));
  }
  const meRecoveryBucket = await runtime.getR2Bucket('IMPORTS', 'me-recovery');
  for (const [i, row] of meRows.entries()) {
    const bytes = await readFile(path.join(outDir, 'codepi-me', row.r2_key));
    assert.deepEqual(bytes, meOriginals[i]);
    await meRecoveryBucket.put(row.r2_key, bytes);
    const restoredObject = await meRecoveryBucket.get(row.r2_key);
    assert.deepEqual(Buffer.from(await restoredObject.arrayBuffer()), meOriginals[i]);
  }
  const meIndex = await meRecoveryDb.prepare('SELECT id,r2_key,bytes,sha256 FROM imports ORDER BY rowid').all();
  assert.deepEqual(meIndex.results.map(row => row.id), meRows.map(row => row.id));

  const blogRecoveryBucket = await runtime.getR2Bucket('BLOG_MEDIA', 'blog-recovery');
  for (const [i, row] of blogRows.entries()) {
    const bytes = await readFile(path.join(outDir, 'codepi-blog', row.object_key));
    assert.deepEqual(bytes, blogOriginals[i]);
    await blogRecoveryBucket.put(row.object_key, bytes);
    const restoredObject = await blogRecoveryBucket.get(row.object_key);
    assert.deepEqual(Buffer.from(await restoredObject.arrayBuffer()), blogOriginals[i]);
  }
  const blogIndex = await blogRecoveryDb.prepare('SELECT id,object_key,bytes,sha256 FROM blog_media ORDER BY rowid').all();
  assert.deepEqual(blogIndex.results.map(row => row.id), blogRows.map(row => row.id));

  const recovery = await runtime.getWorker('gu-recovery');
  const cookie = '__Host-gu_session=synthetic-recovery-session';
  await guRecoveryDb.prepare('INSERT INTO sessions(id,expires_at) VALUES(?,?)')
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
  console.log('PASS native Workflows + named GU/Me/Blog RPC + multipart R2: D1 exports, 64+ MiB SQL, encrypted GU, Me and blog originals, isolated D1/R2 recovery and authenticated GU downloads');
} finally {
  await runtime?.dispose();
  await rm(directory, { recursive: true, force: true });
}
