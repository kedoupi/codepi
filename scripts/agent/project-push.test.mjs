import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  adapterFrom,
  buildPayload,
  changelogFromGit,
  main,
  pushPayload,
  tasksFromTable,
} from './project-push.mjs';

const ROOT = path.resolve(new URL('../..', import.meta.url).pathname);
const fakeGit = args => {
  if (args[0] === 'rev-parse') return 'a'.repeat(40);
  if (args[0] === 'branch') return 'team/project-push';
  if (args[0] === 'worktree') return '';
  if (args[0] === 'log') return '';
  return '';
};

async function fixture(table) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'codepi-project-push-'));
  await mkdir(path.join(root, 'docs/development/tasks'), { recursive: true });
  await writeFile(path.join(root, 'docs/development/tasks/README.md'), table, 'utf8');
  await writeFile(path.join(root, 'AGENTS.md'), '# Rules\n', 'utf8');
  return root;
}

const table = `# Tasks\n\n| 工作 | 状态 | 需要你 | 当前事实 | 下一步 |\n| --- | --- | --- | --- | --- |\n| [链接任务](https://example.test/task) | 执行 | 确认：登录今天页 | 已完成核对 | 看[记录](record.md) |\n`;

test('parses the task table and maps labels', () => {
  const [task] = tasksFromTable(table);
  assert.deepEqual(task, {
    title: '链接任务', category: 'codepi', status: 'doing', due: null, recorded: null,
    what: '已完成核对', impact: null, advice: '看记录', need: '确认：登录今天页',
    need_kind: 'confirm', source: null, related: [],
  });
});

test('rejects an unknown status before building a payload', () => {
  assert.throws(() => tasksFromTable(table.replace('执行', '未知')), /未知状态/);
});

test('rejects an unknown need prefix before building a payload', () => {
  assert.throws(() => tasksFromTable(table.replace('确认：登录今天页', '稍后')), /未知需要你/);
});

test('parses the real adapter section, including the first commit command', async () => {
  const agents = await (await import('node:fs/promises')).readFile(path.join(ROOT, 'AGENTS.md'), 'utf8');
  const adapter = adapterFrom(agents);
  assert.equal(adapter.commit, 'team/<task>');
  assert.equal(adapter.isolation, 'worktree');
  assert.ok(adapter.acceptance.includes('node scripts/agent/check.mjs --base main --run'));
  assert.equal(adapter.merge, 'agent-team merge');
});

test('extracts merge titles, converts dates to +08:00, keeps the 30-day boundary, and clips titles', () => {
  const longTitle = 'x'.repeat(220);
  const output = [
    `2026-10-05T23:59:59+08:00\tMerge team/old: excluded`,
    `2026-10-05T23:59:59-08:00\tMerge team/boundary: ${longTitle}`,
    '2026-11-01T01:00:00+08:00\tMerge team/one: included',
    '2026-11-02T01:00:00+08:00\tNo colon subject',
  ].join('\n');
  const entries = changelogFromGit('/tmp', { today: '2026-11-05', git: () => output });
  assert.deepEqual(entries.map(entry => entry.date), ['2026-10-06', '2026-11-01', '2026-11-02']);
  assert.equal(entries[0].title.length, 200);
  assert.equal(entries[0].title, `${'x'.repeat(199)}…`);
  assert.equal(entries[2].title, 'No colon subject');
});

test('builds a non-empty payload from the real task index', async () => {
  const payload = await buildPayload(ROOT, { generatedAt: '2026-11-05T00:00:00.000Z', git: fakeGit });
  assert.equal(payload.schema, 'workbench.v1');
  assert.equal(payload.project.name, 'codepi');
  assert.ok(payload.tasks.length > 0);
  assert.equal(payload.tasks[0].category, 'codepi');
});

test('blocks a credential-shaped task value without making a request', async () => {
  const root = await fixture(table.replace('已完成核对', 'token=abcdefghijklmnop'));
  let calls = 0;
  const code = await main(['--root', root], {
    token: 'unused', git: fakeGit, fetchImpl: async () => { calls += 1; },
  });
  assert.equal(code, 2);
  assert.equal(calls, 0);
});

test('does not push an unknown status', async () => {
  const root = await fixture(table.replace('执行', '未知'));
  let calls = 0;
  const code = await main(['--root', root], {
    token: 'unused', git: fakeGit, fetchImpl: async () => { calls += 1; },
  });
  assert.equal(code, 2);
  assert.equal(calls, 0);
});

test('sends the expected URL, headers and body', async () => {
  let request;
  const response = await pushPayload({ schema: 'workbench.v1' }, 'secret-token', {
    fetchImpl: async (url, init) => {
      request = { url, init };
      return { status: 200, json: async () => ({ deduplicated: true }) };
    },
  });
  assert.equal(response.status, 200);
  assert.equal(request.url, 'https://project.codepi.app/api/ingest/codepi');
  assert.equal(request.init.method, 'POST');
  assert.equal(request.init.headers.Authorization, 'Bearer secret-token');
  assert.equal(request.init.headers['User-Agent'], 'codepi-project-push/1');
  assert.deepEqual(JSON.parse(request.init.body), { schema: 'workbench.v1' });
});

test('--if-configured exits quietly when the keychain has no token', async () => {
  const root = await fixture(table);
  let calls = 0;
  const code = await main(['--if-configured', '--root', root], {
    readToken: () => null, git: fakeGit, fetchImpl: async () => { calls += 1; },
  });
  assert.equal(code, 0);
  assert.equal(calls, 0);
});
