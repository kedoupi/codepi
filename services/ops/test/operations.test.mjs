import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { createHash, generateKeyPairSync } from 'node:crypto';
import test from 'node:test';
import { DATABASES, DATABASE_NAMES, decrypt } from '../../../scripts/cloudflare/backup-core.mjs';
import { buildReleaseManifest } from '../../../scripts/cloudflare/release-observation.mjs';
import {
  assertRecentMonitor,
  backupFreshness,
  backupOperation,
  isBlockingMonitorResult,
  monitorOperation,
  observeOperation,
  scheduleOperation,
  settledStepResult,
} from '../src/operations.mjs';
import { backupDatabase } from '../src/backup.mjs';
import { bucketFixture, exportRequest, materialFixture } from './fixtures.mjs';

const keys = generateKeyPairSync('rsa', { modulusLength: 3072,
  publicKeyEncoding: { type: 'spki', format: 'pem' }, privateKeyEncoding: { type: 'pkcs8', format: 'pem' } });
const event = { instanceId: 'backup-synthetic' };
const databaseIds = Object.fromEntries(DATABASE_NAMES.map((name, i) => [name,
  DATABASES[name] ?? `99999999-9999-4999-8999-${String(i + 1).padStart(12, '0')}`]));
const baseEnv = {
  CLOUDFLARE_ACCOUNT_ID: 'acct',
  CLOUDFLARE_API_TOKEN: 'synthetic',
  D1_DATABASE_IDS: JSON.stringify(databaseIds),
};
const meFixture = bodies => materialFixture(bodies, { prefix: 'imports', idKind: 'ulid' });

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

test('Workflow RPC results are cloned and disposed before their stubs can accumulate', async () => {
  const value = { nested: { value: 1 } };
  let disposed = 0;
  Object.defineProperty(value, Symbol.dispose, {
    value() { disposed++; },
  });
  const copied = await settledStepResult(Promise.resolve(value));
  assert.deepEqual(copied, { nested: { value: 1 } });
  assert.equal(disposed, 1);
  assert.equal(Object.hasOwn(copied, Symbol.dispose), false);
});

test('partial exports never publish a manifest and resuming does not re-export completed databases', async () => {
  const bucket = bucketFixture(), step = stepFixture(), calls = [];
  const env = { ...baseEnv, BACKUPS: bucket, GU: materialFixture(), ME: meFixture([]) };
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
  await backupOperation(env, step, event, keys.publicKey, { exportOne });
  assert.equal(calls.filter(name => name === 'codepi-auth').length, 1);
  const manifest = await (await bucket.get(`backups/${event.instanceId}/manifest.json`)).json();
  assert.equal(manifest.databases.length, DATABASE_NAMES.length);
  assert.equal(manifest.materials.objects, 1);
  for (const entry of manifest.databases) {
    const object = await bucket.get(`backups/${event.instanceId}/${entry.file}`);
    assert.equal(decrypt(object.bytes, keys.privateKey).sql.toString(), 'CREATE TABLE synthetic(id);');
  }
  const report = await (await bucket.get('reports/backup/latest.json')).json();
  assert.equal(report.ok, true);
  assert.equal(report.r2, 'complete');
  assert.doesNotMatch(JSON.stringify([...step.state.values()]), /CREATE TABLE|signed_url|wrapped_key|PRIVATE KEY/);
  const fresh = await backupFreshness(bucket);
  assert.equal(fresh[0].ok, true);
});

test('a put followed by an interrupted workflow reuses the existing ciphertext', async () => {
  const bucket = bucketFixture(), step = stepFixture();
  const env = { ...baseEnv, BACKUPS: bucket, GU: materialFixture(), ME: meFixture([]) };
  await backupOperation(env, step, event, keys.publicKey, { exportOne: exportStub });
  for (const name of Object.keys(DATABASES)) step.state.delete(`encrypted export ${name}`);
  await backupOperation(env, step, event, keys.publicKey, {
    exportOne: (name, id, publicKey, time, options) => backupDatabase(name, id, publicKey, time, {
      ...options, request: () => { throw new Error('must reuse saved ciphertext'); },
    }),
  });
});

