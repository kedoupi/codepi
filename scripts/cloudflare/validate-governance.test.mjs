// validate-governance.mjs 的 fixture 测试：完整合法 topology（www/gu/gzh/auth/
// health-api/health-pages）必须通过；每类非法配置必须非空并报出违规资源名。
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
  www: 'aaaaaaaa-0000-4000-8000-000000000001', wwwStg: 'aaaaaaaa-0000-4000-8000-000000000002',
  gu: 'bbbbbbbb-0000-4000-8000-000000000001', guStg: 'bbbbbbbb-0000-4000-8000-000000000002',
  gzh: 'cccccccc-0000-4000-8000-000000000001', gzhStg: 'cccccccc-0000-4000-8000-000000000002',
  auth: 'dddddddd-0000-4000-8000-000000000001', authStg: 'dddddddd-0000-4000-8000-000000000002',
  health: 'eeeeeeee-0000-4000-8000-000000000001', healthStg: 'eeeeeeee-0000-4000-8000-000000000002',
};

const REGISTRY_ROWS = [
  ['worker-www', 'production', 'worker', 'codepi-www', 'codepi.app, www.codepi.app'],
  ['worker-www-staging', 'staging', 'worker', 'codepi-www-staging', 'staging.codepi.app'],
  ['worker-gu', 'production', 'worker', 'codepi-gu', 'gu.codepi.app, codepi-gu.workers.dev'],
  ['worker-gzh', 'production', 'worker', 'codepi-gzh', 'gzh.codepi.app'],
  ['pages-health', 'production', 'pages', 'codepi-health', 'health.codepi.app'],
  ['pages-www-staging-host', 'staging', 'pages-domain', 'staging.codepi.app → staging.codepi-www.pages.dev', 'staging.codepi.app'],
  ['pages-gu-staging-host', 'staging', 'pages-domain', 'gu-staging.codepi.app → staging.codepi-gu.pages.dev', 'gu-staging.codepi.app'],
  ['pages-gzh-staging-host', 'staging', 'pages-domain', 'gzh-staging.codepi.app → staging.codepi-gzh.pages.dev', 'gzh-staging.codepi.app'],
  ['pages-health-staging-host', 'staging', 'pages-domain', 'health-staging.codepi.app → staging.codepi-health.pages.dev', 'health-staging.codepi.app'],
  ['worker-auth', 'production', 'worker', 'codepi-auth', 'auth.codepi.app (custom domain)'],
  ['worker-auth-staging', 'staging', 'worker', 'codepi-auth-staging', 'auth-staging.codepi.app (custom domain)'],
  ['worker-gu-staging', 'staging', 'worker', 'codepi-gu-staging', 'gu-staging.codepi.app（待绑定）'],
  ['worker-gzh-staging', 'staging', 'worker', 'codepi-gzh-staging', 'gzh-staging.codepi.app（待绑定）'],
  ['worker-health-api', 'production', 'worker', 'codepi-health-api', 'health.codepi.app/api/*'],
  ['worker-health-api-staging', 'staging', 'worker', 'codepi-health-api-staging', 'health-staging.codepi.app/api/*'],
  ['d1-www', 'production', 'd1', `codepi-desk (${U.www})`, '-'],
  ['d1-www-staging', 'staging', 'd1', `codepi-desk-staging (${U.wwwStg})`, '-'],
  ['d1-gu', 'production', 'd1', `codepi-gu (${U.gu})`, '-'],
  ['d1-gu-staging', 'staging', 'd1', `codepi-gu-staging (${U.guStg})`, '-'],
  ['d1-gzh', 'production', 'd1', `codepi-gzh (${U.gzh})`, '-'],
  ['d1-gzh-staging', 'staging', 'd1', `codepi-gzh-staging (${U.gzhStg})`, '-'],
  ['d1-auth', 'production', 'd1', `codepi-auth (${U.auth})`, '-'],
  ['d1-auth-staging', 'staging', 'd1', `codepi-auth-staging (${U.authStg})`, '-'],
  ['d1-health', 'production', 'd1', `codepi-health (${U.health})`, '-'],
  ['d1-health-staging', 'staging', 'd1', `codepi-health-staging (${U.healthStg})`, '-'],
];

