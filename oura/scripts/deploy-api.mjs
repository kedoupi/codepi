import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';

const cwd = fileURLToPath(new URL('../workers/api', import.meta.url));
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

// 1. Apply D1 migrations BEFORE uploading code that depends on new tables.
//    wrangler exits non-zero if any migration fails, so a bad schema stops
//    the deploy instead of shipping a Worker against missing tables.
//    CI=true makes the confirmation prompt non-interactive.
wrangler(['d1', 'migrations', 'apply', 'oura_kdp', '--remote']);

// 2. Stamp the build so /api/health and the smoke check can prove the new
//    version is live. BUILD_SHA is read as a plain var on the Worker.
const buildSha = (process.env.GITHUB_SHA || '').slice(0, 12)
  || spawnSync('git', ['rev-parse', '--short=12', 'HEAD'], { encoding: 'utf8' }).stdout.trim();

// Version deployment keeps the existing zone route. Tokens need Worker edit
// permissions, but not zone route write permissions for every release.
const output = wrangler(['versions', 'upload', '--var', `BUILD_SHA:${buildSha}`]);
const version = output.match(/Worker Version ID:\s*([a-f0-9-]{36})/i)?.[1];
if (!version) throw new Error('Upload did not return a Worker version ID; refusing to deploy');
wrangler(['versions', 'deploy', `${version}@100%`, '--yes']);
// Version deployments do not deploy schedules. Update only this Worker's
// schedules: deploying all triggers would also rewrite the existing zone routes.
const account = process.env.CLOUDFLARE_ACCOUNT_ID;
const token = process.env.CLOUDFLARE_API_TOKEN;
if (!account || !token) throw new Error('Schedule deployment requires Cloudflare account ID and API token');
const config = readFileSync(`${cwd}/wrangler.toml`, 'utf8');
const name = config.match(/^name\s*=\s*"([^"]+)"/m)?.[1];
const cronLine = config.match(/^\[triggers\]\s*\ncrons\s*=\s*(\[[^\n]+\])/m)?.[1];
if (!name || !cronLine) throw new Error('Worker name or Cron configuration missing');
const crons = JSON.parse(cronLine);
const endpoint = `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(account)}/workers/scripts/${encodeURIComponent(name)}/schedules`;
async function schedules(method) {
  const response = await fetch(endpoint, {
    method,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    ...(method === 'PUT' ? { body: JSON.stringify(crons.map(cron => ({ cron }))) } : {}),
    signal: AbortSignal.timeout(30_000),
  });
  const body = await response.json();
  if (!response.ok || !body.success) throw new Error(`Cron ${method} failed (HTTP ${response.status})`);
  return body.result;
}
await schedules('PUT');
const installed = await schedules('GET');
if (JSON.stringify(installed.schedules.map(row => row.cron).sort()) !== JSON.stringify([...crons].sort())) {
  throw new Error('Installed Cron triggers do not match wrangler.toml');
}
console.log(`Verified Cron schedule: ${crons.join(', ')}`);
console.log(`Deployed ${version} build=${buildSha}`);
