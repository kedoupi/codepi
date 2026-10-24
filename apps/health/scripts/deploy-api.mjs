import { spawnSync } from 'node:child_process';
import { readFileSync, rmSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { readWranglerConfig, withBuildSha } from './lib/wrangler-config.mjs';

const cwd = fileURLToPath(new URL('../workers/api', import.meta.url));
const preflightOnly = process.argv.includes('--preflight-only');
// staging 已退役：只发布 production 根配置。
if (process.argv.includes('--env')) {
  console.error('Deploy aborted before any remote change: --env is no longer supported (staging is retired).');
  process.exit(1);
}
const PREFLIGHT_OUTDIR = '.deploy-preflight';
const EVIDENCE_ENV = {
  migrationApplied: 'HEALTH_MIGRATION_APPLIED',
  secretChanged: 'HEALTH_SECRET_CHANGED',
  bindingChanged: 'HEALTH_BINDING_CHANGED',
  externalSideEffects: 'HEALTH_EXTERNAL_SIDE_EFFECTS',
};
function evidenceFacts(env = process.env) {
  const result = {};
  for (const [key, name] of Object.entries(EVIDENCE_ENV)) {
    if (env[name] === undefined) continue;
    if (env[name] !== 'true' && env[name] !== 'false') {
      throw new Error(`${name} must be true or false when provided`);
    }
    result[key] = env[name] === 'true';
  }
  return result;
}
const evidence = evidenceFacts();

function wrangler(args, extraEnv = {}) {
  const result = spawnSync('pnpm', ['exec', 'wrangler', ...args], {
    cwd, encoding: 'utf8', env: { ...process.env, CI: 'true', NO_COLOR: '1', ...extraEnv },
  });
  process.stdout.write(result.stdout || '');
  process.stderr.write(result.stderr || '');
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`Wrangler ${args[0]} ${args[1]} failed`);
  return result.stdout;
}

