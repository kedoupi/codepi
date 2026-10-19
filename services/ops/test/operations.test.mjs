import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { createHash, generateKeyPairSync } from 'node:crypto';
import test from 'node:test';
import { DATABASES, decrypt } from '../../../scripts/cloudflare/backup-core.mjs';
import { assertRecentMonitor, backupFreshness, backupOperation, monitorOperation, scheduleOperation } from '../src/operations.mjs';
import { offsiteRelease } from '../src/offsite.mjs';
import { backupDatabase } from '../src/backup.mjs';
import { bucketFixture, exportRequest, materialFixture } from './fixtures.mjs';

const keys = generateKeyPairSync('rsa', { modulusLength: 3072,
  publicKeyEncoding: { type: 'spki', format: 'pem' }, privateKeyEncoding: { type: 'pkcs8', format: 'pem' } });
const event = { instanceId: 'backup-synthetic' };

function stepFixture() {
  const state = new Map();
  return { state, async do(name, options, fn) {
    fn ??= options;
    if (!state.has(name)) state.set(name, await fn());
    return state.get(name);
  } };
}
const exportStub = (name, id, publicKey, time, options) => backupDatabase(name, id, publicKey, time, {
  ...options, accountId: 'acct', token: 'synthetic',
  request: exportRequest(() => 'CREATE TABLE synthetic(id);'),
});

test('partial exports never publish a manifest and resuming does not re-export completed databases', async () => {
  const bucket = bucketFixture(), step = stepFixture(), calls = [];
  const env = { BACKUPS: bucket, GU: materialFixture() };
  let fail = true;
  const exportOne = async (name, ...args) => {
    calls.push(name);
    if (name === 'codepi-gu' && fail) throw new Error('synthetic failure');
    return exportStub(name, ...args);
  };
  await assert.rejects(backupOperation(env, step, event, keys.publicKey, { exportOne }), /synthetic/);
  assert.equal(bucket.data.has(`backups/${event.instanceId}/manifest.json`), false);
  assert.equal(bucket.data.has('reports/backup/r2-success.json'), false);
  fail = false;
  await assert.rejects(backupOperation(env, step, event, keys.publicKey, { exportOne }), /GITHUB_TOKEN/);
  assert.equal(calls.filter(name => name === 'codepi-auth').length, 1);
  const manifest = await (await bucket.get(`backups/${event.instanceId}/manifest.json`)).json();
  assert.equal(manifest.databases.length, 6);
  assert.equal(manifest.materials.objects, 1);
  for (const entry of manifest.databases) {
    const object = await bucket.get(`backups/${event.instanceId}/${entry.file}`);
    assert.equal(decrypt(object.bytes, keys.privateKey).sql.toString(), 'CREATE TABLE synthetic(id);');
  }
  const report = await (await bucket.get('reports/backup/latest.json')).json();
  assert.equal(report.ok, false);
  assert.equal(report.r2, 'complete');
  assert.equal(report.offsite, 'failed');
  assert.equal(bucket.data.has('reports/backup/offsite-success.json'), false);
  assert.doesNotMatch(JSON.stringify([...step.state.values()]), /CREATE TABLE|signed_url|wrapped_key|PRIVATE KEY/);
  const fresh = await backupFreshness(bucket);
  assert.equal(fresh[0].ok, true);
  assert.equal(fresh[1].ok, false);
});

test('a put followed by an interrupted workflow reuses the existing ciphertext', async () => {
  const bucket = bucketFixture(), step = stepFixture();
  const env = { BACKUPS: bucket, GU: materialFixture() };
  await assert.rejects(backupOperation(env, step, event, keys.publicKey, { exportOne: exportStub }), /GITHUB_TOKEN/);
  for (const name of Object.keys(DATABASES)) step.state.delete(`encrypted export ${name}`);
  await assert.rejects(backupOperation(env, step, event, keys.publicKey, {
    exportOne: (name, id, publicKey, time, options) => backupDatabase(name, id, publicKey, time, {
      ...options, request: () => { throw new Error('must reuse saved ciphertext'); },
    }),
  }), /GITHUB_TOKEN/);
});