function registryText(rows = REGISTRY_ROWS) {
  const body = rows.map(r =>
    `| ${r[0]} | ${r[1]} | ${r[2]} | ${r[3]} | kedoupi | fixture | synthetic | - | ${r[4]} | fixture | ${r[5] || 'managed'} | 2026-10-15 |`).join('\n');
  return `# fixture\n<!-- registry-table:begin -->\n${body}\n<!-- registry-table:end -->\n`;
}

// ---- fixture 配置 ----

function pagesConfig({ name, clientId, prodD1Name, prodD1Id, stgD1Name, stgD1Id }) {
  return `
name = "${name}"
pages_build_output_dir = "./dist"
[[services]]
binding = "AUTH"
service = "codepi-auth"
[[d1_databases]]
binding = "DB"
database_name = "${prodD1Name}"
database_id = "${prodD1Id}"
[vars]
ENVIRONMENT = "production"
AUTH_ORIGIN = "https://auth.codepi.app"
[env.preview]
[[env.preview.services]]
binding = "AUTH"
service = "codepi-auth-staging"
[[env.preview.d1_databases]]
binding = "DB"
database_name = "${stgD1Name}"
database_id = "${stgD1Id}"
[env.preview.vars]
ENVIRONMENT = "staging"
AUTH_ORIGIN = "https://auth-staging.codepi.app"
AUTH_CLIENT_ID = "${clientId}"
`;
}

function healthPagesConfig({ stgFrontend = 'https://health-staging.codepi.app', stgRedirect = 'https://health-staging.codepi.app/api/auth/oura/callback', workerStg = 'codepi-health-api-staging', includeWorker = true, authStg = 'codepi-auth-staging', stgD1 = true } = {}) {
  const worker = includeWorker ? `[[services]]
binding = "WORKER"
service = "codepi-health-api"
[[env.preview.services]]
binding = "WORKER"
service = "${workerStg}"
` : '';
  const d1 = stgD1 ? `[[env.preview.d1_databases]]
binding = "DB"
database_name = "codepi-health-staging"
database_id = "${U.healthStg}"
` : '';
  return `
name = "codepi-health"
pages_build_output_dir = "./dist"
${worker}[[services]]
binding = "AUTH"
service = "codepi-auth"
[[d1_databases]]
binding = "DB"
database_name = "codepi-health"
database_id = "${U.health}"
[vars]
ENVIRONMENT = "production"
AUTH_ORIGIN = "https://auth.codepi.app"
FRONTEND_ORIGIN = "https://health.codepi.app"
FRONTEND_ORIGINS = "https://health.codepi.app"
OURA_REDIRECT_URI = "https://health.codepi.app/api/auth/oura/callback"
ALLOW_DEV_LOGIN = "0"
[env.preview]
[[env.preview.services]]
binding = "AUTH"
service = "${authStg}"
${d1}
[env.preview.vars]
ENVIRONMENT = "staging"
AUTH_ORIGIN = "https://auth-staging.codepi.app"
FRONTEND_ORIGIN = "${stgFrontend}"
FRONTEND_ORIGINS = "${stgFrontend}"
OURA_REDIRECT_URI = "${stgRedirect}"
ALLOW_DEV_LOGIN = "0"
`;
}

