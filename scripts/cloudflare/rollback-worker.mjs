import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import path from 'node:path';

function activeVersion(result) {
  const versions = result?.deployments?.[0]?.versions;
  assert.ok(Array.isArray(versions) && versions.length === 1 && versions[0]?.percentage === 100,
    'active Worker deployment must serve exactly 100% of traffic from one version');
  assert.ok(versions[0].version_id, 'active Worker deployment has no version id');
  return versions[0].version_id;
}

export async function rollbackWorker({ script, expectedActiveVersion, targetVersion, api }) {
  assert.match(script ?? '', /^[A-Za-z0-9_-]+$/, 'invalid Worker script name');
  assert.ok(expectedActiveVersion, 'expected active Worker version is required');
  assert.ok(targetVersion, 'target Worker version is required');
  assert.equal(typeof api, 'function', 'rollback API is required');

  const before = activeVersion(await api(`/workers/scripts/${encodeURIComponent(script)}/deployments`));
  assert.equal(before, expectedActiveVersion, 'active Worker version changed; refusing rollback');

  await api(`/workers/scripts/${encodeURIComponent(script)}/deployments`, {
    method: 'POST',
    body: { strategy: 'percentage', versions: [{ version_id: targetVersion, percentage: 100 }] },
  });

  const after = activeVersion(await api(`/workers/scripts/${encodeURIComponent(script)}/deployments`));
  assert.equal(after, targetVersion, 'rollback deployment did not become active');
  return { script, previous_version: before, active_version: after };
}

export function cloudflareApi({ env = process.env, request = fetch } = {}) {
  assert.ok(env.CLOUDFLARE_ACCOUNT_ID && env.CLOUDFLARE_ROLLBACK_TOKEN,
    'CLOUDFLARE_ACCOUNT_ID/CLOUDFLARE_ROLLBACK_TOKEN are required');
  return async (endpoint, { method = 'GET', body } = {}) => {
    let response, payload;
    try {
      response = await request(`https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(env.CLOUDFLARE_ACCOUNT_ID)}${endpoint}`, {
        method, redirect: 'manual', signal: AbortSignal.timeout(30000),
        headers: { authorization: `Bearer ${env.CLOUDFLARE_ROLLBACK_TOKEN}`, 'content-type': 'application/json' },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      payload = await response.json();
    } catch { throw new Error('Worker rollback API failed (network or invalid JSON)'); }
    assert.ok(response.ok && payload?.success === true, `Worker rollback API failed (HTTP ${response.status})`);
    return payload.result;
  };
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  try {
    assert.equal(process.argv.length, 7,
      'Usage: rollback-worker.mjs <script> --target <version-id> --expect-active <version-id>');
    assert.equal(process.argv[3], '--target', 'Usage: rollback-worker.mjs <script> --target <version-id> --expect-active <version-id>');
    assert.equal(process.argv[5], '--expect-active', 'Usage: rollback-worker.mjs <script> --target <version-id> --expect-active <version-id>');
    console.log(JSON.stringify(await rollbackWorker({
      script: process.argv[2], targetVersion: process.argv[4], expectedActiveVersion: process.argv[6],
      api: cloudflareApi(),
    })));
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
