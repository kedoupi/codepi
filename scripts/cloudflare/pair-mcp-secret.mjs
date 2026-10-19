import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdir, rmdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { activeWorkerVersion, workerApi } from './worker-api.mjs';
import { checkMcpHealth } from './mcp-checks.mjs';

const targets = [
  { script: 'codepi-auth', secret: 'SSO_CLIENT_SECRET_MCP' },
  { script: 'codepi-mcp', secret: 'AUTH_CLIENT_SECRET' },
];

// One value, two exact secret names; never read or overwrite the SSO registry.
// Cross-Worker writes are not atomic. An incomplete operation must fail loudly.
export async function pairMcpSecret({ env = process.env, request = fetch } = {}) {
  const api = { env, request };
  const before = {};
  for (const { script } of targets) {
    before[script] = await activeWorkerVersion(script, api);
    const versions = await workerApi(`${script}/versions`, api);
    assert.ok(versions?.items?.[0]?.id === before[script],
      `${script} has an undeployed latest version; resolve it before rotating secrets`);
  }
  const value = randomBytes(32).toString('base64url');
  for (const { script, secret } of targets) {
    try {
      assert.equal(await activeWorkerVersion(script, api), before[script], 'concurrent deployment detected');
      await workerApi(`${script}/secrets`, { ...api, method: 'PUT',
        body: { name: secret, type: 'secret_text', text: value } });
    } catch {
      throw new Error(`MCP credential pairing incomplete or uncertain at ${script}; stop releases and rerun the authorized pairing command for BOTH Workers`);
    }
  }
  try { await checkMcpHealth({ request }); }
  catch {
    throw new Error('Both secret writes completed, but MCP readiness did not pass; run check:live before releasing, do not assume the pair is healthy');
  }
  const after = {};
  for (const { script } of targets) after[script] = await activeWorkerVersion(script, api);
  return { paired: true, before, after };
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  let lock;
  try {
    assert.ok(process.argv.length === 3 && process.argv[2] === '--rotate',
      'Usage: pair-mcp-secret.mjs --rotate (explicitly authorized credential rotation only)');
    const cwd = fileURLToPath(new URL('../../', import.meta.url));
    const common = execFileSync('git', ['rev-parse', '--path-format=absolute', '--git-common-dir'], { cwd, encoding: 'utf8' }).trim();
    const target = path.join(common, 'codepi-production-release.lock');
    await mkdir(target);
    lock = target;
    console.log(JSON.stringify(await pairMcpSecret()));
  } catch (error) {
    console.error(error.code === 'EEXIST' ? 'Production release lock is held; no secrets changed' : error.message);
    process.exitCode = 1;
  } finally {
    if (lock) await rmdir(lock);
  }
}
