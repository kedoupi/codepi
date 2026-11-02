export const packageCommands = {
  web: { name: 'web', cwd: 'apps/web', commands: [
    { name: 'test', tier: 'quick' }, { name: 'typecheck:desk', tier: 'quick' },
    { name: 'build', tier: 'full' }, { name: 'test:assets', tier: 'full' },
  ] },
  gu: { name: 'kdp-gu', cwd: 'apps/gu', commands: [
    { name: 'test', tier: 'quick' }, { name: 'test:scripts', tier: 'quick' }, { name: 'typecheck', tier: 'quick' },
    { name: 'build', tier: 'full' }, { name: 'check:deploy', args: ['--mode', 'config'], tier: 'full' },
  ] },
  gzh: { name: 'publish-desk', cwd: 'apps/gzh', commands: [
    { name: 'test', tier: 'quick' }, { name: 'typecheck', tier: 'quick' }, { name: 'build', tier: 'full' },
  ] },
  health: { name: 'health-kdp', cwd: 'apps/health', commands: [
    { name: 'test', tier: 'quick' }, { name: 'typecheck', tier: 'quick' },
    { name: 'build', tier: 'full' }, { name: 'test:assets', tier: 'full' }, { name: 'test:browser:built', tier: 'full' },
  ] },
  project: { name: 'kdp-project', cwd: 'apps/project', commands: [
    { name: 'test', tier: 'quick' }, { name: 'typecheck', tier: 'quick' }, { name: 'build', tier: 'full' },
  ] },
  me: { name: 'kdp-me', cwd: 'apps/me', commands: [
    { name: 'test', tier: 'quick' }, { name: 'typecheck', tier: 'quick' }, { name: 'build', tier: 'full' },
  ] },
  auth: { name: 'kdp-auth', cwd: 'services/auth', commands: [
    { name: 'test', tier: 'quick' }, { name: 'typecheck', tier: 'quick' }, { name: 'build', tier: 'full' },
  ] },
  mcp: { name: '@codepi/mcp', cwd: 'services/mcp', commands: [
    { name: 'test', tier: 'quick' }, { name: 'typecheck', tier: 'quick' },
    { name: 'build', tier: 'full' }, { name: 'test:browser:built', tier: 'full' },
  ] },
  ops: { name: '@codepi/ops', cwd: 'services/ops', commands: [
    { name: 'test', tier: 'quick' }, { name: 'build', tier: 'full' }, { name: 'test:runtime', tier: 'full' },
  ] },
  cli: { name: '@kedoupi/codepi', cwd: 'packages/cli', commands: [
    { name: 'test', tier: 'quick' }, { name: 'typecheck', tier: 'quick' }, { name: 'build', tier: 'full' },
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

export const wranglerConfigs = ['apps/web/wrangler.toml', 'apps/gu/wrangler.toml', 'apps/gzh/wrangler.toml',
  'apps/project/wrangler.toml', 'apps/me/wrangler.toml', 'services/auth/wrangler.jsonc',
  'services/mcp/wrangler.toml', 'services/ops/wrangler.toml', 'apps/health/workers/api/wrangler.toml', 'apps/health/apps/web/wrangler.toml'];
export const migrationDirs = ['apps/web/migrations/', 'apps/web/migrations-blog/', 'apps/gu/migrations/', 'apps/gzh/migrations/',
  'apps/project/migrations/', 'apps/me/migrations/', 'services/auth/migrations/', 'services/mcp/migrations/', 'apps/health/migrations/'];

export function packageCheck(app, { name, args = [] }) {
  return { cwd: packageCommands[app].cwd, argv: ['pnpm', '--filter', packageCommands[app].name, name, ...args], app };
}
