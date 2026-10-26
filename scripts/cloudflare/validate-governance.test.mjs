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
  ['worker-ops', 'production', 'worker', 'codepi-ops', '-', 'managed'],
  ['workflow-ops', 'production', 'workflow', 'codepi-ops', '-', 'managed'],
  ['r2-ops', 'production', 'r2', 'codepi-ops-backups', '-', 'managed'],
  ['r2-gu-uploads', 'production', 'r2', 'codepi-gu-uploads', '-', 'managed'],
  ['worker-mcp', 'production', 'worker', 'codepi-mcp', 'mcp.codepi.app', 'managed'],
  ['d1-mcp', 'production', 'd1', 'codepi-mcp', '-', 'managed'],
  ['worker-project', 'production', 'worker', 'codepi-project', 'project.codepi.app', 'planned'],
  ['d1-project', 'production', 'd1', 'codepi-project', '-', 'planned'],
  ['worker-me', 'production', 'worker', 'codepi-me', 'me.codepi.app', 'planned'],
  ['d1-me', 'production', 'd1', 'codepi-me', '-', 'planned'],
  ['r2-me-imports', 'production', 'r2', 'codepi-me-imports', '-', 'planned'],
  ['r2-blog-uploads', 'production', 'r2', 'codepi-blog-uploads', '-', 'planned'],
  ['worker-www', 'production', 'worker', 'codepi-www', 'codepi.app, www.codepi.app'],
  ['worker-gu', 'production', 'worker', 'codepi-gu', 'gu.codepi.app, codepi-gu.workers.dev'],
  ['worker-gzh', 'production', 'worker', 'codepi-gzh', 'gzh.codepi.app'],
  ['worker-health', 'production', 'worker', 'codepi-health', 'health.codepi.app'],
  ['worker-auth', 'production', 'worker', 'codepi-auth', 'auth.codepi.app (custom domain)'],
  ['worker-health-api', 'production', 'worker', 'codepi-health-api', 'health.codepi.app/api/*'],
  ['d1-www', 'production', 'd1', `codepi-desk (${U.www})`, '-', 'managed'],
  ['d1-blog', 'production', 'd1', 'codepi-blog', '-', 'planned'],
  ['d1-gu', 'production', 'd1', `codepi-gu (${U.gu})`, '-', 'managed'],
  ['d1-gzh', 'production', 'd1', `codepi-gzh (${U.gzh})`, '-', 'managed'],
  ['d1-auth', 'production', 'd1', `codepi-auth (${U.auth})`, '-', 'managed'],
  ['d1-health', 'production', 'd1', `codepi-health (${U.health})`, '-', 'managed'],
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
[observability.issues]
enabled = true
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
      issues: { enabled: true },
      logs: { enabled: true, invocation_logs: true, persist: true },
    },
    routes: [{ pattern: 'auth.codepi.app', custom_domain: true }],
    vars: {
      ENVIRONMENT: 'production',
      AUTH_ORIGIN: 'https://auth.codepi.app',
      SSO_EXTRA_REDIRECT_URIS: JSON.stringify({
        gu: ['https://gu.kdp.cool/api/auth/callback', 'https://gu.codepi.app/api/auth/callback'],
        oura: ['https://health.kdp.cool/api/auth/callback', 'https://health.codepi.app/api/auth/callback'],
        gzh: ['https://gzh.codepi.app/api/auth/callback'],
        desk: ['https://kdp.cool/api/auth/callback', 'https://codepi.app/api/auth/callback'],
        project: ['https://project.codepi.app/api/auth/callback'],
        me: ['https://me.codepi.app/api/auth/callback'],
      }),
    },
    d1_databases: [{ binding: 'DB', database_name: 'codepi-auth', database_id: U.auth, migrations_dir: 'migrations' }],
    triggers: { crons: ['17 3 * * *'] },
  });
}