test('a paused instance cannot publish success after its ciphertext expires or its recipient changes', async () => {
  const bucket = bucketFixture(), step = stepFixture(), env = { BACKUPS: bucket, GU: materialFixture() };
  const originalPut = bucket.put.bind(bucket);
  let interrupt = true;
  bucket.put = async (key, ...args) => {
    if (key.endsWith('/manifest.json') && interrupt) throw new Error('synthetic pause before manifest');
    return originalPut(key, ...args);
  };
  await assert.rejects(backupOperation(env, step, event, keys.publicKey, { exportOne: exportStub }), /pause/);
  interrupt = false;
  bucket.data.delete(`backups/${event.instanceId}/codepi-auth.sql.enc`);
  await assert.rejects(backupOperation(env, step, event, keys.publicKey, { exportOne: exportStub }), /missing or changed/);
  assert.equal(bucket.data.has('reports/backup/r2-success.json'), false);
  const other = generateKeyPairSync('rsa', { modulusLength: 3072,
    publicKeyEncoding: { type: 'spki', format: 'pem' } });
  await assert.rejects(backupOperation(env, step, event, other.publicKey, { exportOne: exportStub }), /recipient changed/);
});

test('monitor preserves failed assertions in its private report and rejects skipped checks', async () => {
  const env = { BACKUPS: bucketFixture(), BUILD_SHA: 'synthetic' };
  await assert.rejects(monitorOperation(env, stepFixture(), { instanceId: 'monitor-synthetic' }, {
    monitor: async () => [{ name: 'auth', ok: true }, { name: 'SSO', ok: false, detail: 'unavailable' },
      { name: 'versions', ok: true, skipped: 'missing token' }],
  }), /production checks failed/);
  const report = await (await env.BACKUPS.get('reports/monitor/latest.json')).json();
  assert.equal(report.ok, false);
  assert.ok(report.results.some(result => result.name === 'SSO' && !result.ok));
});

test('freshness rejects stale and incomplete backups', async () => {
  const bucket = bucketFixture();
  for (const item of [
    { completed_at: new Date(Date.now() - 31 * 3600000).toISOString(), databases: 6 },
    { completed_at: new Date().toISOString(), databases: 5 },
    { completed_at: new Date().toISOString(), databases: 6 },
  ]) {
    await bucket.put('reports/backup/r2-success.json', JSON.stringify(item));
    assert.equal((await backupFreshness(bucket))[0].ok, false);
  }
});

test('missing, corrupted or interrupted GU originals cannot publish a complete manifest', async () => {
  for (const kind of ['binding', 'missing', 'size', 'digest', 'stream']) {
    const bucket = bucketFixture(), gu = materialFixture();
    if (kind === 'missing') gu.readMaterial = async () => { throw new Error('PRIVATE CONTENT'); };
    if (kind === 'size') gu.rows[0].size++;
    if (kind === 'digest') gu.rows[0].sha256 = '0'.repeat(64);
    if (kind === 'stream') gu.readMaterial = async () => new ReadableStream({
      pull(controller) { controller.error(new Error('PRIVATE CONTENT')); },
    });
    await assert.rejects(backupOperation({ BACKUPS: bucket, ...(kind === 'binding' ? {} : { GU: gu }) },
      stepFixture(), event, keys.publicKey, { exportOne: exportStub }),
    error => /GU material/.test(error.message) && !error.message.includes('PRIVATE CONTENT'));
    assert.equal(bucket.data.has(`backups/${event.instanceId}/manifest.json`), false);
    assert.equal(bucket.data.has('reports/backup/r2-success.json'), false);
  }
});

test('material ciphertext is reused after a receipt interruption and expiration prevents completion', async () => {
  const bucket = bucketFixture(), step = stepFixture(), gu = materialFixture(), put = bucket.put.bind(bucket);
  let interrupted = true, reads = 0;
  const read = gu.readMaterial.bind(gu);
  gu.readMaterial = async id => { reads++; return read(id); };
  bucket.put = async (key, ...args) => {
    if (interrupted && key.includes('/materials/') && key.endsWith('.receipt.json')) throw new Error('synthetic pause');
    return put(key, ...args);
  };
  const run = () => backupOperation({ BACKUPS: bucket, GU: gu }, step, event, keys.publicKey, { exportOne: exportStub });
  await assert.rejects(run(), /synthetic pause/);
  interrupted = false;
  await assert.rejects(run(), /GITHUB_TOKEN/);
  assert.equal(reads, 1);
  const manifest = await (await bucket.get(`backups/${event.instanceId}/manifest.json`)).json();
  const entry = manifest.materials.entries[0], key = `backups/${event.instanceId}/materials/${entry.file}`;
  const recovered = decrypt(bucket.data.get(key).bytes, keys.privateKey);
  assert.equal(recovered.sql.toString(), 'Synthetic private material');
  assert.equal(recovered.metadata.source_sha256, gu.rows[0].sha256);
  assert.doesNotMatch(JSON.stringify([...step.state.values()]), /Synthetic private material|PRIVATE KEY|wrapped_key/);
  bucket.data.delete(key);
  step.state.delete('commit R2 backup manifest');
  await assert.rejects(run(), /missing or changed/);
});