test('a paused instance cannot publish success after its ciphertext expires or its recipient changes', async () => {
  const bucket = bucketFixture(), step = stepFixture(), env = {
    ...baseEnv, BACKUPS: bucket, GU: materialFixture(), ME: meFixture([]),
  };
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

test('monitor preserves failures and appends traffic results in its private report', async () => {
  const env = { BACKUPS: bucketFixture(), BUILD_SHA: 'synthetic' };
  await assert.rejects(monitorOperation(env, stepFixture(), { instanceId: 'monitor-synthetic' }, {
    monitor: async () => [{ name: 'auth', ok: true }, { name: 'SSO', ok: false, detail: 'unavailable' }],
    trafficCheck: async () => [{ name: 'zone traffic threats exceed threshold', ok: false, detail: 'denied' },
      { name: 'zone traffic requests surge', ok: false, detail: 'denied' }],
  }), /production checks failed/);
  const report = await (await env.BACKUPS.get('reports/monitor/latest.json')).json();
  assert.equal(report.ok, false);
  assert.equal(report.results.filter(result => result.name.startsWith('zone traffic')).length, 2);
  // Backup freshness must stay in the monitor report alongside traffic results.
  assert.equal(report.results.filter(result => result.name.includes('backup completed within 30 hours')).length, 1);
});
test('advisory threat alerts remain in the report without failing the monitor', async () => {
  const env = { BACKUPS: bucketFixture(), BUILD_SHA: 'synthetic' };
  await env.BACKUPS.put('backups/advisory-synthetic/manifest.json', '{}');
  await env.BACKUPS.put('reports/backup/r2-success.json', JSON.stringify({
    completed_at: new Date().toISOString(), prefix: 'backups/advisory-synthetic',
    databases: DATABASE_NAMES.length, database_names: DATABASE_NAMES,
    materials: { sources: ['codepi-gu', 'codepi-me'], objects: 0 },
  }));
  const traffic = [
    { name: 'zone traffic threats exceed threshold', ok: false, advisory: true, detail: 'scan denied' },
    { name: 'zone traffic requests surge', ok: true },
  ];
  assert.equal(isBlockingMonitorResult(traffic[0]), false);
  assert.equal(isBlockingMonitorResult(traffic[1]), false);
  await monitorOperation(env, stepFixture(), { instanceId: 'monitor-advisory' }, {
    monitor: async () => [{ name: 'auth', ok: true }],
    trafficCheck: async () => traffic,
  });
  const report = await (await env.BACKUPS.get('reports/monitor/latest.json')).json();
  assert.equal(report.ok, true);
  assert.deepEqual(report.results.filter(result => result.name.startsWith('zone traffic')), traffic);
});

test('freshness rejects stale and incomplete backups and requires its manifest', async () => {
  const bucket = bucketFixture();
  const complete = {
    completed_at: new Date().toISOString(),
    prefix: 'backups/freshness-synthetic',
    databases: DATABASE_NAMES.length,
    database_names: DATABASE_NAMES,
    materials: { sources: ['codepi-gu', 'codepi-me'], objects: 0 },
  };
  for (const item of [
    { ...complete, completed_at: new Date(Date.now() - 31 * 3600000).toISOString() },
    { ...complete, databases: DATABASE_NAMES.length - 1 },
    { ...complete, database_names: DATABASE_NAMES.slice(0, -1) },
    { ...complete, materials: { sources: ['codepi-gu'], objects: 0 } },
  ]) {
    await bucket.put('reports/backup/r2-success.json', JSON.stringify(item));
    assert.equal((await backupFreshness(bucket))[0].ok, false);
  }
  await bucket.put('reports/backup/r2-success.json', JSON.stringify(complete));
  assert.equal((await backupFreshness(bucket))[0].ok, false);
  await bucket.put('backups/freshness-synthetic/manifest.json', '{}');
  assert.equal((await backupFreshness(bucket))[0].ok, true);

  for (const prefix of [undefined, 'backups/../secrets', 'backups/valid/extra']) {
    const report = { ...complete };
    if (prefix === undefined) delete report.prefix;
    else report.prefix = prefix;
    await bucket.put('reports/backup/r2-success.json', JSON.stringify(report));
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
    await assert.rejects(backupOperation({
      ...baseEnv, BACKUPS: bucket, ME: meFixture([]),
      ...(kind === 'binding' ? {} : { GU: gu }),
    },
      stepFixture(), event, keys.publicKey, { exportOne: exportStub }),
    error => /codepi-gu original/.test(error.message) && !error.message.includes('PRIVATE CONTENT'));
    assert.equal(bucket.data.has(`backups/${event.instanceId}/manifest.json`), false);
    assert.equal(bucket.data.has('reports/backup/r2-success.json'), false);
  }
});

test('Me imports are encrypted alongside GU and missing ME coverage cannot publish a manifest', async () => {
  const bucket = bucketFixture(), me = meFixture(['Synthetic Me import one', 'Synthetic Me import two']);
  const env = { ...baseEnv, BACKUPS: bucket, GU: materialFixture([]), ME: me };
  await backupOperation(env, stepFixture(), event, keys.publicKey, { exportOne: exportStub });
  const manifest = await (await bucket.get(`backups/${event.instanceId}/manifest.json`)).json();
  assert.equal(manifest.version, 3);
  assert.deepEqual(manifest.materials.collections.map(collection => collection.source), ['codepi-gu', 'codepi-me']);
  const meCollection = manifest.materials.collections.find(collection => collection.source === 'codepi-me');
  assert.equal(meCollection.objects, 2);
  for (const [index, entry] of meCollection.entries.entries()) {
    assert.equal(entry.kind, 'me-import');
    const recovered = decrypt(bucket.data.get(`backups/${event.instanceId}/materials/${entry.file}`).bytes,
      keys.privateKey);
    assert.equal(recovered.sql.toString(), `Synthetic Me import ${index === 0 ? 'one' : 'two'}`);
    assert.equal(recovered.metadata.kind, 'me-import');
  }
  await assert.rejects(backupOperation({ ...baseEnv, BACKUPS: bucketFixture(), GU: materialFixture([]), ME: undefined },
    stepFixture(), event, keys.publicKey, { exportOne: exportStub }), /codepi-me original backup binding/);
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
  const run = () => backupOperation({
    ...baseEnv, BACKUPS: bucket, GU: gu, ME: meFixture([]),
  }, step, event, keys.publicKey, { exportOne: exportStub });
  await assert.rejects(run(), /synthetic pause/);
  interrupted = false;
  await run();
  assert.equal(reads, 1);
  const manifest = await (await bucket.get(`backups/${event.instanceId}/manifest.json`)).json();
  const guCollection = manifest.materials.collections.find(collection => collection.source === 'codepi-gu');
  const entry = guCollection.entries[0], key = `backups/${event.instanceId}/materials/${entry.file}`;
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

test('observe workflow completes a healthy window and writes a summary', async () => {
  const bucket = bucketFixture();
  const step = { ...stepFixture(), async sleep() {} };
  const manifest = buildReleaseManifest({
    sourceSha: 'a'.repeat(40), startedAt: new Date().toISOString(), nonce: 'synthetic',
    services: [{
      service: 'auth', script: 'codepi-auth', previous_version: 'prev-v', new_version: 'new-v',
      previous_build_sha: 'b'.repeat(40), new_build_sha: 'a'.repeat(40), smoke: 'pass',
      migration_applied: false, secret_changed: false, binding_changed: false, external_side_effects: false,
    }],
  });
  const observability = {
    async listIssues() { return []; },
    async queryWorkerMetrics() {
      return { invocations: 100, errors: 0, errorRate: 0, p95LatencyMs: 10, p99LatencyMs: 20,
        cpuP95Ms: 1, cpuP99Ms: 2, wallTimeP95Ms: 5, wallTimeP99Ms: 8 };
    },
  };
  const notifications = [];
  const summary = await observeOperation({ ...baseEnv, BACKUPS: bucket }, step,
    { payload: { kind: 'observe', manifest } }, {
      observability,
      notify: async event => { notifications.push(event); return { issueNumber: 1, commentId: 1 }; },
      coreCheck: async () => [{ name: 'core', ok: true }],
      activeVersionCheck: async () => 'new-v',
    });
  assert.equal(summary.state, 'healthy_reported');
  assert.ok(notifications.some(item => item.severity === 'started'));
  assert.ok(notifications.some(item => item.severity === 'healthy_reported'));
});

test('observe marks critical findings rollback_blocked when the manifest disallows rollback', async () => {
  const bucket = bucketFixture();
  const step = { ...stepFixture(), async sleep() {} };
  const manifest = buildReleaseManifest({
    sourceSha: 'a'.repeat(40), startedAt: new Date().toISOString(), nonce: 'synthetic',
    services: [{
      service: 'auth', script: 'codepi-auth', previous_version: 'prev-v', new_version: 'new-v',
      previous_build_sha: 'b'.repeat(40), new_build_sha: 'a'.repeat(40), smoke: 'pass',
      migration_applied: true, secret_changed: false, binding_changed: false, external_side_effects: false,
    }],
  });
  const observability = {
    async listIssues() { return []; },
    async queryWorkerMetrics() {
      return { invocations: 100, errors: 50, errorRate: 0.5, p95LatencyMs: 10, p99LatencyMs: 20,
        cpuP95Ms: 1, cpuP99Ms: 2, wallTimeP95Ms: 5, wallTimeP99Ms: 8 };
    },
  };
  const notifications = [];
  const summary = await observeOperation({ ...baseEnv, BACKUPS: bucket }, step,
    { payload: { kind: 'observe', manifest } }, {
      observability,
      notify: async event => { notifications.push(event); return { issueNumber: 1, commentId: 1 }; },
      coreCheck: async () => [{ name: 'core', ok: true }],
      activeVersionCheck: async () => 'new-v',
    });
  assert.equal(summary.state, 'rollback_blocked');
  assert.ok(notifications.some(item => item.severity === 'critical'));
});

test('observe rejects a manifest whose rollback flag contradicts its facts', async () => {
  const manifest = buildReleaseManifest({
    sourceSha: 'a'.repeat(40), startedAt: new Date().toISOString(), nonce: 'synthetic',
    services: [{
      service: 'auth', script: 'codepi-auth', previous_version: 'prev-v', new_version: 'new-v',
      previous_build_sha: 'b'.repeat(40), new_build_sha: 'a'.repeat(40), smoke: 'pass',
      migration_applied: true, secret_changed: false, binding_changed: false, external_side_effects: false,
    }],
  });
  manifest.services[0].rollback_allowed = true;
  await assert.rejects(() => observeOperation(baseEnv, stepFixture(),
    { payload: { kind: 'observe', manifest } }), /rollback_allowed is inconsistent/);
});
