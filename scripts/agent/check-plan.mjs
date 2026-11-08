// locks：测试脚本会顺带构建（并先清空）其他包的产物时，声明共享产物名；同名锁的检查不并行运行，
// 否则一个检查读取 dist 时另一个正在重建它（2026-11-04 实测 CLI dist/config.js 缺失）。
export const packageCommands = {
  web: { name: 'web', cwd: 'apps/web', commands: [
    { name: 'test', tier: 'quick', locks: ['auth-dist'] }, { name: 'typecheck:desk', tier: 'quick' },
    { name: 'build', tier: 'full', exclusive: true }, { name: 'test:assets', after: 'build', tier: 'full' },
    { name: 'test:browser:desk:built', after: 'build', tier: 'full' },
  ] },
  gu: { name: 'kdp-gu', cwd: 'apps/gu', commands: [
    { name: 'test', tier: 'quick' }, { name: 'test:scripts', tier: 'quick' }, { name: 'typecheck', tier: 'quick' },
    { name: 'build', tier: 'full', exclusive: true }, { name: 'check:deploy', after: 'build', args: ['--mode', 'config'], tier: 'full' },
  ] },
  health: { name: 'health-kdp', cwd: 'apps/health', commands: [
    { name: 'test', tier: 'quick', locks: ['health-api-dist'] }, { name: 'typecheck', tier: 'quick' },
    { name: 'build', tier: 'full', exclusive: true }, { name: 'test:assets', after: 'build', tier: 'full', locks: ['health-api-dist'] },
    { name: 'test:browser:built', after: 'build', tier: 'full', locks: ['health-api-dist'] },
  ] },
  project: { name: 'kdp-project', cwd: 'apps/project', commands: [
    { name: 'test', tier: 'quick' }, { name: 'typecheck', tier: 'quick' }, { name: 'build', tier: 'full', exclusive: true },
    { name: 'test:browser:built', after: 'build', tier: 'full' },
  ] },
  me: { name: 'kdp-me', cwd: 'apps/me', commands: [
    { name: 'test', tier: 'quick' }, { name: 'typecheck', tier: 'quick' }, { name: 'build', tier: 'full', exclusive: true },
    { name: 'test:browser:built', after: 'build', tier: 'full' },
  ] },
  rhythm: { name: 'kdp-rhythm', cwd: 'apps/rhythm', commands: [
    { name: 'test', tier: 'quick' }, { name: 'typecheck', tier: 'quick' }, { name: 'build', tier: 'full', exclusive: true },
    { name: 'test:browser:built', after: 'build', tier: 'full' },
  ] },
  auth: { name: 'kdp-auth', cwd: 'services/auth', commands: [
    { name: 'test', tier: 'quick', locks: ['auth-dist'] }, { name: 'typecheck', tier: 'quick' }, { name: 'build', tier: 'full', exclusive: true },
  ] },
  mcp: { name: '@codepi/mcp', cwd: 'services/mcp', commands: [
    // test 会先构建 Health API、CLI 和 MCP 自己（见 services/mcp/package.json），与读写这些产物的检查互斥
    { name: 'test', tier: 'quick', locks: ['health-api-dist', 'cli-dist', 'mcp-dist'] }, { name: 'typecheck', tier: 'quick' },
    { name: 'build', tier: 'full', exclusive: true }, { name: 'test:browser:built', after: 'build', tier: 'full', locks: ['mcp-dist'] },
  ] },
  ops: { name: '@codepi/ops', cwd: 'services/ops', commands: [
    { name: 'test', tier: 'quick' }, { name: 'build', tier: 'full', exclusive: true }, { name: 'test:runtime', tier: 'full' },
  ] },
  cli: { name: '@kedoupi/codepi', cwd: 'packages/cli', commands: [
    { name: 'test', tier: 'quick', locks: ['cli-dist'] }, { name: 'typecheck', tier: 'quick' }, { name: 'build', tier: 'full', exclusive: true },
  ] },
};

export const allApps = Object.keys(packageCommands);

export const crossServiceRules = [
  { match: file => file.startsWith('apps/health/workers/api/') || file.startsWith('apps/health/shared/'), apps: ['mcp'] },
  { match: file => file.startsWith('apps/gu/worker/') || file.startsWith('apps/gu/migrations/'), apps: ['mcp', 'ops'] },
  { match: file => file.startsWith('apps/project/worker/') || file.startsWith('apps/project/migrations/'), apps: ['mcp'] },
  { match: file => file.startsWith('apps/me/worker/') || file.startsWith('apps/me/migrations/'), apps: ['mcp', 'ops'] },
];

