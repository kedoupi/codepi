import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import { remoteMain } from './release-drift.mjs';
import { workerApi } from './worker-api.mjs';

const ACCOUNT = '69f1de4c8f3c7411593613711207e7b3';
const BUCKET = 'codepi-ops-backups';
const TOKEN_NAME = 'codepi-ops-runtime';
const root = fileURLToPath(new URL('../../', import.meta.url));

export async function provisionOps(phase, { env = process.env, request = fetch } = {}) {
  assert.equal(env.CLOUDFLARE_ACCOUNT_ID, ACCOUNT, 'Ops must use the registered Kedoupi account');
  assert.ok(env.CLOUDFLARE_API_TOKEN, 'Cloudflare credentials are required');
  const api = async (endpoint, method = 'GET', body) => {
    let response, result;
    try {
      response = await request(`https://api.cloudflare.com/client/v4/accounts/${ACCOUNT}${endpoint}`, {
        method, redirect: 'error', signal: AbortSignal.timeout(30000),
        headers: { authorization: `Bearer ${env.CLOUDFLARE_API_TOKEN}`, 'content-type': 'application/json' },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      result = await response.json();
    } catch { throw new Error('Ops provisioning API failed (network or invalid JSON)'); }
    assert.ok(response.ok && result.success, `Ops provisioning API failed (HTTP ${response.status})`);
    return result.result;
  };
  if (phase === 'storage') {
    const listing = await api('/r2/buckets');
    assert.ok(Array.isArray(listing?.buckets), 'R2 bucket listing unavailable');
    if (!listing.buckets.some(bucket => bucket.name === BUCKET)) await api('/r2/buckets', 'POST', { name: BUCKET });
    await api(`/r2/buckets/${BUCKET}/domains/managed`, 'PUT', { enabled: false });
    await api(`/r2/buckets/${BUCKET}/lifecycle`, 'PUT', { rules: [
      { id: 'expire-encrypted-backups', enabled: true, conditions: { prefix: 'backups/' },
        deleteObjectsTransition: { condition: { type: 'Age', maxAge: 14 * 86400 } } },
      { id: 'expire-operation-reports', enabled: true, conditions: { prefix: 'reports/' },
        deleteObjectsTransition: { condition: { type: 'Age', maxAge: 14 * 86400 } } },
    ] });
    return { bucket: BUCKET, public_access: false, retention_days: 14 };
  }
  assert.equal(phase, 'credentials', 'expected storage or credentials phase');
  const secrets = await workerApi('codepi-ops/secrets', { env, request });
  assert.ok(Array.isArray(secrets), 'Ops secret names unavailable');
  if (secrets.some(secret => secret.name === 'CLOUDFLARE_API_TOKEN')) {
    return { runtime_token: 'already configured; not rotated', github_token: secrets.some(s => s.name === 'GITHUB_TOKEN') };
  }
  const tokens = await api('/tokens');
  assert.ok(Array.isArray(tokens) && !tokens.some(token => token.name === TOKEN_NAME),
    'Ops runtime token already exists without a Worker secret; investigate before creating another');
  const groups = await api('/tokens/permission_groups');
  const permissions = ['D1 Write', 'Workers Scripts Read'].map(name => {
    const candidates = groups.filter(group => group.name === name && group.is_selectable);
    assert.equal(candidates.length, 1, 'required Ops permission group unavailable');
    return { id: candidates[0].id };
  });
  const token = await api('/tokens', 'POST', {
    name: TOKEN_NAME, policies: [{ effect: 'allow',
      resources: { [`com.cloudflare.api.account.${ACCOUNT}`]: '*' }, permission_groups: permissions }],
  });
  assert.ok(token?.id && token.value, 'new Ops token was not returned');
  // The newly minted credential exists only in this process and the Worker secret.
  // Never forward the broad provisioning token or overwrite an existing secret.
  try {
    await workerApi('codepi-ops/secrets', { env, request, method: 'PUT',
      body: { name: 'CLOUDFLARE_API_TOKEN', type: 'secret_text', text: token.value } });
  } catch {
    throw new Error(`Ops credential initialization incomplete; investigate token id ${token.id} before retrying`);
  }
  return { runtime_token_id: token.id, permissions: ['D1 Write', 'Workers Scripts Read'], github_token: false };
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  try {
    assert.equal(process.argv.length, 3, 'Usage: provision-ops.mjs <storage|credentials>');
    const git = args => execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: 'pipe' }).trim();
    assert.equal(git(['status', '--porcelain']), '', 'provisioning source must be clean');
    assert.equal(git(['rev-parse', 'HEAD']), remoteMain(root), 'provisioning source must equal current remote main');
    console.log(JSON.stringify(await provisionOps(process.argv[2])));
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
