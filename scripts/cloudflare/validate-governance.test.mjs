// validate-governance.mjs 的 fixture 测试：完整合法 topology（www/gu/gzh/auth/
// health-api/health-pages）必须通过；每类非法配置必须非空并报出违规资源名。
// staging 已退役：合法 fixture 一律不含 staging 段，且任何 staging 残留必须被拒绝。
// 只用临时目录与子进程 CLI，不触仓库文件与远程。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { collectViolations } from './validate-governance.mjs';

const VALIDATOR = fileURLToPath(new URL('./validate-governance.mjs', import.meta.url));

// ---- fixture UUID ----
const U = {
  www: 'aaaaaaaa-0000-4000-8000-000000000001',
  gu: 'bbbbbbbb-0000-4000-8000-000000000001',
  gzh: 'cccccccc-0000-4000-8000-000000000001',
  auth: 'dddddddd-0000-4000-8000-000000000001',
  health: 'eeeeeeee-0000-4000-8000-000000000001',
};

const REGISTRY_ROWS = [
  ['worker-www', 'production', 'worker', 'codepi-www', 'codepi.app, www.codepi.app'],
  ['worker-gu', 'production', 'worker', 'codepi-gu', 'gu.codepi.app, codepi-gu.workers.dev'],
  ['worker-gzh', 'production', 'worker', 'codepi-gzh', 'gzh.codepi.app'],
  ['worker-health', 'production', 'worker', 'codepi-health', 'health.codepi.app'],
  ['worker-auth', 'production', 'worker', 'codepi-auth', 'auth.codepi.app (custom domain)'],
  ['worker-health-api', 'production', 'worker', 'codepi-health-api', 'health.codepi.app/api/*'],
  ['d1-www', 'production', 'd1', `codepi-desk (${U.www})`, '-'],
  ['d1-gu', 'production', 'd1', `codepi-gu (${U.gu})`, '-'],
  ['d1-gzh', 'production', 'd1', `codepi-gzh (${U.gzh})`, '-'],
  ['d1-auth', 'production', 'd1', `codepi-auth (${U.auth})`, '-'],
  ['d1-health', 'production', 'd1', `codepi-health (${U.health})`, '-'],
];

function registryText(rows = REGISTRY_ROWS) {
  const body = rows.map(r =>
    `| ${r[0]} | ${r[1]} | ${r[2]} | ${r[3]} | kedoupi | fixture | synthetic | - | ${r[4]} | fixture | ${r[5] || 'managed'} | 2026-10-15 |`).join('\n');
  return `# fixture\n<!-- registry-table:begin -->\n${body}\n<!-- registry-table:end -->\n`;
}

// ---- fixture 配置 ----
const OBSERVABILITY = `
[observability]
enabled = true
redact_query_string = true
[observability.logs]
enabled = true
invocation_logs = true
persist = true
`;

// 与 apps/health/apps/web/wrangler.toml 对齐：纯代理，只有 ASSETS + WORKER。
function healthPagesConfig({ includeWorker = true, workerService = 'codepi-health-api', extra = '' } = {}) {
  const worker = includeWorker ? `[[services]]
binding = "WORKER"
service = "${workerService}"
` : '';
  return `
name = "codepi-health"
main = "worker/index.ts"
[assets]
directory = "./dist"
binding = "ASSETS"
not_found_handling = "single-page-application"
run_worker_first = ["/api/*", "/mcp", "/oauth/*", "/.well-known/*", "/well-known/*"]
${worker}${OBSERVABILITY}${extra}`;
}

