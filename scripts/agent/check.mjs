import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';

export const appDirs = { web: 'apps/web', gu: 'apps/gu', gzh: 'apps/gzh', oura: 'apps/oura', auth: 'services/auth' };
export const staticApps = ['web'];
export const privateApps = ['auth', 'gu', 'gzh', 'oura'];
const allApps = [...staticApps, ...privateApps];
const dirOf = app => appDirs[app];
const root = fileURLToPath(new URL('../../', import.meta.url));

function git(cwd, args) {
  return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}

export function changedFiles(cwd, base = 'HEAD') {
  // Resolve before diffing so a mistyped ref cannot silently mean a path.
  const commit = git(cwd, ['rev-parse', '--verify', '--end-of-options', `${base}^{commit}`]).trim();
  const mergeBase = git(cwd, ['merge-base', commit, 'HEAD']).trim();
  const diff = ['diff', '--name-only', '-z', '--no-renames'];
  const outputs = [
    git(cwd, [...diff, mergeBase, 'HEAD', '--']),
    git(cwd, [...diff, '--cached', '--']),
    git(cwd, [...diff, '--']),
    git(cwd, ['ls-files', '--others', '--exclude-standard', '-z']),
  ];
  return { mergeBase, files: [...new Set(outputs.flatMap(out => out.split('\0').filter(Boolean)))].sort() };
}

export function makePlan(files) {
  const apps = new Set();
  const manual = [];
  let workflow = false;
  let sharedAuth = false;
  let cfGovernance = false;
  const add = names => names.forEach(name => apps.add(name));
  const addAll = () => { add(allApps); sharedAuth = true; };

  const wranglerConfigs = ['apps/web/wrangler.toml', 'apps/gu/wrangler.toml', 'apps/gzh/wrangler.toml',
    'services/auth/wrangler.jsonc', 'apps/oura/workers/api/wrangler.toml', 'apps/oura/apps/web/wrangler.toml'];
  for (const file of files) {
    if (file.startsWith('scripts/cloudflare/')
      || file === '.github/workflows/deploy-platform.yml'
      || ['package.json', 'pnpm-lock.yaml', 'pnpm-workspace.yaml', '.npmrc'].includes(file)
      || file === 'docs/development/cloudflare-resource-registry.md'
      || file === 'docs/development/cloudflare-governance.md'
      || wranglerConfigs.includes(file)) cfGovernance = true;
  }

  for (const file of files) {
    if (['package.json', 'pnpm-lock.yaml', 'pnpm-workspace.yaml', '.npmrc'].includes(file)) {
      addAll();
      workflow = true;
    } else if (file.startsWith('scripts/agent/') || file.startsWith('scripts/cloudflare/') || file.startsWith('.agents/')
      || file.startsWith('.claude/skills/') || file.startsWith('.cursor/rules/')
      || ['CLAUDE.md', 'GEMINI.md', '.github/copilot-instructions.md'].includes(file)
      || file.startsWith('docs/development/')) {
      workflow = true;
    } else if (['calc/', 'convert/', 'text/', 'dev/', 'ai/', 'fagao/'].some(prefix => file.startsWith(prefix))) {
      // Retirement and directory moves must validate the remaining consumers.
      addAll();
    } else if (file.startsWith('docs/') || /(^|\/)(README|AGENTS)\.md$/.test(file)) {
      continue;
    } else if (file.startsWith('.github/')) {
      addAll();
      workflow = true;
    } else if (file.startsWith('services/auth/') || file.startsWith('packages/shared/auth/')) {
      add(['web', ...privateApps]);
      sharedAuth = true;
    } else if (file.startsWith('packages/shared/')) {
      const staticOnly = ['layouts/', 'i18n/']
        .some(prefix => file.startsWith(`packages/shared/${prefix}`))
        || ['packages/shared/products.ts', 'packages/shared/privacy-redirects.js', 'packages/shared/sitemap-filter.js'].includes(file);
      if (staticOnly) add(staticApps);
      else addAll();
    } else {
      const app = allApps.find(name => file.startsWith(`${dirOf(name)}/`));
      if (app) apps.add(app);
      else manual.push(file);
    }
  }

  const checks = [];
  const check = (cwd, ...argv) => checks.push({ cwd, argv });
  if (cfGovernance) {
    // 只读仓库文件的静态守门；绝不访问 Cloudflare 或远程数据库。
    check('.', 'node', '--test', 'scripts/cloudflare/validate-governance.test.mjs', 'scripts/cloudflare/deployment-evidence.test.mjs', 'scripts/cloudflare/deploy-workflow.test.mjs', 'scripts/cloudflare/check-pages.test.mjs');
    check('.', 'node', 'scripts/cloudflare/validate-governance.mjs');
  }
  if (workflow) check('.', 'node', '--test', 'scripts/agent/check.test.mjs');
  for (const app of staticApps.filter(app => apps.has(app))) {
    if (app === 'web') {
      check(dirOf(app), 'npm', 'test');
      check(dirOf(app), 'npm', 'run', 'typecheck:desk');
      check(dirOf(app), 'npm', 'run', 'build:functions');
    }
    check(dirOf(app), 'npm', 'run', 'build');
  }
  for (const app of privateApps.filter(app => apps.has(app))) {
    if (app === 'oura') {
      check(dirOf(app), 'pnpm', 'test');
      check(dirOf(app), 'pnpm', 'typecheck');
      check(dirOf(app), 'pnpm', 'build');
      check(dirOf(app), 'pnpm', 'test:browser:built');
    } else {
      check(dirOf(app), 'npm', 'test');
      if (app === 'gu') check(dirOf(app), 'npm', 'run', 'test:scripts');
      check(dirOf(app), 'npm', 'run', 'typecheck');
      check(dirOf(app), 'npm', 'run', 'build');
      if (app === 'gu') check(dirOf(app), 'npm', 'run', 'check:deploy', '--', '--mode', 'config');
    }
  }
  if (sharedAuth) check('.', 'node', '--experimental-strip-types', '--test', 'packages/shared/auth/client.test.mjs');
  return { apps: allApps.filter(app => apps.has(app)), checks, manual };
}

