// 部署证据：把每次部署的 service/target/SHA/provider 标识/smoke 结果写成
// JSONL 证据文件（不含任何 secret 值），供 deploy-platform.yml 上传为 artifact。
// 只写仓库/CI 文件；解析 Pages deployment 时仅对 Cloudflare API 做只读查询。
import { appendFileSync, readFileSync } from 'node:fs';

export function extractWorkerVersion(output) {
  const match = String(output).match(/(?:(?:Current Version ID|Worker Version ID):\s*([a-f0-9-]{36})|Deployed\s+([a-f0-9-]{36}))/i);
  return match?.[1] ?? match?.[2] ?? null;
}

// 从 wrangler pages deploy 输出提取 pinned deployment URL
// （形如 https://<hash>.<project>.pages.dev，可多级标签）。
export function extractPagesUrl(output) {
  const match = String(output).match(/https:\/\/[a-z0-9-]+(?:\.[a-z0-9-]+)*\.pages\.dev[^\s]*/i);
  return match?.[0].replace(/[),.]+$/, '') ?? null;
}

export function buildEntry({ service, target, sha, provider, identifier, smoke }) {
  for (const [key, value] of Object.entries({ service, target, sha, provider, identifier, smoke })) {
    if (typeof value !== 'string' || !value.trim()) throw new Error(`evidence entry requires ${key}`);
    if (/[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}/.test(value)) {
      // 证据永不携带凭据形态的字符串；只允许 URL/ID/名称等可公开元数据。
      throw new Error(`evidence ${key} looks like a credential; refusing to record it`);
    }
  }
  if (!['production', 'staging', 'pr'].includes(target)) throw new Error(`unknown evidence target: ${target}`);
  if (!['pages', 'worker'].includes(provider)) throw new Error(`unknown evidence provider: ${provider}`);
  return { service, target, sha, provider, identifier, smoke, recorded_at: new Date().toISOString() };
}

export function appendEntry(file, entry) {
  appendFileSync(file, JSON.stringify(entry) + '\n');
}

// 在 Pages deployments 列表中按 URL 匹配 deployment（url/aliases 字段）。
export function findPagesDeployment(deployments, url) {
  if (!url) return null;
  const target = String(url).replace(/\/+$/, '');
  for (const deployment of deployments ?? []) {
    const candidates = [deployment.url, ...(deployment.aliases ?? [])].filter(Boolean);
    if (candidates.some(candidate => String(candidate).replace(/\/+$/, '') === target)) return deployment;
  }
  return null;
}

async function cloudflare(pathname, { token, account }) {
  const response = await fetch(`https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(account)}${pathname}`, {
    headers: { Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(30_000),
  });
  const body = await response.json().catch(() => null);
  if (!response.ok || !body?.success) {
    throw new Error(`Cloudflare API GET ${pathname} failed (HTTP ${response.status})`);
  }
  return body.result;
}

async function main(args = process.argv.slice(2)) {
  const command = args[0];
  if (command === 'append') {
    const file = args[args.indexOf('--file') + 1];
    if (!file) throw new Error('append requires --file');
    const fields = {};
    for (const key of ['service', 'target', 'sha', 'provider', 'identifier', 'smoke']) {
      const i = args.indexOf(`--${key}`);
      if (i !== -1 && args[i + 1]) fields[key] = args[i + 1];
    }
    appendEntry(file, buildEntry(fields));
    return 0;
  }
  if (command === 'resolve-pages') {
    const project = args[args.indexOf('--project') + 1];
    const url = args[args.indexOf('--url') + 1];
    if (!project || !url) throw new Error('resolve-pages requires --project and --url');
    const token = process.env.CLOUDFLARE_API_TOKEN;
    const account = process.env.CLOUDFLARE_ACCOUNT_ID;
    if (!token || !account) throw new Error('resolve-pages requires CLOUDFLARE_API_TOKEN/CLOUDFLARE_ACCOUNT_ID');
    const result = await cloudflare(`/pages/projects/${encodeURIComponent(project)}/deployments?per_page=25`, { token, account });
    const list = Array.isArray(result) ? result : (result?.deployments ?? []);
    const deployment = findPagesDeployment(list, url);
    if (!deployment?.id) throw new Error(`no Cloudflare Pages deployment matches ${url} for project ${project}`);
    console.log(deployment.id);
    return 0;
  }
  if (command === 'worker-version') {
    const output = readFileSync(0, 'utf8');
    const version = extractWorkerVersion(output);
    if (!version) throw new Error('no Worker version ID found in deploy output');
    console.log(version);
    return 0;
  }
  if (command === 'pages-url') {
    const output = readFileSync(0, 'utf8');
    const url = extractPagesUrl(output);
    if (!url) throw new Error('no pages.dev deployment URL found in wrangler output');
    console.log(url);
    return 0;
  }
  console.error('Usage: node deployment-evidence.mjs append|resolve-pages|worker-version|pages-url ...');
  return 1;
}

const invoked = process.argv[1] && import.meta.url.endsWith(process.argv[1].split('/').pop());
if (invoked) {
  Promise.resolve(main()).then(code => { process.exitCode = code; })
    .catch(error => { console.error(error.message); process.exitCode = 1; });
}