function legalFiles(overrides = {}) {
  return {
    'services/ops/wrangler.toml': opsConfig(),
    'docs/development/cloudflare-resource-registry.md': registryText(overrides.registryRows),
    'apps/web/wrangler.toml': webWorkerConfig(),
    'apps/gu/wrangler.toml': privateWorkerConfig(),
    'apps/gzh/wrangler.toml': privateWorkerConfig({ app: 'gzh' }),
    'services/auth/wrangler.jsonc': authConfig(),
    'services/mcp/wrangler.toml': mcpConfig(),
    'apps/project/wrangler.toml': domainConfig('project'),
    'apps/me/wrangler.toml': domainConfig('me'),
    'apps/health/workers/api/wrangler.toml': healthApiConfig(),
    'apps/health/apps/web/wrangler.toml': healthPagesConfig(),
    ...overrides.files,
  };
}

function opsConfig() {
  return `
name = "codepi-ops"
workers_dev = false
preview_urls = false
routes = []
[[services]]
binding = "GU"
service = "codepi-gu"
entrypoint = "GuMaterialsBackup"
[[services]]
binding = "ME"
service = "codepi-me"
entrypoint = "MeImportsBackup"
[[services]]
binding = "BLOG"
service = "codepi-www"
entrypoint = "BlogMediaBackup"
[vars]
ENVIRONMENT = "production"
[triggers]
crons = ["*/30 * * * *", "0 18 * * *"]
[[r2_buckets]]
binding = "BACKUPS"
bucket_name = "codepi-ops-backups"
[[workflows]]
binding = "OPERATIONS"
name = "codepi-ops"
class_name = "OperationsWorkflow"
${OBSERVABILITY}
`;
}

test('ops remains private with only its owned R2, Workflow and exact GU/ME/BLOG backup entrypoints', () => {
  assert.deepEqual(run(legalFiles()), []);
  for (const config of [
    opsConfig().replace('workers_dev = false', 'workers_dev = true'),
    opsConfig().replace('preview_urls = false', 'preview_urls = true'),
    opsConfig().replace('routes = []', 'routes = [\n  { pattern = "codepi.app", custom_domain = true }\n]'),
    opsConfig().replace('crons = ["*/30 * * * *", "0 18 * * *"]', 'crons = ["* * * * *"]'),
    opsConfig().replace('bucket_name = "codepi-ops-backups"', 'bucket_name = "unrelated"'),
    opsConfig().replace('class_name = "OperationsWorkflow"', 'class_name = "OtherWorkflow"'),
    opsConfig().replace('entrypoint = "GuMaterialsBackup"', 'entrypoint = "OtherEntrypoint"'),
    opsConfig().replace('entrypoint = "GuMaterialsBackup"', ''),
    opsConfig().replace('service = "codepi-gu"', 'service = "codepi-health-api"'),
    opsConfig().replace('entrypoint = "MeImportsBackup"', 'entrypoint = "OtherEntrypoint"'),
    opsConfig().replace('entrypoint = "MeImportsBackup"', ''),
    opsConfig().replace('service = "codepi-me"', 'service = "codepi-ops"'),
    opsConfig().replace(/\n\[\[services\]\]\nbinding = "ME"[\s\S]*?entrypoint = "MeImportsBackup"\n?/, '\n'),
    opsConfig().replace('entrypoint = "BlogMediaBackup"', 'entrypoint = "OtherEntrypoint"'),
    opsConfig().replace('entrypoint = "BlogMediaBackup"', ''),
    opsConfig().replace('service = "codepi-www"', 'service = "codepi-ops"'),
    opsConfig().replace(/\n\[\[services\]\]\nbinding = "BLOG"[\s\S]*?entrypoint = "BlogMediaBackup"\n?/, '\n'),
    opsConfig() + '\n[[d1_databases]]\nbinding = "DB"\ndatabase_name = "codepi-health"\n',
    opsConfig() + '\n[[services]]\nbinding = "AUTH"\nservice = "codepi-auth"\n',
  ]) {
    assert.ok(run(legalFiles({ files: { 'services/ops/wrangler.toml': config } })).some(v => v.startsWith('ops:')));
  }
});

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
${app === 'gu' ? '[[r2_buckets]]\nbinding = "MATERIALS"\nbucket_name = "codepi-gu-uploads"\n' : ''}
${OBSERVABILITY}
`;
}

function domainConfig(app) {
  return `
