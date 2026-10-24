import assert from 'node:assert/strict';
import { DATABASE_NAMES, keyId, resolveProductionDatabases } from '../../../scripts/cloudflare/backup-core.mjs';
import { runMonitor } from '../../../scripts/cloudflare/monitor-core.mjs';
import { checkGithubReleaseDrift } from '../../../scripts/cloudflare/github-release-drift.mjs';
import { checkTraffic } from '../../../scripts/cloudflare/traffic-monitor.mjs';
import { backupDatabase, verifyBackupObject } from './backup.mjs';
import { createObservabilityClient } from '../../../scripts/cloudflare/observability-api.mjs';
import { runObserver } from './observer.mjs';
import {
  assertCollectionBinding,
  backupCollectionMaterial,
  collectionIndex,
  ORIGINAL_COLLECTIONS,
} from './materials.mjs';

export const STEP = { retries: { limit: 2, delay: '30 seconds', backoff: 'exponential' }, timeout: '12 minutes' };

// Workflows returns RPC-backed objects from step.do(). Copy the durable value into
// this isolate, then release the RPC result immediately instead of retaining stubs.
export async function settledStepResult(result) {
  const value = await result;
  try {
    return structuredClone(value);
  } finally {
    const dispose = value?.[Symbol.dispose];
    if (typeof dispose === 'function') dispose.call(value);
  }
}

export async function saveReport(bucket, kind, report) {
  const body = JSON.stringify(report);
  await bucket.put(`reports/${kind}/${report.instance_id}.json`, body,
    { httpMetadata: { contentType: 'application/json' } });
  await bucket.put(`reports/${kind}/latest.json`, body,
    { httpMetadata: { contentType: 'application/json' } });
}

export async function backupFreshness(bucket, { now = Date.now() } = {}) {
  const results = [];
  const databaseNames = [...DATABASE_NAMES].sort();
  const originalSources = ORIGINAL_COLLECTIONS.map(collection => collection.source).sort();
  for (const location of ['r2']) {
    const name = `all D1 databases and originals ${location} backup completed within 30 hours`;
    try {
      const object = await bucket.get(`reports/backup/${location}-success.json`);
      assert.ok(object, 'no successful backup recorded');
      const report = await object.json();
      const age = now - Date.parse(report.completed_at);
      assert.ok(Number.isFinite(age) && age >= 0 && age < 30 * 3600000, 'latest complete backup is missing or stale');
      assert.equal(report.databases, DATABASE_NAMES.length, 'backup database coverage is incomplete');
      assert.deepEqual([...(report.database_names ?? [])].sort(), databaseNames,
        'backup database identities are missing or incomplete');
      assert.deepEqual([...(report.materials?.sources ?? [])].sort(), originalSources,
        'original backup coverage is missing or incomplete');
      assert.ok(Number.isSafeInteger(report.materials?.objects) && report.materials.objects >= 0,
        'original backup object count is missing');
      results.push({ name, ok: true });
    } catch (error) { results.push({ name, ok: false, detail: error.message }); }
  }
  return results;
}
export function isBlockingMonitorResult(result) {
  return result.advisory !== true && (!result.ok || Boolean(result.skipped));
}

export async function monitorOperation(env, step, event, { monitor = runMonitor, trafficCheck = checkTraffic } = {}) {
  const report = await settledStepResult(step.do('production monitor', STEP, async () => {
    const results = await monitor({ env, requireD1: true, requireVersions: true, versionCheck: checkGithubReleaseDrift });
    results.push(...await backupFreshness(env.BACKUPS));
    results.push(...await trafficCheck({ env, bucket: env.BACKUPS }));
    const report = { instance_id: event.instanceId, kind: 'monitor', completed_at: new Date().toISOString(),
      build: env.BUILD_SHA, ok: !results.some(isBlockingMonitorResult), results };
    await saveReport(env.BACKUPS, 'monitor', report);
    if (!report.ok) throw new Error(`${results.filter(isBlockingMonitorResult).length} production checks failed; inspect the private R2 monitor report`);
    return report;
  }));
  return { ok: true, checks: report.results.length };
}

export async function observeOperation(env, step, event, {
  observability = createObservabilityClient({ accountId: env.CLOUDFLARE_ACCOUNT_ID, apiToken: env.CLOUDFLARE_API_TOKEN }),
  notify,
  coreCheck = async ({ env: runtimeEnv }) => runMonitor({ env: runtimeEnv, requireD1: false, requireVersions: false }),
  activeVersionCheck,
} = {}) {
  const manifest = event.payload?.manifest ?? event.payload?.release_manifest;
  assert.ok(manifest?.release_id && Array.isArray(manifest.services), 'observe payload requires a release manifest');
  return runObserver({ manifest, bucket: env.BACKUPS, step, env, observability, notify, coreCheck, activeVersionCheck });
}

