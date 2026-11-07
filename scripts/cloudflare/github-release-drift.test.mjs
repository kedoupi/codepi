import assert from 'node:assert/strict';
import test from 'node:test';
import { githubHistory, checkGithubReleaseDrift } from './github-release-drift.mjs';
import { githubApi } from './github-api.mjs';

const base = 'a'.repeat(40), code = 'b'.repeat(40), main = 'c'.repeat(40);
const commit = (sha, filenames, parents = [base]) => ({
  sha,
  parents: parents.map(parent => ({ sha: parent })),
  files: filenames.map(filename => typeof filename === 'string' ? { filename } : filename),
});
function historyRequest({ changes = { [code]: ['apps/gu/src/a.ts'], [main]: ['docs/undo.md'] },
  parents = {}, compareFiles = {}, netFiles = [], status = 'ahead', total = 2,
  commits = [{ sha: code }, { sha: main }] } = {}) {
  const entries = files => files.map(file => typeof file === 'string' ? { filename: file } : file);
  return async (url, init) => {
    assert.equal(init.redirect, 'manual');
    const u = new URL(url), path = u.pathname.split('/codepi')[1];
    assert.equal(u.hostname, 'api.github.com');
    if (path === '/commits/main') return Response.json({ sha: main });
    if (path === '/commits/' + base.slice(0, 12)) return Response.json({ sha: base });
    if (path.startsWith('/compare/')) {
      const key = path.slice('/compare/'.length);
      const [left, right] = key.split('...');
      const sourceComparison = left === base && (right === main || commits.at(-1)?.sha === right);
      return Response.json({
        status, total_commits: sourceComparison ? total : 1,
        merge_base_commit: { sha: sourceComparison ? base : left },
        commits: sourceComparison ? commits : [{ sha: right }],
        files: sourceComparison ? entries(netFiles) : entries(compareFiles[key] ?? []),
      });
    }
    const sha = path.split('/')[2];
    return Response.json(commit(sha, changes[sha] ?? [], parents[sha] ?? [base]));
  };
}

test('GitHub drift sees reverted code, merge changes and the old side of a rename', async () => {
  const history = githubHistory({ token: 'synthetic', request: historyRequest({ changes: {
    [code]: [{ filename: 'docs/moved.md', previous_filename: 'apps/gu/src/a.ts' }],
    [main]: ['apps/health/workers/api/src/merge-only.ts'],
  } }) });
  assert.equal(await history.resolve('main'), main);
  assert.equal(await history.resolve(base.slice(0, 12)), base);
  assert.equal((await history.compare('gu', base, main)).current, false);
  assert.equal((await history.compare('mcp', base, main)).current, false);
  assert.equal((await history.compare('health-web', base, main)).current, true);
});

test('GitHub drift intersects every merge parent and includes net compare files', async () => {
  const merge = 'd'.repeat(40), feature = 'e'.repeat(40);
  const history = githubHistory({ token: 'synthetic', request: historyRequest({
    total: 1,
    commits: [{ sha: merge }],
    changes: { [merge]: ['apps/gu/src/shared.ts', 'apps/gu/src/ours-only.ts'] },
    parents: { [merge]: [base, feature] },
    compareFiles: { [`${feature}...${merge}`]: ['apps/gu/src/shared.ts'] },
    netFiles: ['apps/health/workers/api/src/net-revert.ts'],
  }) });
  assert.equal((await history.compare('gu', base, merge)).current, false);
});

test('GitHub drift reports merge parent and net compare changes for their services', async () => {
  const merge = 'd'.repeat(40), feature = 'e'.repeat(40);
  const request = historyRequest({
    total: 1,
    commits: [{ sha: merge }],
    changes: { [merge]: ['apps/gu/src/shared.ts', 'apps/gu/src/ours-only.ts'] },
    parents: { [merge]: [base, feature] },
    compareFiles: { [`${feature}...${merge}`]: ['apps/gu/src/shared.ts'] },
    netFiles: ['apps/health/workers/api/src/net-revert.ts'],
  });
  const history = githubHistory({ token: 'synthetic', request });
  assert.equal((await history.compare('health-api', base, merge)).current, false);
  assert.equal((await history.compare('web', base, merge)).current, true);
});

test('merge second parent equal to production source ignores first-parent-only Project files', async () => {
  const merge = '0'.repeat(40), firstParent = '1'.repeat(40);
  const history = githubHistory({ token: 'synthetic', request: historyRequest({
    total: 1,
    commits: [{ sha: merge }],
    changes: { [merge]: ['apps/project/worker/first-parent-only.ts'] },
    parents: { [merge]: [firstParent, base] },
    netFiles: ['apps/rhythm/worker/net-change.ts'],
  }) });
  assert.equal((await history.compare('project', base, merge)).current, true);
  assert.equal((await history.compare('mcp', base, merge)).current, true);
  assert.equal((await history.compare('rhythm', base, merge)).current, false);
});