function healthApiConfig({ autoSync = '0', stgFrontend = 'https://health-staging.codepi.app', stgRedirect = 'https://health-staging.codepi.app/api/auth/oura/callback', stgRoutes = null, stgCrons = ['*/2 * * * *'], includeStgD1 = true, includeStgAuth = true, duplicateAuth = false } = {}) {
  const stgRouteList = (stgRoutes ?? ['health-staging.codepi.app/api/*', 'health-staging.codepi.app/mcp', 'health-staging.codepi.app/oauth*', 'health-staging.codepi.app/.well-known*'])
    .map(r => `  { pattern = "${r}", zone_name = "codepi.app" },`).join('\n');
  const stgCronList = stgCrons === null ? '' : `[env.staging.triggers]
crons = ${JSON.stringify(stgCrons)}
`;
  const auth = includeStgAuth ? `[[env.staging.services]]
binding = "AUTH"
service = "codepi-auth-staging"
${duplicateAuth ? '[[env.staging.services]]\nbinding = "AUTH"\nservice = "codepi-auth-staging"\n' : ''}` : '';
  const d1 = includeStgD1 ? `[[env.staging.d1_databases]]
binding = "DB"
database_name = "codepi-health-staging"
database_id = "${U.healthStg}"
` : '';
  return `
name = "codepi-health-api"
routes = [
  { pattern = "health.codepi.app/api/*", zone_name = "codepi.app" },
  { pattern = "health.codepi.app/mcp", zone_name = "codepi.app" },
  { pattern = "health.codepi.app/oauth*", zone_name = "codepi.app" },
  { pattern = "health.codepi.app/.well-known*", zone_name = "codepi.app" }
]
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
[[d1_databases]]
binding = "DB"
database_name = "codepi-health"
database_id = "${U.health}"
[env.staging]
name = "codepi-health-api-staging"
routes = [
${stgRouteList}
]
[env.staging.vars]
ENVIRONMENT = "staging"
AUTO_SYNC_ENABLED = "${autoSync}"
ALLOW_DEV_LOGIN = "0"
AUTH_ORIGIN = "https://auth-staging.codepi.app"
FRONTEND_ORIGIN = "${stgFrontend}"
FRONTEND_ORIGINS = "${stgFrontend}"
OURA_REDIRECT_URI = "${stgRedirect}"
${stgCronList}${auth}${d1}
`;
}

function authConfig() {
  return JSON.stringify({
    name: 'codepi-auth',
    main: 'src/index.ts',
    routes: [{ pattern: 'auth.codepi.app', custom_domain: true }],
    vars: {
      ENVIRONMENT: 'production',
      AUTH_ORIGIN: 'https://auth.codepi.app',
      SSO_EXTRA_REDIRECT_URIS: '{"gu":["https://gu.kdp.cool/api/auth/callback","https://gu.codepi.app/api/auth/callback"],"oura":["https://health.kdp.cool/api/auth/callback","https://health.codepi.app/api/auth/callback"],"gzh":["https://gzh.codepi.app/api/auth/callback"],"desk":["https://kdp.cool/api/auth/callback","https://codepi.app/api/auth/callback"]}',
    },
    d1_databases: [{ binding: 'DB', database_name: 'codepi-auth', database_id: U.auth, migrations_dir: 'migrations' }],
    triggers: { crons: ['17 3 * * *'] },
    env: {
      staging: {
        name: 'codepi-auth-staging',
        routes: [{ pattern: 'auth-staging.codepi.app', custom_domain: true }],
        vars: {
          ENVIRONMENT: 'staging',
          AUTH_ORIGIN: 'https://auth-staging.codepi.app',
          SSO_EXTRA_REDIRECT_URIS: '{"gu":["https://gu-staging.codepi.app/api/auth/callback"],"oura":["https://health-staging.codepi.app/api/auth/callback"],"gzh":["https://gzh-staging.codepi.app/api/auth/callback"],"desk":["https://staging.codepi.app/api/auth/callback"]}',
        },
        d1_databases: [{ binding: 'DB', database_name: 'codepi-auth-staging', database_id: U.authStg, migrations_dir: 'migrations' }],
        triggers: { crons: ['17 3 * * *'] },
      },
    },
  });
}

