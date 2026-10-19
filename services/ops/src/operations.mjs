import assert from 'node:assert/strict';
import { DATABASES, encryptedExport, keyId } from '../../../scripts/cloudflare/backup-core.mjs';
import { runMonitor } from '../../../scripts/cloudflare/monitor-core.mjs';
import { checkGithubReleaseDrift } from '../../../scripts/cloudflare/github-release-drift.mjs';
import { offsiteRelease } from './offsite.mjs';

export const STEP = { retries: { limit: 2, delay: '30 seconds', backoff: 'exponential' }, timeout: '12 minutes' };

export async function saveReport(bucket, kind, report) {
  const body = JSON.stringify(report);
  await bucket.put(`reports/${kind}/${report.instance_id}.json`, body,
    { httpMetadata: { contentType: 'application/json' } });
  await bucket.put(`reports/${kind}/latest.json`, body,
    { httpMetadata: { contentType: 'application/json' } });
}

export async function backupFreshness(bucket, { now = Date.now() } = {}) {
  const results = [];
  for (const location of ['r2', 'offsite']) {
    const name = `six-database ${location} backup completed within 30 hours`;
    try {
      const object = await bucket.get(`reports/backup/${location}-success.json`);
      assert.ok(object, 'no successful backup recorded');
      const report = await object.json();
      const age = now - Date.parse(report.completed_at);
      assert.ok(Number.isFinite(age) && age >= 0 && age < 30 * 3600000, 'latest complete backup is missing or stale');
      assert.equal(report.databases, Object.keys(DATABASES).length, 'backup database coverage is incomplete');
      results.push({ name, ok: true });
    } catch (error) { results.push({ name, ok: false, detail: error.message }); }
  }
  return results;
}

export async function monitorOperation(env, step, event, { monitor = runMonitor } = {}) {
  const report = await step.do('production monitor', STEP, async () => {
    const results = await monitor({ env, requireD1: true, requireVersions: true, versionCheck: checkGithubReleaseDrift });
    results.push(...await backupFreshness(env.BACKUPS));
    const report = { instance_id: event.instanceId, kind: 'monitor', completed_at: new Date().toISOString(),
      build: env.BUILD_SHA, ok: results.every(result => result.ok && !result.skipped), results };
    await saveReport(env.BACKUPS, 'monitor', report);
    if (!report.ok) throw new Error(`${results.filter(result => !result.ok || result.skipped).length} production checks failed; inspect the private R2 monitor report`);
    return report;
  });
  return { ok: true, checks: report.results.length };
}

export async function backupOperation(env, step, event, publicKey, { exportOne = encryptedExport } = {}) {
  const instanceId = event.instanceId;
  assert.match(instanceId ?? '', /^[a-zA-Z0-9_-]{1,100}$/, 'invalid backup instance ID');
  const started = await step.do('backup metadata', () => ({
    created_at: new Date().toISOString(), key_id: keyId(publicKey), instance_id: instanceId,
  }));
  assert.equal(started.key_id, keyId(publicKey), 'backup recipient changed; start a new backup instance');
  const prefix = `backups/${instanceId}`;
  const entries = [];
  for (const [name, databaseId] of Object.entries(DATABASES)) {
    entries.push(await step.do(`encrypted export ${name}`, STEP, async () => {
      const key = `${prefix}/${name}.sql.enc`;
      const existing = await env.BACKUPS.head(key);
      if (existing) {
        const entry = JSON.parse(existing.customMetadata?.entry ?? 'null');
        assert.ok(entry?.database === name && entry.database_id === databaseId
          && entry.created_at === started.created_at && entry.bytes === existing.size
          && existing.customMetadata?.key_id === started.key_id
          && /^[a-f0-9]{64}$/.test(entry.sha256), 'existing backup object has invalid metadata');
        return entry;
      }
      const { encrypted, entry } = await exportOne(name, databaseId, publicKey, started.created_at, {
        accountId: env.CLOUDFLARE_ACCOUNT_ID, token: env.CLOUDFLARE_API_TOKEN,
      });
      await env.BACKUPS.put(key, encrypted, {
        httpMetadata: { contentType: 'application/octet-stream' },
        customMetadata: { entry: JSON.stringify(entry), key_id: started.key_id },
      });
      // No plaintext, encryption keys or signed export URLs enter durable step state.
      return entry;
    }));
  }
  const manifest = { version: 1, created_at: started.created_at, key_id: started.key_id, databases: entries };
  const success = await step.do('commit R2 backup manifest', STEP, async () => {
    for (const entry of entries) {
      const object = await env.BACKUPS.head(`${prefix}/${entry.file}`);
      assert.ok(object?.size === entry.bytes && object.customMetadata?.key_id === started.key_id
        && object.customMetadata?.entry === JSON.stringify(entry),
      'completed backup ciphertext is missing or changed; start a new instance');
    }
    await env.BACKUPS.put(`${prefix}/manifest.json`, JSON.stringify(manifest),
      { httpMetadata: { contentType: 'application/json' } });
    const success = { instance_id: instanceId, completed_at: new Date().toISOString(),
      prefix, databases: entries.length, build: env.BUILD_SHA };
    await env.BACKUPS.put('reports/backup/r2-success.json', JSON.stringify(success));
    await saveReport(env.BACKUPS, 'backup', { ...success, r2: 'complete', offsite: 'pending', ok: false });
    return success;
  });
  let offsite;
  try {
    offsite = await step.do('copy ciphertext outside Cloudflare', STEP, () =>
      offsiteRelease(manifest, prefix, env.BACKUPS, { token: env.GITHUB_TOKEN }));
  } catch (error) {
    await step.do('record offsite failure', STEP, async () => {
      await saveReport(env.BACKUPS, 'backup', { ...success, r2: 'complete', offsite: 'failed', ok: false,
        reason: env.GITHUB_TOKEN ? 'github_transfer_failed' : 'github_token_missing' });
      return { ok: false };
    });
    throw error;
  }
  await step.do('commit offsite receipt', STEP, async () => {
    const report = { ...success, completed_at: new Date().toISOString(), offsite, r2: 'complete', ok: true };
    await env.BACKUPS.put('reports/backup/offsite-success.json', JSON.stringify(report));
    await saveReport(env.BACKUPS, 'backup', report);
    return { ok: true, databases: entries.length };
  });
  return { ok: true, databases: entries.length };
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
