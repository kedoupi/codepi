import assert from 'node:assert/strict';
import { activeWorkerVersion, workerApi } from './worker-api.mjs';
import { affectedWorkers, WORKERS } from './release-scope.mjs';
import { githubApi } from './github-api.mjs';

const SHA = /^[a-f0-9]{40}$/;
const MAX_COMMITS = 500;

// Compare's aggregate file list loses reverted changes and truncates at 300 files.
// Read every intervening commit, including each merge's first-parent file diff.
export function githubHistory({ token, request = fetch } = {}) {
  const cache = new Map();
  const get = endpoint => {
    if (!cache.has(endpoint)) cache.set(endpoint, githubApi(endpoint, { token, request }));
    return cache.get(endpoint);
  };
  const resolve = async ref => {
    assert.match(ref ?? '', /^(?:main|[a-f0-9]{7,40})$/, 'missing or invalid BUILD_SHA');
    const commit = await get(`/commits/${ref}`);
    assert.match(commit?.sha ?? '', SHA, 'GitHub did not resolve a full commit SHA');
    if (ref !== 'main') assert.ok(commit.sha.startsWith(ref), 'GitHub resolved a different build');
    return commit.sha;
  };
  const changedFiles = async sha => {
    const files = [];
    for (let page = 1; page <= 30; page++) {
      const result = await get(`/commits/${sha}?per_page=100&page=${page}`);
      assert.equal(result?.sha, sha, 'GitHub commit changed during pagination');
      assert.ok(Array.isArray(result.files), 'GitHub commit file history is unavailable');
      for (const file of result.files) {
        assert.ok(typeof file.filename === 'string', 'invalid GitHub commit path');
        files.push(file.filename);
        if (file.previous_filename) files.push(file.previous_filename);
      }
      if (result.files.length < 100) return files;
    }
    throw new Error('GitHub commit file list may be truncated; history cannot be verified');
  };
  return {
    resolve,
    async compare(service, source, main) {
      if (source === main) return { source, main, current: true };
      const commits = [];
      let total;
      for (let page = 1; page <= MAX_COMMITS / 100; page++) {
        const comparison = await get(`/compare/${source}...${main}?per_page=100&page=${page}`);
        assert.ok(comparison?.status === 'ahead' && comparison.merge_base_commit?.sha === source,
          'production source is not an ancestor of main');
        total ??= comparison.total_commits;
        assert.ok(Number.isInteger(total) && total > 0 && total <= MAX_COMMITS,
          'GitHub comparison exceeds the bounded history limit');
        assert.equal(comparison.total_commits, total, 'GitHub comparison changed during pagination');
        assert.ok(Array.isArray(comparison.commits), 'GitHub comparison commits are unavailable');
        for (const commit of comparison.commits) {
          assert.match(commit?.sha ?? '', SHA, 'invalid GitHub commit SHA');
          commits.push(commit.sha);
        }
        if (commits.length >= total) break;
        assert.equal(comparison.commits.length, 100, 'GitHub comparison history is incomplete');
      }
      assert.ok(commits.length === total && new Set(commits).size === total && commits.at(-1) === main,
        'GitHub comparison history is incomplete');
      let current = true;
      for (const sha of commits) {
        if (affectedWorkers(await changedFiles(sha)).includes(service)) current = false;
      }
      return { source, main, current };
    },
  };
}

export async function checkGithubReleaseDrift({ env, request = fetch } = {}) {
  try {
    assert.ok(env.GITHUB_TOKEN, 'GITHUB_TOKEN with repository Contents access is required');
    const history = githubHistory({ token: env.GITHUB_TOKEN, request });
    const main = await history.resolve('main');
    const results = [];
    for (const [service, script] of Object.entries(WORKERS)) {
      const name = `${script} active BUILD_SHA matches main code`;
      try {
        const version = await activeWorkerVersion(script, { env, request });
        const detail = await workerApi(`${script}/versions/${version}`, { env, request });
        const bindings = detail?.resources?.bindings?.filter(b => b.name === 'BUILD_SHA' && b.type === 'plain_text');
        assert.equal(bindings?.length, 1, 'active version must have a unique BUILD_SHA');
        const source = await history.resolve(bindings[0].text);
        const result = await history.compare(service, source, main);
        assert.ok(result.current, `unreleased changes: production=${source.slice(0, 12)} main=${main.slice(0, 12)}`);
        results.push({ name, ok: true, build: source.slice(0, 12), main: main.slice(0, 12), version });
      } catch (error) {
        results.push({ name, ok: false, detail: error.message });
      }
    }
    return results;
  } catch (error) {
    return [{ name: 'production Worker versions match main code', ok: false, detail: error.message }];
  }
}