function legalFiles(overrides = {}) {
  return {
    'docs/development/cloudflare-resource-registry.md': registryText(overrides.registryRows),
    'apps/web/wrangler.toml': webWorkerConfig(),
    'apps/gu/wrangler.toml': privateWorkerConfig(),
    'apps/gzh/wrangler.toml': privateWorkerConfig({ app: 'gzh' }),
    'services/auth/wrangler.jsonc': authConfig(),
    'apps/oura/workers/api/wrangler.toml': healthApiConfig(),
    'apps/oura/apps/web/wrangler.toml': healthPagesConfig(),
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

function privateWorkerConfig({ app = 'gu', assetsBlock = `[assets]\ndirectory = "./dist"\nbinding = "ASSETS"\nrun_worker_first = true\n`, envKey = 'staging', stagingName = `codepi-${app}-staging` } = {}) {
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
[env.${envKey}]
name = "${stagingName}"
[[env.${envKey}.services]]
binding = "AUTH"
service = "codepi-auth-staging"
[[env.${envKey}.d1_databases]]
binding = "DB"
database_name = "codepi-${app}-staging"
database_id = "${U[`${app}Stg`]}"
[env.${envKey}.vars]
ENVIRONMENT = "staging"
AUTH_ORIGIN = "https://auth-staging.codepi.app"
AUTH_CLIENT_ID = "${app}"
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
      .some(v => v.startsWith('www:') && (v.includes('run_worker_first') || v.includes('assets overrides'))));
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

// ---- 既有负例 ----

test('staging 指向生产 D1 被拒绝并指出资源', () => {
  const files = legalFiles({ files: { 'apps/gzh/wrangler.toml': privateWorkerConfig({ app: 'gzh' }).replace(U.gzhStg, U.gzh) } });
  const violations = run(files);
  assert.ok(violations.some(v => v.includes('gzh') && v.includes(U.gzh) && v.includes('production D1')),
    `expected D1 violation, got ${JSON.stringify(violations)}`);
});

test('staging Worker 指向生产 Auth 被拒绝', () => {
  const files = legalFiles({ files: { 'apps/gu/wrangler.toml': privateWorkerConfig().replace('service = "codepi-auth-staging"', 'service = "codepi-auth"') } });
  const violations = run(files);
  assert.ok(violations.some(v => v.includes('gu') && v.includes('AUTH') && v.includes('codepi-auth')),
    `expected AUTH violation, got ${JSON.stringify(violations)}`);
});

test('引用未登记资源被拒绝', () => {
  const files = legalFiles({ files: { 'apps/gzh/wrangler.toml': privateWorkerConfig({ app: 'gzh' }).replace(U.gzh, '99999999-9999-4999-8999-999999999999') } });
  const violations = run(files);
  assert.ok(violations.some(v => v.includes('99999999-9999-4999-8999-999999999999') && v.includes('no registry record')),
    `expected registry violation, got ${JSON.stringify(violations)}`);
});

test('Health staging 打开自动同步被拒绝', () => {
  const violations = run(legalFiles({ files: { 'apps/oura/workers/api/wrangler.toml': healthApiConfig({ autoSync: '1' }) } }));
  assert.ok(violations.some(v => v.includes('health-api') && v.includes('AUTO_SYNC_ENABLED')),
    `expected auto-sync violation, got ${JSON.stringify(violations)}`);
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

  test(`${app} staging 仍用 Pages preview 环境被拒绝`, () => {
    const violations = run(legalFiles({ files: { [`apps/${app}/wrangler.toml`]: privateWorkerConfig({ app, envKey: 'preview' }) } }));
    assert.ok(violations.some(v => v.startsWith(app + ':')),
      `expected staging environment violation, got ${JSON.stringify(violations)}`);
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

  test(`${app} staging 环境 assets 覆盖被拒绝`, () => {
    const overridden = privateWorkerConfig({ app }) + '\n[env.staging.assets]\nrun_worker_first = false\n';
    const violations = run(legalFiles({ files: { [`apps/${app}/wrangler.toml`]: overridden } }));
    assert.ok(violations.some(v => v.startsWith(app + ':') && v.includes('per-environment assets')),
      `expected env-assets violation, got ${JSON.stringify(violations)}`);
  });

  test(`${app} 环境 assets 覆盖的 TOML 写法变体同样被拒绝`, () => {
    for (const header of ['[ env.staging.assets ]', '[env.staging."assets"]', "[env.staging.'assets']", '[env.staging."\\u0061ssets"]']) {
      const variant = privateWorkerConfig({ app }) + `\n${header}\nrun_worker_first = false\n`;
      const violations = run(legalFiles({ files: { [`apps/${app}/wrangler.toml`]: variant } }));
      assert.ok(violations.some(v => v.startsWith(app + ':') && v.includes('per-environment assets')),
        `expected env-assets violation for ${header}, got ${JSON.stringify(violations)}`);
    }
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

// ---- 新增负例 ----

test('Health staging frontend origin 使用生产域名被拒绝', () => {
  const violations = run(legalFiles({ files: { 'apps/oura/workers/api/wrangler.toml': healthApiConfig({ stgFrontend: 'https://health.codepi.app' }) } }));
  assert.ok(violations.some(v => v.includes('health-api') && v.includes('production hostname')),
    `expected production-host violation, got ${JSON.stringify(violations)}`);
});

test('Health staging OURA_REDIRECT_URI 使用生产域名被拒绝', () => {
  const violations = run(legalFiles({ files: { 'apps/oura/apps/web/wrangler.toml': healthPagesConfig({ stgRedirect: 'https://health.codepi.app/api/auth/oura/callback' }) } }));
  assert.ok(violations.some(v => v.includes('health-pages') && v.includes('OURA_REDIRECT_URI') && v.includes('production hostname')),
    `expected redirect violation, got ${JSON.stringify(violations)}`);
});

test('Health staging route 使用生产域名被拒绝', () => {
  const violations = run(legalFiles({ files: { 'apps/oura/workers/api/wrangler.toml': healthApiConfig({ stgRoutes: ['health.codepi.app/api/*', 'health-staging.codepi.app/mcp', 'health-staging.codepi.app/oauth*', 'health-staging.codepi.app/.well-known*'] }) } }));
  assert.ok(violations.some(v => v.includes('health-api') && v.includes('route') && v.includes('production hostname')),
    `expected route violation, got ${JSON.stringify(violations)}`);
});

test('Health Pages 缺 WORKER binding 被拒绝', () => {
  const violations = run(legalFiles({ files: { 'apps/oura/apps/web/wrangler.toml': healthPagesConfig({ includeWorker: false }) } }));
  assert.ok(violations.some(v => v.includes('health-pages') && v.includes('WORKER') && v.includes('codepi-health-api')),
    `expected WORKER violation, got ${JSON.stringify(violations)}`);
});

test('Health Pages WORKER binding 指向错误服务被拒绝', () => {
  const violations = run(legalFiles({ files: { 'apps/oura/apps/web/wrangler.toml': healthPagesConfig({ workerStg: 'codepi-health-api' }) } }));
  assert.ok(violations.some(v => v.includes('health-pages') && v.includes('WORKER')),
    `expected WORKER violation, got ${JSON.stringify(violations)}`);
});

test('缺 staging D1 / AUTH / route / cron 声明被拒绝', () => {
  for (const [label, file, config, needle] of [
    ['staging D1', 'apps/oura/apps/web/wrangler.toml', healthPagesConfig({ stgD1: false }), 'D1'],
    ['staging AUTH', 'apps/oura/apps/web/wrangler.toml', healthPagesConfig({ authStg: 'codepi-auth' }), 'AUTH'],
    ['staging route', 'apps/oura/workers/api/wrangler.toml', healthApiConfig({ stgRoutes: [] }), 'routes'],
    ['staging cron', 'apps/oura/workers/api/wrangler.toml', healthApiConfig({ stgCrons: null }), 'crons'],
  ]) {
    const violations = run(legalFiles({ files: { [file]: config } }));
    assert.ok(violations.some(v => v.includes(needle)), `missing ${label}: expected violation mentioning ${needle}, got ${JSON.stringify(violations)}`);
  }
});

test('重复/冲突 service binding 被拒绝', () => {
  const violations = run(legalFiles({ files: { 'apps/oura/workers/api/wrangler.toml': healthApiConfig({ duplicateAuth: true }) } }));
  assert.ok(violations.some(v => v.includes('duplicate service binding') && v.includes('AUTH')),
    `expected duplicate binding violation, got ${JSON.stringify(violations)}`);
});

test('登记表 environment 不匹配被拒绝', () => {
  // staging D1 的 UUID 只登记在 production 行：环境不兼容。
  const rows = REGISTRY_ROWS.map(r => r[0] === 'd1-health-staging'
    ? ['d1-health-staging', 'production', 'd1', `codepi-health-staging (${U.healthStg})`, '-'] : r);
  const violations = run(legalFiles({ registryRows: rows, files: { 'apps/oura/apps/web/wrangler.toml': healthPagesConfig() } }));
  assert.ok(violations.some(v => v.includes(U.healthStg) && v.includes('no managed staging registry row')),
    `expected environment mismatch, got ${JSON.stringify(violations)}`);
});

test('登记表 resource_type 不匹配被拒绝', () => {
  // WORKER binding 目标被登记成 pages 而非 worker。
  const rows = REGISTRY_ROWS.map(r => r[0] === 'worker-health-api-staging'
    ? ['worker-health-api-staging', 'staging', 'pages', 'codepi-health-api-staging', 'health-staging.codepi.app/api/*'] : r);
  const violations = run(legalFiles({ registryRows: rows }));
  assert.ok(violations.some(v => v.includes('codepi-health-api-staging') && v.includes('no managed staging registry row')),
    `expected type mismatch, got ${JSON.stringify(violations)}`);
});

test('每个环境都缺 D1、额外 D1 或名称与 ID 跨登记行时被拒绝', () => {
  const noD1 = pagesConfig({ name: 'codepi-gzh', clientId: 'gzh', prodD1Name: 'codepi-gzh', prodD1Id: U.gzh, stgD1Name: 'codepi-gzh-staging', stgD1Id: U.gzhStg })
    .replace(/\[\[d1_databases\]\][\s\S]*?database_id = "[^"]+"\n/, '')
    .replace(/\[\[env\.preview\.d1_databases\]\][\s\S]*?database_id = "[^"]+"\n/, '');
  const extraD1 = pagesConfig({ name: 'codepi-gzh', clientId: 'gzh', prodD1Name: 'codepi-gzh', prodD1Id: U.gzh, stgD1Name: 'codepi-gzh-staging', stgD1Id: U.gzhStg })
    .replace('database_id = "' + U.gzh + '"', `database_id = "${U.gzh}"\n[[d1_databases]]\nbinding = "OTHER"\ndatabase_name = "codepi-gzh"\ndatabase_id = "${U.gzh}"`);
  const mismatchedRow = pagesConfig({ name: 'codepi-gzh', clientId: 'gzh', prodD1Name: 'codepi-gzh', prodD1Id: U.gu, stgD1Name: 'codepi-gzh-staging', stgD1Id: U.gzhStg });
  for (const [label, config, needle] of [['missing D1', noD1, 'exactly one D1'], ['extra D1', extraD1, 'exactly one D1'], ['mismatched registry row', mismatchedRow, 'matching both name and database_id']]) {
    const violations = run(legalFiles({ files: { 'apps/gzh/wrangler.toml': config } }));
    assert.ok(violations.some(v => v.includes(needle)), `${label}: ${JSON.stringify(violations)}`);
  }
});

test('Health 缺失或指向其他 staging 产品的 URL 变量被拒绝', () => {
  const missingFrontendOrigins = healthApiConfig().replace('FRONTEND_ORIGINS = "https://health-staging.codepi.app"\n', '');
  const missingRedirect = healthApiConfig().replace('OURA_REDIRECT_URI = "https://health-staging.codepi.app/api/auth/oura/callback"\n', '');
  const misdirected = healthPagesConfig({ stgFrontend: 'https://gu-staging.codepi.app' });
  for (const [file, config, needle] of [
    ['apps/oura/workers/api/wrangler.toml', missingFrontendOrigins, 'FRONTEND_ORIGINS'],
    ['apps/oura/workers/api/wrangler.toml', missingRedirect, 'OURA_REDIRECT_URI'],
    ['apps/oura/apps/web/wrangler.toml', misdirected, 'FRONTEND_ORIGIN'],
  ]) {
    const violations = run(legalFiles({ files: { [file]: config } }));
    assert.ok(violations.some(v => v.includes(needle)), `expected ${needle}: ${JSON.stringify(violations)}`);
  }
});

test('错误 Auth route、非数组 route、重复 cron 与 JSONC 重复 D1/service 均被拒绝', () => {
  const wrongRoute = JSON.parse(authConfig());
  wrongRoute.env.staging.routes = [{ pattern: 'gu-staging.codepi.app', custom_domain: true }];
  const malformedRoutes = JSON.parse(authConfig());
  malformedRoutes.routes = { pattern: 'auth.codepi.app', custom_domain: true };
  const duplicateBindings = JSON.parse(authConfig());
  duplicateBindings.d1_databases.push({ ...duplicateBindings.d1_databases[0] });
  duplicateBindings.services = [
    { binding: 'AUTH', service: 'codepi-auth' },
    { binding: 'AUTH', service: 'codepi-auth' },
  ];
  const duplicateCron = healthApiConfig().replace('[env.staging.triggers]\ncrons = ["*/2 * * * *"]', '[env.staging.triggers]\ncrons = ["*/2 * * * *"]\ncrons = ["*/3 * * * *"]');
  for (const [file, config, needle] of [
    ['services/auth/wrangler.jsonc', JSON.stringify(wrongRoute), 'auth route'],
    ['services/auth/wrangler.jsonc', JSON.stringify(malformedRoutes), 'routes declaration'],
    ['services/auth/wrangler.jsonc', JSON.stringify(duplicateBindings), 'duplicate D1 binding'],
    ['apps/oura/workers/api/wrangler.toml', duplicateCron, 'crons declaration is malformed'],
  ]) {
    const violations = run(legalFiles({ files: { [file]: config } }));
    assert.ok(violations.some(v => v.includes(needle)), `expected ${needle}: ${JSON.stringify(violations)}`);
  }
});

test('Auth staging malformed或生产 callback 拒绝且不回显 callback 值', () => {
  const malformed = JSON.parse(authConfig());
  malformed.env.staging.vars.SSO_EXTRA_REDIRECT_URIS = '{';
  const productionCallback = JSON.parse(authConfig());
  productionCallback.env.staging.vars.SSO_EXTRA_REDIRECT_URIS = productionCallback.vars.SSO_EXTRA_REDIRECT_URIS;
  for (const config of [malformed, productionCallback]) {
    const violations = run(legalFiles({ files: { 'services/auth/wrangler.jsonc': JSON.stringify(config) } }));
    assert.ok(violations.some(v => v.includes('auth staging SSO')), JSON.stringify(violations));
    assert.ok(violations.every(v => !v.includes('https://')), `callback leaked: ${JSON.stringify(violations)}`);
  }
});

// ---- CLI 负例：退出 1、stderr 点名违规资源、不泄露 secret ----

test('CLI：非法 fixture 退出 1 且 stderr 点名违规资源', () => {
  const files = legalFiles({ files: { 'apps/oura/apps/web/wrangler.toml': healthPagesConfig({ includeWorker: false }) } });
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