test('scheduled invocation alarms on failed, stale or absent monitor reports', async () => {
  const bucket = bucketFixture();
  await assert.rejects(assertRecentMonitor(bucket), /no monitor report/);
  const completed_at = new Date().toISOString();
  await bucket.put('reports/monitor/latest.json', JSON.stringify({ completed_at, ok: false }));
  await assert.rejects(assertRecentMonitor(bucket), /monitor is failing/);
  await bucket.put('reports/monitor/latest.json', JSON.stringify({ completed_at, ok: true }));
  await assertRecentMonitor(bucket);
  await assert.rejects(assertRecentMonitor(bucket, Date.now() + 76 * 60000), /stale/);
});

test('Cron delivery creates deterministic instance IDs and handles duplicate delivery only if it exists', async () => {
  const calls = [], instances = new Set();
  const env = { OPERATIONS: {
    async create(options) {
      if (instances.has(options.id)) throw new Error('already exists');
      instances.add(options.id); calls.push(options);
    },
    async get(id) { return { async status() { assert.ok(instances.has(id)); return { status: 'running' }; } }; },
  } };
  const controller = { cron: '0 18 * * *', scheduledTime: Date.UTC(2026, 9, 19, 18) };
  const first = await scheduleOperation(controller, env);
  assert.deepEqual(await scheduleOperation(controller, env), first);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].params.kind, 'backup');
  assert.equal((await scheduleOperation({ ...controller, cron: '*/30 * * * *' }, env)).kind, 'monitor');
  await assert.rejects(scheduleOperation({ ...controller, cron: '* * * * *' }, env), /unknown/);
  await assert.rejects(scheduleOperation(controller, { OPERATIONS: {
    create: async () => { throw new Error('offline'); }, get: async () => { throw new Error('offline'); },
  } }), /offline/);
});

test('export rejects excessive plaintext without printing a signed URL', async () => {
  const options = { accountId: 'acct', token: 'synthetic', maxBytes: 5, bucket: bucketFixture(), key: 'oversized',
    request: async url => new URL(url).hostname === 'api.cloudflare.com'
      ? Response.json({ success: true, result: { status: 'complete',
        result: { signed_url: 'https://export.r2.cloudflarestorage.com/data?SECRET' } } })
      : new Response('too much synthetic SQL') };
  await assert.rejects(backupDatabase('synthetic', 'db', keys.publicKey, 'date', options), error =>
    /streaming size limit/.test(error.message) && !error.message.includes('SECRET'));
});

test('offsite uploads ciphertext and manifest last; retries verify digests and never overwrite a mismatch', async () => {
  const bucket = bucketFixture(), assets = [], writes = [];
  const materialFile = 'gu-material-00000000-0000-4000-8000-000000000001.bin.enc';
  const manifest = { databases: [{ file: 'codepi-auth.sql.enc',
    sha256: createHash('sha256').update('ciphertext').digest('hex') }],
  materials: { entries: [{ file: materialFile, sha256: createHash('sha256').update('material ciphertext').digest('hex') }] } };
  const prefix = 'backups/synthetic';
  await bucket.put(`${prefix}/codepi-auth.sql.enc`, Buffer.from('ciphertext'));
  await bucket.put(`${prefix}/materials/${materialFile}`, Buffer.from('material ciphertext'));
  await bucket.put(`${prefix}/manifest.json`, JSON.stringify(manifest));
  let exists = false;
  const request = async (url, init) => {
    const u = new URL(url);
    if (u.hostname === 'uploads.github.com') {
      const name = u.searchParams.get('name');
      writes.push(name);
      assert.ok(init.body instanceof ReadableStream);
      const bytes = Buffer.from(await new Response(init.body).arrayBuffer());
      assert.equal(Number(init.headers['content-length']), bytes.length);
      const asset = { name, state: 'uploaded', digest: `sha256:${createHash('sha256').update(bytes).digest('hex')}` };
      assets.push(asset);
      return Response.json(asset);
    }
    if (u.pathname.includes('/releases/tags/')) return exists
      ? Response.json({ id: 42, tag_name: 'ops-backup-synthetic' }) : new Response('', { status: 404 });
    if (init.method === 'POST') { exists = true; return Response.json({ id: 42, tag_name: 'ops-backup-synthetic' }); }
    return Response.json(assets);
  };
  const run = () => offsiteRelease(manifest, prefix, bucket, { token: 'synthetic', request });
  assert.equal((await run()).assets, 3);
  assert.deepEqual(writes, ['codepi-auth.sql.enc', materialFile, 'manifest.json']);
  await run();
  assert.equal(writes.length, 3);
  assets[0].digest = 'sha256:wrong';
  await assert.rejects(run(), /cannot be verified/);
  assert.equal(writes.length, 3);
});