async function main() {
  const configText = readFileSync(`${cwd}/wrangler.toml`, 'utf8');
  const { name, databaseName, crons } = readWranglerConfig(`${cwd}/wrangler.toml`, { dir: cwd });
  // Every step that touches production, in order, so a failure can say where it stopped.
  let completed = 'nothing (no remote change was made)';
  const configuredPreviousVersion = process.env.HEALTH_PREVIOUS_VERSION || '';
  if (configuredPreviousVersion && !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(configuredPreviousVersion)) {
    throw new Error('HEALTH_PREVIOUS_VERSION must be a Worker version UUID');
  }

  // ------------------------------------------------------------- 1. preflight
  // A malformed wrangler.toml or a missing token must stop the deploy BEFORE any
  // remote migration, upload or traffic switch.
  const account = process.env.CLOUDFLARE_ACCOUNT_ID;
  const token = process.env.CLOUDFLARE_API_TOKEN;
  if (!account || !token) {
    throw new Error('Deploy requires CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN');
  }

  // CLOUDFLARE_API_BASE_URL is the documented wrangler override; deploys keep
  // the default and tests point it at a local stub.
  const apiBase = (process.env.CLOUDFLARE_API_BASE_URL || 'https://api.cloudflare.com/client/v4').replace(/\/+$/, '');
  const base = `${apiBase}/accounts/${encodeURIComponent(account)}`;
  const script = `/workers/scripts/${encodeURIComponent(name)}`;
  async function cloudflare(path, init = {}) {
    const response = await fetch(`${base}${path}`, {
      ...init,
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...init.headers },
      signal: AbortSignal.timeout(30_000),
    });
    const body = await response.json().catch(() => null);
    if (!response.ok || !body?.success) {
      throw new Error(
        `Cloudflare API ${init.method || 'GET'} ${path} failed (HTTP ${response.status}): `
        + `${body?.errors?.[0]?.message || 'unknown error'}`,
      );
    }
    return body.result;
  }
  const schedulesUrl = `${script}/schedules`;

  process.stdout.write('Preflight: validating the bundle with a local dry run...\n');
  try {
    wrangler(['deploy', '--dry-run', `--outdir=${PREFLIGHT_OUTDIR}`]);
  } finally {
    rmSync(`${cwd}/${PREFLIGHT_OUTDIR}`, { recursive: true, force: true });
  }

  // Credentials are proven usable, and the active version is recorded, before
  // anything in production changes.
  process.stdout.write('Preflight: verifying Cloudflare credentials and current deployment...\n');
  // Reading the actual Worker proves the token has access to this account;
  // token verification alone does not prove its resource permissions.
  let previousVersion = process.env.HEALTH_PREVIOUS_VERSION || '';
  const before = await cloudflare(schedulesUrl);
  if (!previousVersion) {
    const deployments = await cloudflare(`${script}/deployments`);
    const versions = deployments?.deployments?.[0]?.versions ?? [];
    previousVersion = versions
      .filter(row => (row.percentage ?? 0) > 0)
      .sort((a, b) => b.percentage - a.percentage)[0]?.version_id ?? '';
  }

  process.stdout.write(
    `Preflight OK: worker=${name} d1=${databaseName} crons=${crons.join(',')} `
    + `active=${previousVersion || 'unknown'}\n`,
  );
  if (preflightOnly) {
    process.stdout.write('--preflight-only: stopping before any remote change.\n');
    return;
  }

  try {
    // 2. Apply D1 migrations BEFORE uploading code that depends on new tables.
    //    wrangler exits non-zero if any migration fails, so a bad schema stops
    //    the deploy instead of shipping a Worker against missing tables.
    //    CI=true makes the confirmation prompt non-interactive.
    wrangler(['d1', 'migrations', 'apply', databaseName, '--remote']);
    completed = 'D1 migrations applied (the previous Worker version is still serving)';

    // 3. Stamp the build so /api/health and the smoke check can prove the new
    //    version is live. BUILD_SHA is read as a plain var on the Worker.
    const sourceSha = process.env.GITHUB_SHA || spawnSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).stdout.trim();
    if (!/^[a-f0-9]{40}$/i.test(sourceSha)) throw new Error('GITHUB_SHA must be the full 40-character source SHA');
    const buildSha = sourceSha.slice(0, 12);

    // Version deployment keeps the existing zone route. Tokens need Worker edit
    // permissions, but not zone route write permissions for every release.
    // CLI --var can replace the entire vars map. Stamp the complete config in
    // the same directory so SSO flags, AUTH binding and relative paths survive.
    const stampedConfig = '.deploy-build.toml';
    let output;
    try {
      writeFileSync(`${cwd}/${stampedConfig}`, withBuildSha(configText, buildSha));
      output = wrangler(['versions', 'upload', '--config', stampedConfig]);
    } finally {
      rmSync(`${cwd}/${stampedConfig}`, { force: true });
    }
    const version = output.match(/Worker Version ID:\s*([a-f0-9-]{36})/i)?.[1];
    if (!version) throw new Error('Upload did not return a Worker version ID; refusing to deploy');
    completed = `version ${version} uploaded (not serving traffic yet)`;

    wrangler(['versions', 'deploy', `${version}@100%`, '--yes']);
    completed = `version ${version} serving 100% of traffic (build=${buildSha})`;

    // 4. Version deployments do not deploy schedules. Update only this Worker's
    //    schedules: deploying all triggers would also rewrite the zone routes.
    await cloudflare(schedulesUrl, { method: 'PUT', body: JSON.stringify(crons.map(cron => ({ cron }))) });
    const verified = await cloudflare(schedulesUrl);
    if (JSON.stringify((verified.schedules || []).map(row => row.cron).sort()) !== JSON.stringify([...crons].sort())) {
      throw new Error('Installed Cron triggers do not match wrangler.toml');
    }
    completed = `version ${version} live with a verified Cron schedule`;

    if (installedCrons.length && JSON.stringify(installedCrons) !== JSON.stringify([...crons].sort())) {
      console.log(`Note: Cron schedule changed from [${installedCrons.join(', ')}] to [${crons.join(', ')}].`);
    }
    console.log(JSON.stringify({
      service: 'health-api',
      script: name,
      source_sha: sourceSha,
      new_build_sha: sourceSha,
      previous_version: previousVersion,
      new_version: version,
      version,
      smoke: 'pending',
      ...evidence,
    }));
  } catch (error) {
    console.error(`\nDeploy stopped at: ${completed}`);
    if (completed.includes('serving 100%')) {
      console.error('The new version is serving traffic but the deploy did not finish.');
      console.error(previousVersion
        ? `Roll back with: pnpm exec wrangler versions deploy ${previousVersion}@100% --yes  (from apps/health/workers/api)`
        : 'The previously active version id could not be read; check the Cloudflare dashboard before rolling back.');
      console.error('Re-running this script is safe: it uploads a new version and re-verifies the schedule.');
    } else {
      console.error('Production is still on the previous Worker version.');
    }
    process.exit(1);
  }
}

await main().catch(error => {
  console.error(`\nDeploy aborted before any remote change: ${error.message}`);
  process.exitCode = 1;
});