name = "codepi-${app}"
main = "worker/index.ts"
routes = [
  { pattern = "${app}.codepi.app", custom_domain = true }
]
[assets]
directory = "./dist"
binding = "ASSETS"
run_worker_first = true
[[services]]
binding = "AUTH"
service = "codepi-auth"
[[d1_databases]]
binding = "DB"
database_name = "codepi-${app}"
${app === 'me' ? '[[r2_buckets]]\nbinding = "IMPORTS"\nbucket_name = "codepi-me-imports"\n' : ''}[vars]
ENVIRONMENT = "production"
AUTH_ORIGIN = "https://auth.codepi.app"
AUTH_CLIENT_ID = "${app}"
${OBSERVABILITY}
`;
}

function webWorkerConfig({ media = true } = {}) {
  return privateWorkerConfig({ app: 'www' })
    .replace('run_worker_first = true', 'run_worker_first = ["/api/*", "/desk", "/desk/*"]\nnot_found_handling = "404-page"')
    .replaceAll('database_name = "codepi-www', 'database_name = "codepi-desk')
    + '\n[[d1_databases]]\nbinding = "BLOG"\ndatabase_name = "codepi-blog"\n'
    + (media ? '[[r2_buckets]]\nbinding = "BLOG_MEDIA"\nbucket_name = "codepi-blog-uploads"\n' : '');
}
test('all non-allowlisted R2 and Workflow bindings are rejected across TOML and JSONC', () => {
  const files = legalFiles({
    files: {
      'services/auth/wrangler.jsonc': JSON.stringify({
        ...JSON.parse(authConfig()),
        r2_buckets: [{ binding: 'EXTRA_R2', bucket_name: 'unregistered-auth-bucket' }],
        workflows: [{ binding: 'EXTRA_WORKFLOW', name: 'unregistered-auth-workflow', class_name: 'UnexpectedWorkflow' }],
      }),
      'apps/gzh/wrangler.toml': `${privateWorkerConfig({ app: 'gzh' })}
