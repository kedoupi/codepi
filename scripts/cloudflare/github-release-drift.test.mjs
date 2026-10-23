import assert from 'node:assert/strict';
import test from 'node:test';
import { githubHistory, checkGithubReleaseDrift } from './github-release-drift.mjs';
import { githubApi } from './github-api.mjs';

const base = 'a'.repeat(40), code = 'b'.repeat(40), main = 'c'.repeat(40);
const commit = (sha, filenames) => ({ sha, files: filenames.map(filename =>
  typeof filename === 'string' ? { filename } : filename) });
function historyRequest({ changes = { [code]: ['apps/gu/src/a.ts'], [main]: ['docs/undo.md'] },
  status = 'ahead', total = 2 } = {}) {
  return async (url, init) => {
    assert.equal(init.redirect, 'manual');
    assert.equal(new URL(url).hostname, 'api.github.com');
    const path = new URL(url).pathname.split('/codepi')[1];
    if (path === '/commits/main') return Response.json({ sha: main });
    if (path === '/commits/' + base.slice(0, 12)) return Response.json({ sha: base });
    if (path.startsWith('/compare/')) return Response.json({
      status, total_commits: total, merge_base_commit: { sha: base }, commits: [{ sha: code }, { sha: main }],
      // Deliberately misleading net diff: it must never determine the answer.
      files: [],
    });
    const sha = path.split('/')[2];
    return Response.json(commit(sha, changes[sha] ?? []));
  };
}

test('GitHub drift sees reverted code, merge changes and the old side of a rename', async () => {
  const request = historyRequest({ changes: {
    [code]: [{ filename: 'docs/moved.md', previous_filename: 'apps/gu/src/a.ts' }],
    [main]: ['apps/health/workers/api/src/merge-only.ts'],
  } });
  const history = githubHistory({ token: 'synthetic', request });
  assert.equal(await history.resolve('main'), main);
  assert.equal(await history.resolve(base.slice(0, 12)), base);
  assert.equal((await history.compare('gu', base, main)).current, false);
  assert.equal((await history.compare('mcp', base, main)).current, false);
  assert.equal((await history.compare('health-web', base, main)).current, true);
});

test('GitHub drift accepts documentation gaps and fails closed on unknown history', async () => {
  const history = githubHistory({ token: 'synthetic', request: historyRequest({
    changes: { [code]: ['docs/first.md'], [main]: ['services/mcp/README.md'] },
  }) });
  assert.equal((await history.compare('mcp', base, main)).current, true);
  for (const options of [{ status: 'diverged' }, { total: 501 }, { total: 3 }]) {
    await assert.rejects(githubHistory({ token: 'synthetic', request: historyRequest(options) }).compare('mcp', base, main));
  }
  await assert.rejects(history.resolve('local'), /invalid BUILD_SHA/);
  const result = await checkGithubReleaseDrift({ env: {} });
  assert.equal(result[0].ok, false);
  assert.match(result[0].detail, /GITHUB_TOKEN/);
});

test('GitHub file pagination checks later pages instead of accepting the compare file list', async () => {
  const pages = [];
  const request = async url => {
    const u = new URL(url), page = Number(u.searchParams.get('page'));
    if (u.pathname.includes('/compare/')) return Response.json({
      status: 'ahead', total_commits: 1, merge_base_commit: { sha: base }, commits: [{ sha: main }],
    });
    pages.push(page);
    return Response.json(commit(main, page === 1
      ? Array.from({ length: 100 }, (_, i) => `docs/${i}.md`) : ['services/mcp/src/index.ts']));
  };
  const result = await githubHistory({ token: 'synthetic', request }).compare('mcp', base, main);
  assert.equal(result.current, false);
  assert.deepEqual(pages, [1, 2]);
  await assert.rejects(githubHistory({ token: 'synthetic', request: async url =>
    url.includes('/compare/') ? request(url) : Response.json(commit(main, Array(100).fill('docs/a.md'))) })
    .compare('mcp', base, main), /truncated/);
});

test('GitHub failures do not echo provider text or credentials', async () => {
  await assert.rejects(githubApi('/commits/main', { token: 'SECRET', request: async () =>
    Response.json({ message: 'PRIVATE SQL SECRET' }, { status: 403 }) }), error =>
    /HTTP 403/.test(error.message) && !/PRIVATE|SECRET/.test(error.message));
});