function healthApiConfig({ duplicateAuth = false } = {}) {
  return `
name = "codepi-health-api"
[vars]
ENVIRONMENT = "production"
AUTO_SYNC_ENABLED = "1"
ALLOW_DEV_LOGIN = "0"
AUTH_ORIGIN = "https://auth.codepi.app"
FRONTEND_ORIGIN = "https://health.codepi.app"
FRONTEND_ORIGINS = "https://health.codepi.app"
OURA_REDIRECT_URI = "https://health.codepi.app/api/auth/oura/callback"
[triggers]
crons = ["*/2 * * * *"]
[[services]]
binding = "AUTH"
service = "codepi-auth"
${duplicateAuth ? '[[services]]\nbinding = "AUTH"\nservice = "codepi-auth"\n' : ''}[[d1_databases]]
binding = "DB"
database_name = "codepi-health"
database_id = "${U.health}"
${OBSERVABILITY}
`;
}

function authConfig() {
  return JSON.stringify({
    name: 'codepi-auth',
    main: 'src/index.ts',
    observability: {
      enabled: true, redact_query_string: true,
      logs: { enabled: true, invocation_logs: true, persist: true },
    },
    routes: [{ pattern: 'auth.codepi.app', custom_domain: true }],
    vars: {
      ENVIRONMENT: 'production',
      AUTH_ORIGIN: 'https://auth.codepi.app',
      SSO_EXTRA_REDIRECT_URIS: '{"gu":["https://gu.kdp.cool/api/auth/callback","https://gu.codepi.app/api/auth/callback"],"oura":["https://health.kdp.cool/api/auth/callback","https://health.codepi.app/api/auth/callback"],"gzh":["https://gzh.codepi.app/api/auth/callback"],"desk":["https://kdp.cool/api/auth/callback","https://codepi.app/api/auth/callback"]}',
    },
    d1_databases: [{ binding: 'DB', database_name: 'codepi-auth', database_id: U.auth, migrations_dir: 'migrations' }],
    triggers: { crons: ['17 3 * * *'] },
  });
}

function legalFiles(overrides = {}) {
  return {
    'docs/development/cloudflare-resource-registry.md': registryText(overrides.registryRows),
    'apps/web/wrangler.toml': webWorkerConfig(),
    'apps/gu/wrangler.toml': privateWorkerConfig(),
    'apps/gzh/wrangler.toml': privateWorkerConfig({ app: 'gzh' }),
    'services/auth/wrangler.jsonc': authConfig(),
    'apps/health/workers/api/wrangler.toml': healthApiConfig(),
    'apps/health/apps/web/wrangler.toml': healthPagesConfig(),
    ...overrides.files,
  };
}

function fixtureRoot(files) {
  const root = mkdtempSync(path.join(tmpdir(), 'cf-gov-'));
  for (const [file, content] of Object.entries(files)) {
    const full = path.join(root, file);
    mkdirSync(path.dirname(full), { recursive: true });
    writeFileSync(full, content);
  }
  return root;
}

