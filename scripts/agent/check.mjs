import { execFileSync, spawn } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import os from 'node:os';
import path from 'node:path';
import { readBaseline } from './task-base.mjs';
import { allApps, crossServiceRules, migrationDirs, packageCheck, packageCommands, specialRules, wranglerConfigs } from './check-plan.mjs';

export const minimumNodeMajor = 24;
export const packageApp = check => check.app ?? Object.keys(packageCommands).find(app => packageCommands[app].cwd === check.cwd) ?? check.cwd;
export const packageName = check => check.name ?? (check.argv[0] === 'pnpm' ? check.argv[3] : check.argv.join(' '));
export const appDirs = Object.fromEntries(Object.entries(packageCommands).map(([app, config]) => [app, config.cwd]));
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

function matches(file, rule) {
  return rule.files?.includes(file) || rule.prefixes?.some(prefix => file.startsWith(prefix))
    || rule.suffixes?.some(suffix => file.endsWith(suffix));
}

export function makePlan(files, tier = 'full') {
  const apps = new Set();
  const manual = [];
  let workflow = false;
  let sharedAuth = false;
  let cfGovernance = false;
  const touchesMigrations = files.some(file => migrationDirs.some(dir => file.startsWith(dir))
    || file.startsWith('scripts/agent/check-migrations'));
  if (files.some(file => wranglerConfigs.includes(file))) cfGovernance = true;
  for (const file of files) {
    const special = specialRules.find(rule => matches(file, rule));
    if (special) {
      if (special.documentation) continue;
      special.apps?.forEach(app => apps.add(app));
      workflow ||= special.workflow ?? false;
      sharedAuth ||= special.sharedAuth ?? false;
      cfGovernance ||= special.governance ?? false;
      continue;
    }
    const app = allApps.find(name => file.startsWith(`${dirOf(name)}/`));
    if (!app) { manual.push(file); continue; }
    apps.add(app);
    for (const rule of crossServiceRules) if (rule.match(file)) rule.apps.forEach(name => apps.add(name));
  }

  const checks = [];
  const check = (cwd, ...argv) => checks.push({ cwd, argv });
  if (cfGovernance) {
    // 只读仓库文件的静态守门；绝不访问 Cloudflare 或远程数据库。
    check('.', 'node', '--test', 'scripts/cloudflare/*.test.mjs');
    check('.', 'node', 'scripts/cloudflare/validate-governance.mjs');
  }
  if (workflow) check('.', 'node', '--test', 'scripts/agent/*.test.mjs');
  if (workflow) check('.', 'node', 'scripts/agent/lint.mjs');
  if (touchesMigrations) {
    check('.', 'node', '--test', 'scripts/agent/check-migrations.test.mjs');
    check('.', 'node', 'scripts/agent/check-migrations.mjs');
  }
  for (const app of allApps.filter(name => apps.has(name))) {
    for (const command of packageCommands[app].commands) {
      if (tier === 'full' || command.tier === 'quick') checks.push(packageCheck(app, command));
    }
  }
  if (sharedAuth && tier === 'full') check('.', 'node', '--experimental-strip-types', '--test', 'packages/shared/auth/client.test.mjs');
  return { apps: allApps.filter(app => apps.has(app)), checks, manual };
}

function runChecks(checks, cwd) {
  const concurrency = Math.max(1, Math.min(4, os.availableParallelism() - 1, checks.length));
  const results = new Array(checks.length);
  const pending = new Set(checks.keys());
  const running = new Map();
  const indexes = new Map(checks.map((check, index) => [`${packageApp(check)}:${packageName(check)}`, index]));
  const dependencies = checks.map(check => {
    const dependencyName = check.after ?? (check.app === 'mcp' && check.name === 'test:browser:built' ? 'build' : undefined);
    if (!dependencyName) return [];
    const dependency = indexes.get(`${packageApp(check)}:${dependencyName}`);
    if (dependency === undefined) throw new Error(`Missing check dependency: ${check.app} ${check.name} after ${check.after}`);
    return [dependency];
  });

  return (async () => {
    while (pending.size || running.size) {
      let progressed = false;
      for (const index of [...pending]) {
        const failedDependency = dependencies[index].find(dependency => results[dependency] && (results[dependency].skipped || results[dependency].error || results[dependency].code !== 0));
        if (failedDependency !== undefined) {
          results[index] = { check: checks[index], skipped: true, dependency: failedDependency };
          pending.delete(index);
          progressed = true;
        }
      }
      for (const index of [...pending]) {
        if (running.size >= concurrency) break;
        if (dependencies[index].some(dependency => !results[dependency])) continue;
        if (checks[index].exclusive && running.size) continue;
        if ([...running.keys()].some(other => checks[other].exclusive)) continue;
        const check = checks[index];
        pending.delete(index);
        const promise = new Promise(resolve => {
        const child = spawn(check.argv[0], check.argv.slice(1), { cwd, stdio: 'inherit', shell: false });
        child.once('error', error => resolve({ check, error }));
        child.once('close', code => resolve({ check, code }));
        }).then(result => {
          results[index] = result;
          running.delete(index);
          return result;
        });
        running.set(index, promise);
        progressed = true;
      }
      if (running.size) await Promise.race(running.values());
      else if (pending.size && !progressed) throw new Error('Check dependency cycle detected');
    }
    return results;
  })();
}

