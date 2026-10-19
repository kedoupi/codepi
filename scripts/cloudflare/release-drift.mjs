import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { activeWorkerVersion, workerApi } from './worker-api.mjs';

import { WORKERS, affectedWorkers } from './release-scope.mjs';
export { WORKERS, affectedWorkers } from './release-scope.mjs';
const root = fileURLToPath(new URL('../../', import.meta.url));

function git(cwd, args) {
  try {
    return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 30000, maxBuffer: 16 * 1024 * 1024 });
  } catch {
    throw new Error('Git history could not be verified; use a full-history checkout containing current remote main');
  }
}

function resolveCommit(cwd, ref) {
  assert.ok(typeof ref === 'string' && /^[a-f0-9]{7,40}$/.test(ref), 'BUILD_SHA/main must be a Git SHA (not local or missing)');
  return git(cwd, ['rev-parse', '--verify', '--end-of-options', `${ref}^{commit}`]).trim();
}

export function remoteMain(cwd = root) {
  const output = git(cwd, ['ls-remote', 'origin', 'refs/heads/main']).trim();
  assert.match(output, /^[a-f0-9]{40}\s+refs\/heads\/main$/, 'could not resolve remote main');
  return resolveCommit(cwd, output.split(/\s/)[0]);
}

export function compareBuild(service, build, main, cwd = root) {
  assert.ok(Object.hasOwn(WORKERS, service), 'unknown Worker');
  const source = resolveCommit(cwd, build);
  main = resolveCommit(cwd, main);
  if (source === main) return { source, main, current: true };
  // A release from another branch (or unavailable history) is an alarm, not a skip.
  git(cwd, ['merge-base', '--is-ancestor', source, main]);
  const files = git(cwd, ['log', '--format=', '--name-only', '-z', '--no-renames', '--diff-merges=first-parent', `${source}..${main}`, '--'])
    .split('\0').filter(Boolean);
  const current = !affectedWorkers(files).includes(service);
  return { source, main, current };
}

export async function checkReleaseDrift({ env = process.env, request = fetch, cwd = root, requireVersions = false } = {}) {
  const name = 'production Worker versions match main code';
  if (!env.CLOUDFLARE_ACCOUNT_ID || !env.CLOUDFLARE_API_TOKEN) {
    return [requireVersions
      ? { name, ok: false, detail: 'CLOUDFLARE_ACCOUNT_ID/CLOUDFLARE_API_TOKEN are required for version checks' }
      : { name, ok: true, skipped: 'no Cloudflare credentials for version checks' }];
  }
  let main;
  try { main = remoteMain(cwd); }
  catch (error) { return [{ name, ok: false, detail: error.message }]; }
  return Promise.all(Object.entries(WORKERS).map(async ([service, script]) => {
    const name = `${script} active BUILD_SHA matches main code`;
    try {
      const version = await activeWorkerVersion(script, { env, request });
      const detail = await workerApi(`${script}/versions/${version}`, { env, request });
      const binding = detail?.resources?.bindings?.filter(b => b.name === 'BUILD_SHA' && b.type === 'plain_text');
      assert.ok(binding?.length === 1, 'active version is missing a unique BUILD_SHA; publish with the SHA-stamped release command');
      const result = compareBuild(service, binding[0].text, main, cwd);
      assert.ok(result.current, `unreleased changes: production=${result.source.slice(0, 12)} main=${main.slice(0, 12)}`);
      return { name, ok: true, build: result.source.slice(0, 12), main: main.slice(0, 12), version };
    } catch (error) {
      return { name, ok: false, detail: error.message };
    }
  }));
}