export const specialRules = [
  { files: ['package.json', 'pnpm-lock.yaml', 'pnpm-workspace.yaml', '.npmrc'], apps: allApps, sharedAuth: true, governance: true, workflow: true },
  { prefixes: ['services/ops/', 'scripts/cloudflare/'], files: ['.github/workflows/deploy-platform.yml', 'docs/development/cloudflare-resource-registry.md', 'docs/development/cloudflare-governance.md'], apps: ['ops'], governance: true },
  { prefixes: ['scripts/agent/', '.agents/', '.claude/skills/', '.cursor/rules/', 'docs/development/'], files: ['CLAUDE.md', 'GEMINI.md', '.gitignore', '.github/copilot-instructions.md'], workflow: true },
  { prefixes: ['calc/', 'convert/', 'text/', 'dev/', 'ai/', 'fagao/'], apps: allApps, sharedAuth: true },
  { prefixes: ['apps/oura/'], apps: ['health'] },
  { prefixes: ['docs/'], suffixes: ['/README.md', '/AGENTS.md'], files: ['README.md', 'AGENTS.md', 'LICENSE', 'NOTICE.md'], documentation: true },
  { prefixes: ['.github/'], apps: allApps, sharedAuth: true, workflow: true },
  { prefixes: ['packages/shared/mcp/'], apps: ['web', 'health', 'gu', 'project', 'me', 'mcp', 'cli'] },
  { prefixes: ['services/auth/', 'packages/shared/auth/'], apps: allApps, sharedAuth: true },
  { prefixes: ['packages/shared/layouts/', 'packages/shared/i18n/'], files: ['packages/shared/products.ts', 'packages/shared/privacy-redirects.js', 'packages/shared/sitemap-filter.js'], apps: ['web'] },
  { prefixes: ['packages/shared/'], apps: allApps, sharedAuth: true },
];

export const wranglerConfigs = ['apps/web/wrangler.toml', 'apps/gu/wrangler.toml',
  'apps/project/wrangler.toml', 'apps/me/wrangler.toml', 'apps/rhythm/wrangler.toml', 'services/auth/wrangler.jsonc',
  'services/mcp/wrangler.toml', 'services/ops/wrangler.toml', 'apps/health/workers/api/wrangler.toml', 'apps/health/apps/web/wrangler.toml'];
export const migrationDirs = ['apps/web/migrations/', 'apps/web/migrations-blog/', 'apps/gu/migrations/',
  'apps/project/migrations/', 'apps/me/migrations/', 'apps/rhythm/migrations/', 'services/auth/migrations/', 'services/mcp/migrations/', 'apps/health/migrations/'];

export function packageCheck(app, command) {
  const { name, args = [] } = command;
  return { cwd: packageCommands[app].cwd, argv: ['pnpm', '--filter', packageCommands[app].name, name, ...args], app, name, after: command.after, exclusive: command.exclusive, locks: command.locks ?? [] };
}

export function ciPlan(files) {
  const apps = new Set();
  const manual = [];
  let workflow = false, sharedAuth = false, governance = false;
  const touchesMigrations = files.some(file => migrationDirs.some(dir => file.startsWith(dir)) || file.startsWith('scripts/agent/check-migrations'));
  for (const file of files) {
    const special = specialRules.find(rule => rule.files?.includes(file) || rule.prefixes?.some(prefix => file.startsWith(prefix)) || rule.suffixes?.some(suffix => file.endsWith(suffix)));
    if (special) {
      if (special.documentation) continue;
      special.apps?.forEach(app => apps.add(app));
      workflow ||= special.workflow ?? false;
      sharedAuth ||= special.sharedAuth ?? false;
      governance ||= special.governance ?? false;
      continue;
    }
    const app = allApps.find(name => file.startsWith(`${packageCommands[name].cwd}/`));
    if (!app) { manual.push(file); continue; }
    apps.add(app);
    for (const rule of crossServiceRules) if (rule.match(file)) rule.apps.forEach(name => apps.add(name));
  }
  if (files.some(file => wranglerConfigs.includes(file))) governance = true;
  return {
    manual,
    jobs: allApps.map(app => ({
      app,
      cwd: packageCommands[app].cwd,
      commands: packageCommands[app].commands,
    })).filter(job => apps.has(job.app)),
    sharedAuth,
    governance,
    workflow,
    migrations: touchesMigrations,
  };
}