export function main(args = process.argv.slice(2), cwd = root) {
  let base = 'HEAD';
  let run = false;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--help') {
      console.log('Usage: node scripts/agent/check.mjs [--base REF] [--run]');
      console.log('Default: preview uncommitted/untracked changes. --base adds commits since the merge-base.');
      console.log('--run executes local checks only; dependencies must already be installed. No deploy or install.');
      return 0;
    }
    if (args[i] === '--run') run = true;
    else if (args[i] === '--base' && args[i + 1] && !args[i + 1].startsWith('-')) base = args[++i];
    else throw new Error(`Unknown option or missing value: ${args[i]}`);
  }

  const { mergeBase, files } = changedFiles(cwd, base);
  const plan = makePlan(files);
  console.log(`Review base: ${mergeBase}`);
  console.log(`Changed files: ${files.length}; apps: ${plan.apps.join(', ') || '(none)'}`);
  for (const { cwd: directory, argv } of plan.checks) console.log(`[${directory}] ${argv.join(' ')}`);
  for (const file of plan.manual) console.log(`MANUAL: ${JSON.stringify(file)} has no check mapping.`);
  console.log('UI acceptance, live services and CI semantics require separate review when affected.');
  if (!run) {
    console.log('Preview only; no checks executed.');
    return 0;
  }
  if (plan.manual.length) {
    console.error('Unmapped paths need an explicit check strategy; no checks executed.');
    return 2;
  }
  if (!plan.checks.length) {
    console.log('No automated checks selected; this is not an acceptance result.');
    return 0;
  }
  if (Number(process.versions.node.split('.')[0]) < 24) throw new Error('Use Node 24 or newer for the selected checks.');
  for (const { cwd: directory, argv } of plan.checks) {
    console.log(`\nRunning [${directory}] ${argv.join(' ')}`);
    const result = spawnSync(argv[0], argv.slice(1), {
      cwd: path.resolve(cwd, directory), stdio: 'inherit', shell: false,
    });
    if (result.error || result.status !== 0) {
      console.error(`FAILED [${directory}] ${argv.join(' ')}${result.error ? `: ${result.error.message}` : ''}`);
      return 1;
    }
  }
  console.log(`Passed ${plan.checks.length} selected local checks. Manual acceptance remains separate.`);
  return 0;
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  try { process.exitCode = main(); }
  catch (error) {
    // Git errors can contain paths but never require dumping repository contents.
    console.error(error.message);
    process.exitCode = 1;
  }
}