export async function backupOperation(env, step, event, publicKey, {
  exportOne = backupDatabase, resolveDatabases = resolveProductionDatabases,
} = {}) {
  const instanceId = event.instanceId;
  assert.match(instanceId ?? '', /^[a-zA-Z0-9_-]{1,100}$/, 'invalid backup instance ID');
  const started = await settledStepResult(step.do('backup metadata', () => ({
    created_at: new Date().toISOString(), key_id: keyId(publicKey), instance_id: instanceId,
  })));
  assert.equal(started.key_id, keyId(publicKey), 'backup recipient changed; start a new backup instance');
  for (const collection of ORIGINAL_COLLECTIONS) {
    assertCollectionBinding(collection.source, env[collection.binding]);
  }
  const databases = await settledStepResult(step.do('resolve required production D1 databases', STEP, () =>
    resolveDatabases({
      accountId: env.CLOUDFLARE_ACCOUNT_ID,
      token: env.CLOUDFLARE_API_TOKEN,
      explicit: env.D1_DATABASE_IDS,
    })));
  assert.equal(databases.length, DATABASE_NAMES.length, 'resolved D1 inventory is incomplete');
  assert.deepEqual(databases.map(database => database.name), [...DATABASE_NAMES],
    'resolved D1 inventory does not match the required ordering');
  const prefix = `backups/${instanceId}`;
  const entries = [];
  for (const { name, id: databaseId } of databases) {
    entries.push(await settledStepResult(step.do(`encrypted export ${name}`, STEP, async () => {
      const key = `${prefix}/${name}.sql.enc`;
      const entry = await exportOne(name, databaseId, publicKey, started.created_at, {
        accountId: env.CLOUDFLARE_ACCOUNT_ID, token: env.CLOUDFLARE_API_TOKEN,
        bucket: env.BACKUPS, key,
      });
      // No plaintext, encryption keys or signed export URLs enter durable step state.
      return entry;
    })));
  }
  // Capture append-only indexes after the D1 exports so all exported rows are
  // covered. Newer originals may be included; restore uses each D1 subset.
  const collections = [];
  let materialCount = 0;
  for (const collection of ORIGINAL_COLLECTIONS) {
    const binding = env[collection.binding];
    const index = await settledStepResult(step.do(`${collection.source} original index`, STEP, () =>
      collectionIndex(collection.source, binding)));
    const materials = [];
    for (const row of index.items) {
      materials.push(await settledStepResult(step.do(`encrypted ${collection.kind} ${row.id}`, STEP, () =>
        backupCollectionMaterial(collection.source, row, publicKey, started.created_at, {
          binding, bucket: env.BACKUPS, prefix,
        }))));
    }
    materialCount += materials.length;
    collections.push({
      source: collection.source,
      kind: collection.kind,
      through: index.through,
      objects: materials.length,
      entries: materials,
    });
  }
  const manifest = { version: 3, created_at: started.created_at, key_id: started.key_id, databases: entries,
    materials: { objects: materialCount, collections } };
  const success = await settledStepResult(step.do('commit R2 backup manifest', STEP, async () => {
    for (const entry of entries) {
      await verifyBackupObject(env.BACKUPS, `${prefix}/${entry.file}`, entry, started.key_id);
    }
    for (const collection of collections) {
      for (const entry of collection.entries) {
        await verifyBackupObject(env.BACKUPS, `${prefix}/materials/${entry.file}`, entry, started.key_id);
      }
    }
    await env.BACKUPS.put(`${prefix}/manifest.json`, JSON.stringify(manifest),
      { httpMetadata: { contentType: 'application/json' } });
    const success = { instance_id: instanceId, completed_at: new Date().toISOString(),
      prefix, databases: entries.length, database_names: entries.map(entry => entry.database),
      materials: { sources: collections.map(collection => collection.source), objects: materialCount },
      build: env.BUILD_SHA };
    await env.BACKUPS.put('reports/backup/r2-success.json', JSON.stringify(success));
    await saveReport(env.BACKUPS, 'backup', { ...success, r2: 'complete', ok: true });
    return success;
  }));
  return { ok: true, databases: entries.length, materials: materialCount };
}

export async function scheduleOperation(controller, env) {
  const kind = controller.cron === '0 18 * * *' ? 'backup' : 'monitor';
  assert.ok(['0 18 * * *', '*/30 * * * *'].includes(controller.cron), 'unknown operations cron');
  const id = `${kind}-${new Date(controller.scheduledTime).toISOString().replace(/[^0-9TZ]/g, '')}`;
  try {
    await env.OPERATIONS.create({ id, params: { kind } });
  } catch {
    // A repeated Cron delivery may refer to an instance that already exists.
    // A failed status read still fails this scheduled invocation.
    const existing = await env.OPERATIONS.get(id);
    await existing.status();
  }
  return { id, kind };
}

export async function assertRecentMonitor(bucket, now = Date.now()) {
  const object = await bucket.get('reports/monitor/latest.json');
  assert.ok(object, 'no monitor report yet; inspect the operations Workflow');
  const report = await object.json();
  const age = now - Date.parse(report.completed_at);
  assert.ok(Number.isFinite(age) && age >= 0 && age < 75 * 60000,
    'monitor report is stale; inspect the operations Workflow');
  assert.equal(report.ok, true, 'production monitor is failing; inspect the private R2 report');
}