test('merge changes shared by both parents make Project drift', async () => {
  const merge = '2'.repeat(40), firstParent = '3'.repeat(40), feature = '4'.repeat(40);
  const history = githubHistory({ token: 'synthetic', request: historyRequest({
    total: 1,
    commits: [{ sha: merge }],
    changes: { [merge]: ['apps/project/worker/merge-shared.ts'] },
    parents: { [merge]: [firstParent, feature] },
    compareFiles: { [`${feature}...${merge}`]: ['apps/project/worker/merge-shared.ts'] },
    netFiles: ['apps/rhythm/worker/net-change.ts'],
  }) });
  assert.equal((await history.compare('project', base, merge)).current, false);
  assert.equal((await history.compare('mcp', base, merge)).current, false);
});

test('ordinary commits on the second-parent branch remain in the compare history', async () => {
  const normal = '5'.repeat(40), merge = '6'.repeat(40), firstParent = '7'.repeat(40);
  const history = githubHistory({ token: 'synthetic', request: historyRequest({
    total: 2,
    commits: [{ sha: normal }, { sha: merge }],
    changes: {
      [normal]: ['apps/gu/worker/second-parent.ts'],
      [merge]: ['apps/project/worker/merge-only.ts'],
    },
    parents: { [normal]: [base], [merge]: [firstParent, base] },
    netFiles: ['apps/rhythm/worker/net-change.ts'],
  }) });
  assert.equal((await history.compare('gu', base, merge)).current, false);
  assert.equal((await history.compare('project', base, merge)).current, true);
  assert.equal((await history.compare('mcp', base, merge)).current, false);
});

test('net source-to-main files catch a merge tree change absent from parent diffs', async () => {
  const merge = '8'.repeat(40), firstParent = '9'.repeat(40), feature = 'f'.repeat(40);
  const history = githubHistory({ token: 'synthetic', request: historyRequest({
    total: 1,
    commits: [{ sha: merge }],
    changes: { [merge]: [] },
    parents: { [merge]: [firstParent, feature] },
    compareFiles: { [`${feature}...${merge}`]: [] },
    netFiles: ['apps/me/worker/net-only.ts'],
  }) });
  assert.equal((await history.compare('me', base, merge)).current, false);
  assert.equal((await history.compare('project', base, merge)).current, true);
  assert.equal((await history.compare('mcp', base, merge)).current, false);
});

test('GitHub parent compare file pagination fails closed at the provider cap', async () => {
  const merge = 'd'.repeat(40), feature = 'e'.repeat(40);
  const history = githubHistory({ token: 'synthetic', request: historyRequest({
    total: 1,
    commits: [{ sha: merge }],
    changes: { [merge]: ['apps/gu/src/shared.ts'] },
    parents: { [merge]: [base, feature] },
    compareFiles: { [`${feature}...${merge}`]: Array(100).fill('apps/gu/src/file.ts') },
  }) });
  await assert.rejects(history.compare('gu', base, merge), /truncated/);
});

test('GitHub drift accepts documentation gaps and fails closed on unknown history', async () => {
  const history = githubHistory({ token: 'synthetic', request: historyRequest({
    changes: { [code]: ['docs/first.md'], [main]: ['services/mcp/README.md'] },
  }) });
  assert.equal((await history.compare('mcp', base, main)).current, true);
  for (const options of [{ status: 'diverged' }, { total: 501 }, { total: 3 }]) {
    await assert.rejects(githubHistory({ token: 'synthetic', request: historyRequest(options) }).compare('mcp', base, main));
  }
  await assert.rejects(githubHistory({ token: 'synthetic', request: historyRequest({
    parents: { [code]: [] },
  }) }).compare('mcp', base, main), /parents/);
  await assert.rejects(githubHistory({ token: 'synthetic', request: async url => {
    const response = await historyRequest()(url, { redirect: 'manual' });
    if (url.includes(`/commits/${code}?`)) return Response.json({ sha: code, files: [] });
    return response;
  } }).compare('mcp', base, main), /parents/);
  await assert.rejects(history.resolve('local'), /invalid BUILD_SHA/);
  const result = await checkGithubReleaseDrift({ env: {} });
  assert.equal(result[0].ok, false);
  assert.match(result[0].detail, /GITHUB_TOKEN/);
});

test('GitHub file pagination checks later pages instead of accepting the compare file list', async () => {
  const pages = [];
  const request = async (url, init = { redirect: 'manual' }) => {
    assert.equal(init.redirect, 'manual');
    const u = new URL(url), page = Number(u.searchParams.get('page'));
    if (u.pathname.includes('/compare/')) return Response.json({
      status: 'ahead', total_commits: 1, merge_base_commit: { sha: base }, commits: [{ sha: main }], files: [],
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
