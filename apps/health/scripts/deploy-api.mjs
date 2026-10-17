import { spawnSync } from 'node:child_process';
import { readFileSync, rmSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseWranglerEnvConfig, readWranglerConfig, withBuildSha } from './lib/wrangler-config.mjs';

const cwd = fileURLToPath(new URL('../workers/api', import.meta.url));
const preflightOnly = process.argv.includes('--preflight-only');
const envFlag = process.argv[process.argv.indexOf('--env') + 1];
const deployEnv = process.argv.includes('--env') && envFlag && !envFlag.startsWith('-') ? envFlag : '';
const PREFLIGHT_OUTDIR = '.deploy-preflight';

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
  // production（无 --env）行为不变：只读生产根配置。staging 通过 --env staging
  // 选择 [env.staging] 的 name/D1/cron，绝不回落到生产声明。
  const { name, databaseName, crons } = deployEnv
    ? parseWranglerEnvConfig(configText, deployEnv, { dir: cwd })
    : readWranglerConfig(`${cwd}/wrangler.toml`, { dir: cwd });
  // Every step that touches production, in order, so a failure can say where it stopped.
  let completed = 'nothing (no remote change was made)';

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
    wrangler(['deploy', '--dry-run', `--outdir=${PREFLIGHT_OUTDIR}`, ...(deployEnv ? ['--env', deployEnv] : [])]);
  } finally {
    rmSync(`${cwd}/${PREFLIGHT_OUTDIR}`, { recursive: true, force: true });
  }

  // Credentials are proven usable, and the active version is recorded, before
  // anything in production changes.
  process.stdout.write('Preflight: verifying Cloudflare credentials and current deployment...\n');
  // Reading the actual Worker proves the token has access to this account;
  // token verification alone does not prove its resource permissions.
  const before = await cloudflare(schedulesUrl);
  const installedCrons = (before.schedules || []).map(row => row.cron).sort();
  let previousVersion = process.env.HEALTH_PREVIOUS_VERSION || '';
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
    wrangler(['d1', 'migrations', 'apply', databaseName, '--remote', ...(deployEnv ? ['--env', deployEnv] : [])]);
    completed = 'D1 migrations applied (the previous Worker version is still serving)';

    // 3. Stamp the build so /api/health and the smoke check can prove the new
    //    version is live. BUILD_SHA is read as a plain var on the Worker.
    const buildSha = (process.env.GITHUB_SHA || '').slice(0, 12)
      || spawnSync('git', ['rev-parse', '--short=12', 'HEAD'], { encoding: 'utf8' }).stdout.trim();

    // Version deployment keeps the existing zone route. Tokens need Worker edit
    // permissions, but not zone route write permissions for every release.
    // CLI --var can replace the entire vars map. Stamp the complete config in
    // the same directory so SSO flags, AUTH binding and relative paths survive.
    const stampedConfig = '.deploy-build.toml';
    let output;
    try {
      writeFileSync(`${cwd}/${stampedConfig}`, withBuildSha(configText, buildSha, deployEnv));
      if (deployEnv) {
        // staging 走受控 deploy：wrangler 直接发布 [env.staging] 并携带
        // BUILD_SHA；必须从输出解析真实 Current Version ID，否则视为失败。
        output = wrangler(['deploy', '--config', stampedConfig, '--env', deployEnv]);
        const current = output.match(/Current Version ID:\s*([a-f0-9-]{36})/i)?.[1];
        if (!current) throw new Error('Deploy did not return a Current Version ID; refusing to record evidence');
        completed = `version ${current} live (build=${buildSha}, env=${deployEnv})`;
        // 与 production 同等校验：installed Cron 必须与所选环境的声明一致。
        const verified = await cloudflare(schedulesUrl);
        if (JSON.stringify((verified.schedules || []).map(row => row.cron).sort()) !== JSON.stringify([...crons].sort())) {
          throw new Error(`Installed Cron triggers do not match wrangler.toml [env.${deployEnv}]`);
        }
        console.log(`Verified Cron schedule: ${crons.join(', ')}`);
        console.log(`Deployed ${current} build=${buildSha} env=${deployEnv}`);
        return;
      }
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
    console.log(`Verified Cron schedule: ${crons.join(', ')}`);
    console.log(`Deployed ${version} build=${buildSha}`);
  } catch (error) {
    console.error(`\nDeploy stopped at: ${completed}`);
    if (deployEnv) {
      console.error(`The ${deployEnv} Worker may be partially updated; re-run this script to re-verify.`);
      console.error('Production was not touched by this staging deploy.');
    } else if (completed.includes('serving 100%')) {
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