[[r2_buckets]]
binding = "EXTRA_R2"
bucket_name = "unregistered-gzh-bucket"
[[workflows]]
binding = "EXTRA_WORKFLOW"
name = "unregistered-gzh-workflow"
class_name = "UnexpectedWorkflow"
`,
    },
  });
  const violations = run(files);
  assert.ok(violations.some(v => v.startsWith('auth:') && v.includes('R2')));
  assert.ok(violations.some(v => v.startsWith('auth:') && v.includes('Workflow')));
  assert.ok(violations.some(v => v.startsWith('gzh:') && v.includes('R2')));
  assert.ok(violations.some(v => v.startsWith('gzh:') && v.includes('Workflow')));
});


test('GU materials has an exact managed bucket', () => {
  for (const config of [
    privateWorkerConfig().replace('binding = "MATERIALS"', 'binding = "BACKUPS"'),
    privateWorkerConfig().replace('bucket_name = "codepi-gu-uploads"', 'bucket_name = "codepi-ops-backups"'),
    privateWorkerConfig() + '\n[[r2_buckets]]\nbinding = "EXTRA"\nbucket_name = "codepi-gu-uploads"\n',
  ]) {
    assert.ok(run(legalFiles({ files: { 'apps/gu/wrangler.toml': config } })).some(v => v.includes('gu must bind only MATERIALS')));
  }
  const rows = REGISTRY_ROWS.filter(r => r[0] !== 'r2-gu-uploads');
  assert.ok(run(legalFiles({ registryRows: rows })).some(v => v.includes('codepi-gu-uploads has no registry record')));
  const unknown = REGISTRY_ROWS.map(r => r[0] === 'r2-gu-uploads' ? [...r.slice(0, 5), 'unknown'] : r);
  assert.ok(run(legalFiles({ registryRows: unknown })).some(v => v.includes('codepi-gu-uploads is registered as unknown')));
  const plannedWorker = REGISTRY_ROWS.map(r => r[0] === 'worker-gu' ? [...r.slice(0, 5), 'planned'] : r);
  assert.ok(run(legalFiles({ registryRows: plannedWorker })).some(v => v.startsWith('gu:') && v.includes('no managed production')));
});

test('Project and Me only reserve their exact planned Worker, D1, host and Me import bucket', () => {
  assert.deepEqual(run(legalFiles()), []);
  for (const [file, config, needle] of [
    ['apps/project/wrangler.toml', domainConfig('project').replace('database_name = "codepi-project"', 'database_name = "codepi-me"'), 'database_name'],
    ['apps/project/wrangler.toml', domainConfig('project').replace('pattern = "project.codepi.app"', 'pattern = "me.codepi.app"'), 'custom domains'],
    ['apps/project/wrangler.toml', domainConfig('project').replace('AUTH_CLIENT_ID = "project"', 'AUTH_CLIENT_ID = "gu"'), 'AUTH_CLIENT_ID'],
    ['apps/project/wrangler.toml', domainConfig('project').replace('service = "codepi-auth"', 'service = "codepi-mcp"'), 'codepi-auth'],
    ['apps/me/wrangler.toml', domainConfig('me').replace('bucket_name = "codepi-me-imports"', 'bucket_name = "codepi-gu-uploads"'), 'bind only IMPORTS'],
    ['apps/me/wrangler.toml', domainConfig('me') + '\n[[r2_buckets]]\nbinding = "EXTRA"\nbucket_name = "codepi-me-imports"\n', 'bind only IMPORTS'],
  ]) {
    assert.ok(run(legalFiles({ files: { [file]: config } })).some(v => v.includes(needle)),
      `${file}: expected ${needle}`);
  }
  for (const [id, mutate] of [
    ['worker-project', rows => rows.map(row => row[0] === 'worker-project' ? [...row.slice(0, 5), 'legacy-pending-retirement'] : row)],
    ['d1-me', rows => rows.filter(row => row[0] !== 'd1-me')],
    ['r2-me-imports', rows => rows.filter(row => row[0] !== 'r2-me-imports')],
  ]) {
    assert.ok(run(legalFiles({ registryRows: mutate(REGISTRY_ROWS) })).length > 0, `${id} must remain exact`);
  }
  const fake = domainConfig('project').replace('database_name = "codepi-project"',
    'database_name = "codepi-project"\ndatabase_id = "99999999-9999-4999-8999-999999999999"');
  assert.ok(run(legalFiles({ files: { 'apps/project/wrangler.toml': fake } })).some(v => v.includes('database_id')));
});

test('planned service allowances cover only the new Project and Me bindings', () => {
  for (const [planned, owner, binding] of [
    ['worker-auth', 'mcp', 'AUTH'],
    ['worker-health-api', 'mcp', 'HEALTH'],
    ['worker-gu', 'ops', 'GU'],
  ]) {
    const rows = REGISTRY_ROWS.map(row => row[0] === planned ? [...row.slice(0, 5), 'planned'] : row);
    const violations = run(legalFiles({ registryRows: rows }));
    assert.ok(violations.some(v => v.startsWith(`${owner}:`) && v.includes(`service binding ${binding}`)),
      `${owner} ${binding} must remain a managed dependency`);
  }
  const plannedProject = run(legalFiles());
  assert.deepEqual(plannedProject, []);
});

test('planned allowances never cover existing Ops, GU or MCP resources', () => {
  for (const [id, owner] of [
    ['worker-ops', 'ops'],
    ['workflow-ops', 'ops'],
    ['r2-ops', 'ops'],
    ['worker-mcp', 'mcp'],
    ['d1-mcp', 'mcp'],
    ['r2-gu-uploads', 'gu'],
  ]) {
    const rows = REGISTRY_ROWS.map(row => row[0] === id ? [...row.slice(0, 5), 'planned'] : row);
    const violations = run(legalFiles({ registryRows: rows }));
    assert.ok(violations.some(v => v.startsWith(`${owner}:`) && v.includes('no managed production')),
      `${id} must remain a managed resource`);
  }
});

test('Auth SSO callbacks include only the exact new Project and Me origins', () => {
  const missing = JSON.parse(authConfig());
  const extra = JSON.parse(missing.vars.SSO_EXTRA_REDIRECT_URIS);
  delete extra.project;
  missing.vars.SSO_EXTRA_REDIRECT_URIS = JSON.stringify(extra);
  assert.ok(run(legalFiles({ files: { 'services/auth/wrangler.jsonc': JSON.stringify(missing) } }))
    .some(v => v.startsWith('auth:') && v.includes('SSO callback clients')));

  const wrong = JSON.parse(authConfig());
  const callbacks = JSON.parse(wrong.vars.SSO_EXTRA_REDIRECT_URIS);
  callbacks.me = ['https://me.codepi.app/api/auth/callback?redirect=https://evil.example'];
  wrong.vars.SSO_EXTRA_REDIRECT_URIS = JSON.stringify(callbacks);
  assert.ok(run(legalFiles({ files: { 'services/auth/wrangler.jsonc': JSON.stringify(wrong) } }))
    .some(v => v.startsWith('auth:') && v.includes('callback for client me')));
});

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

test('every production Worker must retain Issues alerts on deployment', () => {
  for (const [file, original] of Object.entries(legalFiles()).filter(([file]) => file.includes('wrangler.'))) {
    for (const mode of ['missing', 'disabled']) {
      let config;
      if (file.endsWith('.toml')) {
        config = original.replace('[observability.issues]\nenabled = true\n',
          mode === 'missing' ? '' : '[observability.issues]\nenabled = false\n');
      } else {
        const parsed = JSON.parse(original);
        if (mode === 'missing') delete parsed.observability.issues;
        else parsed.observability.issues.enabled = false;
        config = JSON.stringify(parsed);
      }
      assert.notEqual(config, original, `fixture must remove or disable Issues: ${file}`);
      assert.ok(run(legalFiles({ files: { [file]: config } })).some(v => v.includes('Issues')),
        `expected Issues violation for ${file} (${mode})`);
    }
  }
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

function mcpConfig() {
  return `name = "codepi-mcp"