function run(files) {
  const root = fixtureRoot(files);
  try {
    return collectViolations({ root, requireAll: false });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

function runCli(files) {
  const root = fixtureRoot(files);
  try {
    return spawnSync(process.execPath, [VALIDATOR, '--root', root], { encoding: 'utf8' });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

function privateWorkerConfig({ app = 'gu', assetsBlock = `[assets]\ndirectory = "./dist"\nbinding = "ASSETS"\nrun_worker_first = true\n` } = {}) {
  return `
name = "codepi-${app}"
main = "worker/index.ts"
${assetsBlock}[[services]]
binding = "AUTH"
service = "codepi-auth"
[[d1_databases]]
binding = "DB"
database_name = "codepi-${app}"
database_id = "${U[app]}"
[vars]
ENVIRONMENT = "production"
AUTH_ORIGIN = "https://auth.codepi.app"
AUTH_CLIENT_ID = "${app}"
${OBSERVABILITY}
`;
}

function webWorkerConfig() {
  return privateWorkerConfig({ app: 'www' })
    .replace('run_worker_first = true', 'run_worker_first = ["/api/*", "/desk", "/desk/*"]\nnot_found_handling = "404-page"')
    .replaceAll('database_name = "codepi-www', 'database_name = "codepi-desk');
}

test('www preserves API-first routing and forbids staging asset overrides', () => {
  for (const config of [
    webWorkerConfig().replace('run_worker_first = ["/api/*", "/desk", "/desk/*"]', 'run_worker_first = false'),
    webWorkerConfig().replace('run_worker_first = ["/api/*", "/desk", "/desk/*"]', 'run_worker_first = ["/api/auth/*"]'),
    webWorkerConfig().replace('run_worker_first = ["/api/*", "/desk", "/desk/*"]', 'run_worker_first = ["/api/*"]'),
    webWorkerConfig() + '\n[env.staging.assets]\nrun_worker_first = false\n',
  ]) {
    assert.ok(run(legalFiles({ files: { 'apps/web/wrangler.toml': config } }))
      .some(v => v.startsWith('www:') && (v.includes('run_worker_first') || v.includes('assets overrides') || v.includes('staging'))));
  }
});

// ---- 合法 topology ----

test('完整合法 topology（www/gu/gzh/auth/health-api/health-pages）通过', () => {
  assert.deepEqual(run(legalFiles()), []);
});

test('CLI：合法 fixture 退出 0', () => {
  const result = runCli(legalFiles());
  assert.equal(result.status, 0, result.stderr);
});

test('logs must persist and OAuth query strings must be redacted', () => {
  for (const config of [
    healthApiConfig().replace('redact_query_string = true', 'redact_query_string = false'),
    healthApiConfig().replace('persist = true', 'persist = false'),
    healthApiConfig().replace('invocation_logs = true', 'invocation_logs = false'),
    healthApiConfig().replace(OBSERVABILITY, ''),
  ]) {
    assert.ok(run(legalFiles({ files: { 'apps/health/workers/api/wrangler.toml': config } })).some(v =>
      v.startsWith('health-api:') && /logs|redact/.test(v)));
  }
  const config = JSON.parse(authConfig());
  config.observability.redact_query_string = false;
  assert.ok(run(legalFiles({ files: { 'services/auth/wrangler.jsonc': JSON.stringify(config) } }))
    .some(v => v.startsWith('auth:') && v.includes('redact')));
});

// ---- staging 退役 ----

test('任何 staging 段残留被拒绝', () => {
  const stagingSection = '\n[env.staging]\nname = "codepi-gu-staging"\n[env.staging.vars]\nENVIRONMENT = "staging"\nAUTH_ORIGIN = "https://auth-staging.codepi.app"\n';
  for (const [file, config] of [
    ['apps/gu/wrangler.toml', privateWorkerConfig() + stagingSection],
    ['apps/health/workers/api/wrangler.toml', healthApiConfig() + stagingSection.replace('codepi-gu-staging', 'codepi-health-api-staging')],
    ['services/auth/wrangler.jsonc', JSON.stringify({ ...JSON.parse(authConfig()), env: { staging: { name: 'codepi-auth-staging' } } })],
  ]) {
    const violations = run(legalFiles({ files: { [file]: config } }));
    assert.ok(violations.some(v => v.includes('staging environment is retired')),
      `expected staging-retired violation for ${file}: ${JSON.stringify(violations)}`);
  }
});

test('route 指向 staging 主机被拒绝', () => {
  // auth 是唯一保留公网 route 的 Worker；把它的 custom domain 换成 staging 主机。
  const cfg = JSON.parse(authConfig());
  cfg.routes = [{ pattern: 'auth-staging.codepi.app', custom_domain: true }];
  const violations = run(legalFiles({ files: { 'services/auth/wrangler.jsonc': JSON.stringify(cfg) } }));
  assert.ok(violations.some(v => v.includes('auth-staging.codepi.app') && v.includes('staging')),
    `expected staging-host violation: ${JSON.stringify(violations)}`);
});

test('health-api 声明公网 routes 被拒绝（流量由前端 Worker 转发）', () => {
  const cfg = healthApiConfig().replace('[vars]', `routes = [
  { pattern = "health.codepi.app/api/*", zone_name = "codepi.app" }
]

[vars]`);
  const violations = run(legalFiles({ files: { 'apps/health/workers/api/wrangler.toml': cfg } }));
  assert.ok(violations.some(v => v.includes('health-api') && v.includes('must not declare public routes')),
    `expected no-routes violation: ${JSON.stringify(violations)}`);
});

// ---- 既有负例 ----

test('引用未登记资源被拒绝', () => {
  const files = legalFiles({ files: { 'apps/gzh/wrangler.toml': privateWorkerConfig({ app: 'gzh' }).replace(U.gzh, '99999999-9999-4999-8999-999999999999') } });
  const violations = run(files);
  assert.ok(violations.some(v => v.includes('99999999-9999-4999-8999-999999999999') && v.includes('no registry record')),
    `expected registry violation, got ${JSON.stringify(violations)}`);
});

for (const app of ['gu', 'gzh']) {
  test(`${app} assets 缺少 run_worker_first=true 被拒绝（鉴权不得被资产绕过）`, () => {
    const violations = run(legalFiles({ files: { [`apps/${app}/wrangler.toml`]: privateWorkerConfig({ app, assetsBlock: '[assets]\ndirectory = "./dist"\nbinding = "ASSETS"\n' }) } }));
    assert.ok(violations.some(v => v.startsWith(app + ':') && v.includes('run_worker_first')),
      `expected run_worker_first violation, got ${JSON.stringify(violations)}`);
  });

  test(`${app} 缺少 [assets] 段被拒绝`, () => {
    const violations = run(legalFiles({ files: { [`apps/${app}/wrangler.toml`]: privateWorkerConfig({ app, assetsBlock: '' }) } }));
    assert.ok(violations.some(v => v.startsWith(app + ':') && v.includes('[assets]')),
      `expected assets violation, got ${JSON.stringify(violations)}`);
  });

  test(`${app} 重复 [assets] 表被拒绝`, () => {
    const doubled = privateWorkerConfig({ app, assetsBlock: '[assets]\ndirectory = "./dist"\n[assets]\nbinding = "ASSETS"\nrun_worker_first = true\n' });
    const violations = run(legalFiles({ files: { [`apps/${app}/wrangler.toml`]: doubled } }));
    assert.ok(violations.some(v => v.startsWith(app + ':') && v.includes('exactly once')),
      `expected duplicate-table violation, got ${JSON.stringify(violations)}`);
  });

  test(`${app} run_worker_first 数组形式被拒绝（鉴权应用必须无条件先进 Worker）`, () => {
    const arrayForm = privateWorkerConfig({ app, assetsBlock: '[assets]\ndirectory = "./dist"\nbinding = "ASSETS"\nrun_worker_first = ["/api/*"]\n' });
    const violations = run(legalFiles({ files: { [`apps/${app}/wrangler.toml`]: arrayForm } }));
    assert.ok(violations.some(v => v.startsWith(app + ':') && v.includes('run_worker_first')),
      `expected run_worker_first violation, got ${JSON.stringify(violations)}`);
  });

  test(`${app} run_worker_first 双重声明被拒绝`, () => {
    const doubled = privateWorkerConfig({ app, assetsBlock: '[assets]\ndirectory = "./dist"\nbinding = "ASSETS"\nrun_worker_first = true\nrun_worker_first = ["/api/*"]\n' });
    const violations = run(legalFiles({ files: { [`apps/${app}/wrangler.toml`]: doubled } }));
    assert.ok(violations.some(v => v.startsWith(app + ':') && v.includes('run_worker_first exactly once')),
      `expected duplicate-declaration violation, got ${JSON.stringify(violations)}`);
  });
}

test('引用 legacy 资源被拒绝', () => {
  const rows = REGISTRY_ROWS.map(r => r[0] === 'd1-gzh' ? [r[0], r[1], r[2], r[3], r[4], 'legacy-pending-retirement'] : r);
  const violations = run(legalFiles({ registryRows: rows }));
  assert.ok(violations.some(v => v.includes('legacy-pending-retirement')),
    `expected legacy violation, got ${JSON.stringify(violations)}`);
});

test('retired Pages and unknown unrelated resources do not shadow same-name Workers or D1', () => {
  const rows = [...REGISTRY_ROWS,
    ['pages-gu-legacy', 'production', 'pages', 'codepi-gu', 'codepi-gu.pages.dev', 'legacy-pending-retirement'],
    ['r2-auth-unknown', 'production', 'r2', 'codepi-auth', '-', 'unknown'],
  ];
  assert.deepEqual(run(legalFiles({ registryRows: rows })), []);
});

test('a managed duplicate cannot hide legacy or unknown records in the referenced namespace', () => {
  for (const [id, type, name, status, label] of [
    ['worker-gu-conflict', 'worker', 'codepi-gu', 'legacy-pending-retirement', 'name'],
    ['worker-auth-conflict', 'worker', 'codepi-auth', 'unknown', 'service binding'],
    ['d1-gu-conflict', 'd1', `codepi-gu (${U.gu})`, 'legacy-preview', 'D1'],
  ]) {
    const rows = [...REGISTRY_ROWS, [id, 'production', type, name, '-', status]];
    const violations = run(legalFiles({ registryRows: rows }));
    assert.ok(violations.some(v => v.includes(`referenced ${label}`) && v.includes(status)),
      `expected same-namespace conflict for ${id}: ${JSON.stringify(violations)}`);
  }
});

// ---- Health 前端代理边界 ----

test('Health Pages 缺 WORKER binding 被拒绝', () => {
  const violations = run(legalFiles({ files: { 'apps/health/apps/web/wrangler.toml': healthPagesConfig({ includeWorker: false }) } }));
  assert.ok(violations.some(v => v.includes('health-pages') && v.includes('WORKER') && v.includes('codepi-health-api')),
    `expected WORKER violation, got ${JSON.stringify(violations)}`);
});

test('Health Pages WORKER binding 指向错误服务被拒绝', () => {
  const violations = run(legalFiles({ files: { 'apps/health/apps/web/wrangler.toml': healthPagesConfig({ workerService: 'codepi-auth' }) } }));
  assert.ok(violations.some(v => v.includes('health-pages') && v.includes('WORKER')),
    `expected WORKER violation, got ${JSON.stringify(violations)}`);
});

test('Health Pages 声明 D1 / AUTH / vars 等后端职责被拒绝', () => {
  for (const [label, extra, needle] of [
    ['D1', `[[d1_databases]]\nbinding = "DB"\ndatabase_name = "codepi-health"\ndatabase_id = "${U.health}"\n`, 'must not declare a D1 binding'],
    ['AUTH binding', '[[services]]\nbinding = "AUTH"\nservice = "codepi-auth"\n', 'unexpected service binding "AUTH"'],
    ['vars', '[vars]\nENVIRONMENT = "production"\nAUTH_ORIGIN = "https://auth.codepi.app"\n', 'must not declare'],
  ]) {
    const violations = run(legalFiles({ files: { 'apps/health/apps/web/wrangler.toml': healthPagesConfig({ extra }) } }));
    assert.ok(violations.some(v => v.includes('health-pages') && v.includes(needle)),
      `${label}: expected violation, got ${JSON.stringify(violations)}`);
  }
});

test('重复/冲突 service binding 被拒绝', () => {
  const violations = run(legalFiles({ files: { 'apps/health/workers/api/wrangler.toml': healthApiConfig({ duplicateAuth: true }) } }));
  assert.ok(violations.some(v => v.includes('duplicate service binding') && v.includes('AUTH')),
    `expected duplicate binding violation, got ${JSON.stringify(violations)}`);
});

test('缺 D1、额外 D1 或名称与 ID 跨登记行时被拒绝', () => {
  const noD1 = privateWorkerConfig({ app: 'gzh' })
    .replace(/\[\[d1_databases\]\][\s\S]*?database_id = "[^"]+"\n/, '');
  const extraD1 = privateWorkerConfig({ app: 'gzh' })
    .replace('database_id = "' + U.gzh + '"', `database_id = "${U.gzh}"\n[[d1_databases]]\nbinding = "OTHER"\ndatabase_name = "codepi-gzh"\ndatabase_id = "${U.gzh}"`);
  const mismatchedRow = privateWorkerConfig({ app: 'gzh' }).replace(`database_id = "${U.gzh}"`, `database_id = "${U.gu}"`);
  for (const [label, config, needle] of [['missing D1', noD1, 'exactly one D1'], ['extra D1', extraD1, 'exactly one D1'], ['mismatched registry row', mismatchedRow, 'matching both name and database_id']]) {
    const violations = run(legalFiles({ files: { 'apps/gzh/wrangler.toml': config } }));
    assert.ok(violations.some(v => v.includes(needle)), `${label}: ${JSON.stringify(violations)}`);
  }
});

test('Health API 缺失或指向其他产品的 URL 变量被拒绝', () => {
  const missingFrontendOrigins = healthApiConfig().replace('FRONTEND_ORIGINS = "https://health.codepi.app"\n', '');
  const missingRedirect = healthApiConfig().replace('OURA_REDIRECT_URI = "https://health.codepi.app/api/auth/oura/callback"\n', '');
  const misdirected = healthApiConfig().replaceAll('https://health.codepi.app', 'https://gu.codepi.app');
  for (const [config, needle] of [
    [missingFrontendOrigins, 'FRONTEND_ORIGINS'],
    [missingRedirect, 'OURA_REDIRECT_URI'],
    [misdirected, 'FRONTEND_ORIGIN'],
  ]) {
    const violations = run(legalFiles({ files: { 'apps/health/workers/api/wrangler.toml': config } }));
    assert.ok(violations.some(v => v.includes(needle)), `expected ${needle}: ${JSON.stringify(violations)}`);
  }
});

test('错误 Auth route、非数组 route 与 JSONC 重复 D1/service 均被拒绝', () => {
  const wrongRoute = JSON.parse(authConfig());
  wrongRoute.routes = [{ pattern: 'gu.codepi.app', custom_domain: true }];
  const malformedRoutes = JSON.parse(authConfig());
  malformedRoutes.routes = { pattern: 'auth.codepi.app', custom_domain: true };
  const duplicateBindings = JSON.parse(authConfig());
  duplicateBindings.d1_databases.push({ ...duplicateBindings.d1_databases[0] });
  duplicateBindings.services = [
    { binding: 'AUTH', service: 'codepi-auth' },
    { binding: 'AUTH', service: 'codepi-auth' },
  ];
  for (const [file, config, needle] of [
    ['services/auth/wrangler.jsonc', JSON.stringify(wrongRoute), 'auth route'],
    ['services/auth/wrangler.jsonc', JSON.stringify(malformedRoutes), 'routes declaration'],
    ['services/auth/wrangler.jsonc', JSON.stringify(duplicateBindings), 'duplicate D1 binding'],
  ]) {
    const violations = run(legalFiles({ files: { [file]: config } }));
    assert.ok(violations.some(v => v.includes(needle)), `expected ${needle}: ${JSON.stringify(violations)}`);
  }
});

// ---- CLI 负例：退出 1、stderr 点名违规资源、不泄露 secret ----

test('CLI：非法 fixture 退出 1 且 stderr 点名违规资源', () => {
  const files = legalFiles({ files: { 'apps/health/apps/web/wrangler.toml': healthPagesConfig({ includeWorker: false }) } });
  const result = runCli(files);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /health-pages/);
  assert.match(result.stderr, /WORKER/);
  assert.doesNotMatch(result.stderr, /secret|SECRET|token|TOKEN/);
});

test('CLI：未知选项退出 1', () => {
  const result = spawnSync(process.execPath, [VALIDATOR, '--bogus'], { encoding: 'utf8' });
  assert.equal(result.status, 1);
});
