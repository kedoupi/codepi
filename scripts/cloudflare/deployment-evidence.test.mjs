// deployment-evidence.mjs 纯函数测试：版本/URL 提取、证据条目校验、
// Pages deployment 匹配与 JSONL 追加。不访问网络。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { appendEntry, buildEntry, extractPagesUrl, extractWorkerVersion, findPagesDeployment } from './deployment-evidence.mjs';

test('extractWorkerVersion 解析 Current/Worker Version ID', () => {
  const id = '0a1b2c3d-4e5f-6789-abcd-ef0123456789';
  assert.equal(extractWorkerVersion(`Deployed\nCurrent Version ID: ${id}`), id);
  assert.equal(extractWorkerVersion(`Worker Version ID: ${id}`), id);
  assert.equal(extractWorkerVersion('no version here'), null);
});

test('extractPagesUrl 提取 pinned 多级标签 pages.dev URL', () => {
  assert.equal(extractPagesUrl('Uploaded https://abc123.pages.dev'), 'https://abc123.pages.dev');
  const wranglerOutput = `✨ Deployment complete! Take a peek over at https://a1b2c3d4e5f6.codepi-gzh.pages.dev
✨ To deploy to this URL of your production site, run the following command:
`;
  assert.equal(extractPagesUrl(wranglerOutput), 'https://a1b2c3d4e5f6.codepi-gzh.pages.dev');
  assert.equal(extractPagesUrl('✨ Deployment complete! Take a peek over at https://x.y.pages.dev.'), 'https://x.y.pages.dev');
  assert.equal(extractPagesUrl('nothing'), null);
});

test('buildEntry 校验必填字段并拒绝凭据形态', () => {
  const entry = buildEntry({ service: 'health', target: 'staging', sha: 'abc123', provider: 'worker', identifier: 'v1', smoke: 'pass' });
  assert.equal(entry.service, 'health');
  assert.ok(entry.recorded_at);
  assert.throws(() => buildEntry({ service: '', target: 'staging', sha: 'abc123', provider: 'worker', identifier: 'v1', smoke: 'pass' }));
  assert.throws(() => buildEntry({ service: 'health', target: 'qa', sha: 'abc123', provider: 'worker', identifier: 'v1', smoke: 'pass' }));
});

test('findPagesDeployment 按 URL/alias 匹配', () => {
  const deployments = [
    { id: 'dep-old', url: 'https://old.pages.dev' },
    { id: 'dep-new', url: 'https://new.pages.dev', aliases: ['https://alias.pages.dev/'] },
  ];
  assert.equal(findPagesDeployment(deployments, 'https://new.pages.dev')?.id, 'dep-new');
  assert.equal(findPagesDeployment(deployments, 'https://alias.pages.dev')?.id, 'dep-new');
  assert.equal(findPagesDeployment(deployments, 'https://missing.pages.dev'), null);
  assert.equal(findPagesDeployment(deployments, ''), null);
});

test('appendEntry 追加 JSONL', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'cf-evidence-'));
  const file = path.join(dir, 'evidence.jsonl');
  try {
    const entry = buildEntry({ service: 'auth', target: 'production', sha: 'def456', provider: 'pages', identifier: 'dep-new', smoke: 'pass' });
    appendEntry(file, entry);
    appendEntry(file, entry);
    const lines = readFileSync(file, 'utf8').trim().split('\n');
    assert.equal(lines.length, 2);
    assert.equal(JSON.parse(lines[0]).service, 'auth');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
