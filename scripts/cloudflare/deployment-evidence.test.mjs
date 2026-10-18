// deployment-evidence.mjs 纯函数测试：版本/URL 提取、证据条目校验、
// Pages deployment 匹配与 JSONL 追加。不访问网络。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { appendEntry, buildEntry, extractPagesUrl, extractWorkerVersion, findPagesDeployment, resolveWorkerOrigin } from './deployment-evidence.mjs';

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

const requiredSecrets = ['AUTH_CLIENT_SECRET', 'DESK_SUMMARY_TOKEN'];
function workerApi(overrides = {}) {
  const results = {
    '/workers/scripts/codepi-gu/secrets': requiredSecrets.map(name => ({ name, type: 'secret_text' })),
    '/workers/scripts/codepi-gu/subdomain': { enabled: true },
    '/workers/subdomain': { subdomain: 'synthetic-account' },
    ...overrides,
  };
  const calls = [];
  return { calls, token: 'synthetic-api-token', account: 'test-account',
    request: async (url, options) => {
      assert.equal(options.headers.Authorization, 'Bearer synthetic-api-token');
      assert.ok(options.signal);
      const prefix = 'https://api.cloudflare.com/client/v4/accounts/test-account';
      assert.ok(url.startsWith(prefix));
      const pathname = url.slice(prefix.length);
      calls.push(pathname);
      assert.ok(Object.hasOwn(results, pathname), `unexpected API request: ${pathname}`);
      return Response.json({ success: true, result: results[pathname] });
    },
  };
}

test('resolveWorkerOrigin checks required names and enabled routing without legacy secrets or manual variables', async () => {
  const api = workerApi();
  assert.equal(await resolveWorkerOrigin('codepi-gu', requiredSecrets, api),
    'https://codepi-gu.synthetic-account.workers.dev');
  assert.equal(api.calls.length, 3);
});

test('resolveWorkerOrigin accepts an explicit empty secret contract for the Health frontend proxy', async () => {
  const api = workerApi({ '/workers/scripts/codepi-gu/secrets': [] });
  assert.equal(await resolveWorkerOrigin('codepi-gu', [], api),
    'https://codepi-gu.synthetic-account.workers.dev');
  assert.equal(api.calls.length, 3, 'an empty contract still verifies routing and metadata');
});

test('resolveWorkerOrigin rejects missing secrets, wrong binding types and malformed payloads', async () => {
  for (const result of [[], null, {}, [
    { name: 'AUTH_CLIENT_SECRET', type: 'plain_text' },
    { name: 'DESK_SUMMARY_TOKEN', type: 'secret_text' },
  ]]) {
    const api = workerApi({ '/workers/scripts/codepi-gu/secrets': result });
    await assert.rejects(resolveWorkerOrigin('codepi-gu', requiredSecrets, api), /runtime secrets|unexpected payload/);
    assert.equal(api.calls.length, 1, 'missing secrets must stop before routing discovery');
  }
});

test('resolveWorkerOrigin fails closed on API errors without printing response contents', async () => {
  for (const response of [
    Response.json({ success: false, errors: [{ message: 'private-provider-detail' }] }),
    Response.json({ success: true, result: [] }, { status: 403 }),
    Response.json({ success: 'true', result: [] }),
    new Response('private-provider-detail', { status: 502 }),
  ]) {
    const api = { ...workerApi(), request: async () => response };
    await assert.rejects(resolveWorkerOrigin('codepi-gu', requiredSecrets, api), error => {
      assert.match(error.message, /Cloudflare API GET/);
      assert.doesNotMatch(error.message, /private-provider-detail|synthetic-api-token/);
      return true;
    });
  }
});

test('resolveWorkerOrigin rejects disabled routes and malformed account subdomains', async () => {
  for (const enabled of [false, undefined, 'true']) {
    await assert.rejects(resolveWorkerOrigin('codepi-gu', requiredSecrets,
      workerApi({ '/workers/scripts/codepi-gu/subdomain': { enabled } })), /routing is disabled/);
  }
  for (const subdomain of ['', undefined, '-invalid', 'account.example', 'account\norigin=https://invalid', 123]) {
    await assert.rejects(resolveWorkerOrigin('codepi-gu', requiredSecrets,
      workerApi({ '/workers/subdomain': { subdomain } })), /subdomain is missing or invalid/);
  }
});

test('resolveWorkerOrigin requires a Worker name and explicit secret names before requesting metadata', async () => {
  const api = workerApi();
  for (const script of ['', undefined, '../auth', 'gu\nmalicious', 'gu.example']) {
    await assert.rejects(resolveWorkerOrigin(script, requiredSecrets, api), /invalid Worker name/);
  }
  for (const secrets of [undefined, [''], ['AUTH_CLIENT_SECRET\n'], [null]]) {
    await assert.rejects(resolveWorkerOrigin('codepi-gu', secrets, api), /required secret names/);
  }
  assert.equal(api.calls.length, 0);
});
