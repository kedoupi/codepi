import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdir, rmdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { activeWorkerVersion, workerApi } from './worker-api.mjs';

export const PAIRING_CLIENTS = Object.freeze({
  mcp: {
    worker: 'codepi-mcp', authSecret: 'SSO_CLIENT_SECRET_MCP', origin: 'https://mcp.codepi.app',
    identified: body => body?.service === 'codepi-mcp',
  },
  project: {
    worker: 'codepi-project', authSecret: 'SSO_CLIENT_SECRET_PROJECT', origin: 'https://project.codepi.app',
    identified: body => body?.sso_enabled === true && body?.sso_ready === true,
  },
  me: {
    worker: 'codepi-me', authSecret: 'SSO_CLIENT_SECRET_ME', origin: 'https://me.codepi.app',
    identified: body => body?.source === 'me' && body?.sso_enabled === true && body?.sso_ready === true,
  },
});

async function checkPairingHealth(client, request) {
  const target = PAIRING_CLIENTS[client];
  const response = await request(`${target.origin}/api/health`, {
    redirect: 'manual', cache: 'no-store', signal: AbortSignal.timeout(15000),
  });
  assert.equal(response.status, 200, `${target.worker} readiness failed (HTTP ${response.status})`);
  const status = await response.json();
  assert.ok(status?.ok === true && target.identified(status),
    `invalid ${target.worker} health response`);
}

// One value, two exact secret names; never read or overwrite the SSO registry.
// Cross-Worker writes are not atomic. An incomplete operation must fail loudly.
export async function pairClientSecret({ client = 'mcp', env = process.env, request = fetch } = {}) {
  const target = PAIRING_CLIENTS[client];
  assert.ok(target, 'pairing client must be mcp, project or me');
  const targets = [
    { script: 'codepi-auth', secret: target.authSecret },
    { script: target.worker, secret: 'AUTH_CLIENT_SECRET' },
  ];
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
      throw new Error(`${client} credential pairing incomplete or uncertain at ${script}; stop releases and rerun the authorized pairing command for BOTH Workers`);
    }
  }
  try { await checkPairingHealth(client, request); }
  catch {
    throw new Error(`Both secret writes completed, but ${client} readiness did not pass; inspect the client health check before releasing, do not assume the pair is healthy`);
  }
  const after = {};
  for (const { script } of targets) after[script] = await activeWorkerVersion(script, api);
  return { paired: true, before, after };
}

export function pairMcpSecret(options = {}) {
  return pairClientSecret({ ...options, client: 'mcp' });
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  let lock;
  try {
    const args = process.argv.slice(2);
    assert.ok(args.includes('--rotate'), 'Usage: pair-mcp-secret.mjs --rotate [--client mcp|project|me] (explicitly authorized credential rotation only)');
    let client = 'mcp';
    for (let i = 0; i < args.length; i++) {
      if (args[i] === '--rotate') continue;
      if (args[i] === '--client' && args[i + 1] && !args[i + 2]?.startsWith('--')) {
        client = args[++i];
      } else {
        throw new Error('Usage: pair-mcp-secret.mjs --rotate [--client mcp|project|me] (explicitly authorized credential rotation only)');
      }
    }
    assert.ok(Object.hasOwn(PAIRING_CLIENTS, client), 'pairing client must be mcp, project or me');
    const cwd = fileURLToPath(new URL('../../', import.meta.url));
    const common = execFileSync('git', ['rev-parse', '--path-format=absolute', '--git-common-dir'], { cwd, encoding: 'utf8' }).trim();
    const target = path.join(common, 'codepi-production-release.lock');
    await mkdir(target);
    lock = target;
    console.log(JSON.stringify(await pairClientSecret({ client })));
  } catch (error) {
    console.error(error.code === 'EEXIST' ? 'Production release lock is held; no secrets changed' : error.message);
    process.exitCode = 1;
  } finally {
    if (lock) await rmdir(lock);
  }
}