routes = [
  { pattern = "mcp.codepi.app", custom_domain = true }
]
[vars]
ENVIRONMENT = "production"
AUTH_ORIGIN = "https://auth.codepi.app"
MCP_ORIGIN = "https://mcp.codepi.app"
AUTH_CLIENT_ID = "mcp"
[[d1_databases]]
binding = "DB"
database_name = "codepi-mcp"
[[services]]
binding = "AUTH"
service = "codepi-auth"
[[services]]
binding = "HEALTH"
service = "codepi-health-api"
entrypoint = "HealthMcp"
[[services]]
binding = "PROJECT"
service = "codepi-project"
entrypoint = "ProjectMcp"
[[services]]
binding = "ME"
service = "codepi-me"
entrypoint = "MeMcp"
[[services]]
binding = "GU"
service = "codepi-gu"
entrypoint = "GuMcp"
[[services]]
binding = "BLOG"
service = "codepi-www"
entrypoint = "BlogMcp"
${OBSERVABILITY}
`;
}
test('www BLOG D1 is name-pinned and MCP BLOG RPC is exact', () => {
  assert.deepEqual(run(legalFiles()), []);
  for (const config of [
    webWorkerConfig().replace('database_name = "codepi-blog"', 'database_name = "codepi-desk"'),
    webWorkerConfig() + '\n[[d1_databases]]\nbinding = "EXTRA"\ndatabase_name = "codepi-blog"\n',
  ]) {
    assert.ok(run(legalFiles({ files: { 'apps/web/wrangler.toml': config } }))
      .some(v => v.startsWith('www:') && v.includes('D1')));
  }
  const wrongEntrypoint = mcpConfig().replace('entrypoint = "BlogMcp"', 'entrypoint = "OtherEntrypoint"');
  assert.ok(run(legalFiles({ files: { 'services/mcp/wrangler.toml': wrongEntrypoint } }))
    .some(v => v.startsWith('mcp:') && v.includes('BLOG')));
});

test('www blog media has exactly one planned private bucket and rejects every other R2', () => {
  assert.deepEqual(run(legalFiles()), []);
  for (const [config, needle] of [
    [webWorkerConfig({ media: false }), 'bind only BLOG_MEDIA'],
    [webWorkerConfig().replace('binding = "BLOG_MEDIA"', 'binding = "MATERIALS"'), 'bind only BLOG_MEDIA'],
    [webWorkerConfig().replace('bucket_name = "codepi-blog-uploads"', 'bucket_name = "codepi-gu-uploads"'), 'bind only BLOG_MEDIA'],
    [webWorkerConfig() + '[[r2_buckets]]\nbinding = "EXTRA"\nbucket_name = "codepi-blog-uploads"\n', 'bind only BLOG_MEDIA'],
  ]) {
    assert.ok(run(legalFiles({ files: { 'apps/web/wrangler.toml': config } })).some(v => v.includes(needle)), needle);
  }
  const missing = REGISTRY_ROWS.filter(row => row[0] !== 'r2-blog-uploads');
  assert.ok(run(legalFiles({ registryRows: missing })).some(v => v.includes('codepi-blog-uploads has no registry record')));
  const unknown = REGISTRY_ROWS.map(row => row[0] === 'r2-blog-uploads' ? [...row.slice(0, 5), 'unknown'] : row);
  assert.ok(run(legalFiles({ registryRows: unknown })).some(v => v.includes('codepi-blog-uploads is registered as unknown')));
});

test('MCP reserves its own D1 and requires the named Health RPC capability', () => {
  assert.deepEqual(run(legalFiles()), []);
  for (const config of [
    mcpConfig().replace('entrypoint = "HealthMcp"', ''),
    mcpConfig().replace('database_name = "codepi-mcp"', 'database_name = "codepi-health"'),
    mcpConfig().replace('MCP_ORIGIN = "https://mcp.codepi.app"', 'MCP_ORIGIN = "https://health.codepi.app"'),
    mcpConfig().replace('entrypoint = "ProjectMcp"', 'entrypoint = "OtherEntrypoint"'),
    mcpConfig().replace('service = "codepi-me"', 'service = "codepi-ops"'),
    mcpConfig().replace(/\n\[\[services\]\]\nbinding = "PROJECT"[\s\S]*?entrypoint = "ProjectMcp"\n?/, '\n'),
    mcpConfig().replace(/\n\[\[services\]\]\nbinding = "ME"[\s\S]*?entrypoint = "MeMcp"\n?/, '\n'),
    mcpConfig().replace(/\n\[\[services\]\]\nbinding = "GU"[\s\S]*?entrypoint = "GuMcp"\n?/, '\n'),
  ]) {
    assert.ok(run(legalFiles({ files: { 'services/mcp/wrangler.toml': config } })).some(v => v.startsWith('mcp:')));
  }
});
