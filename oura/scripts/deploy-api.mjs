import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

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
console.log(`Deployed ${version} build=${buildSha}`);