export async function main(args = process.argv.slice(2), cwd = root) {
  let base = 'HEAD', run = false, task = false, all = false, explicitBase = false, quick = false, tier = 'quick';
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--help') {
      console.log('Usage: node scripts/agent/check.mjs [--base REF | --task | --all] [--run] [--quick]');
      console.log('Default: preview quick checks for uncommitted/untracked changes.');
      console.log('--task uses .agent/task-base and full checks. --all selects every package.');
      console.log('--base selects full checks from a merge-base; --quick limits any scope.');
      console.log('--run executes local checks only. No deploy or install.');
      return 0;
    }
    if (args[i] === '--run') run = true;
    else if (args[i] === '--task') { task = true; tier = 'full'; }
    else if (args[i] === '--all') { all = true; tier = 'full'; }
    else if (args[i] === '--quick') quick = true;
    else if (args[i] === '--base' && args[i + 1] && !args[i + 1].startsWith('-')) {
      base = args[++i];
      explicitBase = true;
      tier = 'full';
    }
    else throw new Error(`Unknown option or missing value: ${args[i]}`);
  }
  if ([task, all, explicitBase].filter(Boolean).length > 1) throw new Error('Use only one of --task, --all or --base.');
  if (quick && (task || all || explicitBase)) throw new Error('--quick is only for uncommitted changes; full scopes cannot be weakened.');
  if (task) base = readBaseline(cwd).commit;

  const { mergeBase, files } = all ? { mergeBase: 'all packages', files: allApps.map(app => `${dirOf(app)}/`) } : changedFiles(cwd, base);
  const plan = makePlan(files, tier);
  console.log(`Review base: ${mergeBase}`);
  console.log(`Changed files: ${files.length}; apps: ${plan.apps.join(', ') || '(none)'}; mode: ${tier}`);
  if (task) console.log(`Task baseline: ${base}`);
  for (const { cwd: directory, argv } of plan.checks) console.log(`[${directory}] ${argv.join(' ')}`);
  for (const file of plan.manual) console.log(`MANUAL: ${JSON.stringify(file)} has no check mapping.`);
  if (plan.manual.length) console.error('Unmapped paths need an explicit check strategy; no checks executed.');
  console.log('UI acceptance, live services and CI semantics require separate review when affected.');
  if (!run) { console.log('Preview only; no checks executed.'); return plan.manual.length ? 2 : 0; }
  if (plan.manual.length) return 2;
  if (!plan.checks.length) {
    console.log('No automated checks selected; this is not an acceptance result.');
    return 0;
  }
  if (Number(process.versions.node.split('.')[0]) < minimumNodeMajor) throw new Error(`Use Node ${minimumNodeMajor} or newer for the selected checks.`);
  console.log(`Executing ${plan.checks.length} selected local checks in up to ${Math.min(4, plan.checks.length)} parallel workers.`);
  const results = await runChecks(plan.checks, cwd);
  const failed = results.filter(result => !result.skipped && (result.error || result.code !== 0));
  for (const { check, error } of failed) console.error(`FAILED [${check.cwd}] ${check.argv.join(' ')}${error ? `: ${error.message}` : ''}`);
  for (const { check, dependency } of results.filter(result => result.skipped)) {
    const prerequisite = results[dependency].check;
    console.error(`SKIPPED [${check.cwd}] ${check.argv.join(' ')}: prerequisite failed [${prerequisite.cwd}] ${prerequisite.argv.join(' ')}`);
  }
  if (failed.length) return 1;
  console.log(`Passed ${results.length} selected local checks in up to ${Math.min(4, plan.checks.length)} parallel workers. Manual acceptance remains separate.`);
  return 0;
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  try { process.exitCode = await main(); }
  catch (error) {
    // Git errors can contain paths but never require dumping repository contents.
    console.error(error.message);
    process.exitCode = 1;
  }
}
