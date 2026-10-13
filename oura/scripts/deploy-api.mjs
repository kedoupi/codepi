import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const cwd = fileURLToPath(new URL('../workers/api', import.meta.url));
function wrangler(args) {
  const result = spawnSync('pnpm', ['exec', 'wrangler', ...args], {
    cwd, encoding: 'utf8', env: { ...process.env, CI: 'true', NO_COLOR: '1' },
  });
  process.stdout.write(result.stdout || '');
  process.stderr.write(result.stderr || '');
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`Wrangler ${args[0]} ${args[1]} failed`);
  return result.stdout;
}

// Version deployment keeps the existing zone route. Tokens need Worker edit
// permissions, but not zone route write permissions for every release.
const output = wrangler(['versions', 'upload']);
const version = output.match(/Worker Version ID:\s*([a-f0-9-]{36})/i)?.[1];
if (!version) throw new Error('Upload did not return a Worker version ID; refusing to deploy');
wrangler(['versions', 'deploy', `${version}@100%`, '--yes']);
