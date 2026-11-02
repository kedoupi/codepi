import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, realpathSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const defaultRoot = fileURLToPath(new URL('../../', import.meta.url));
export const baselineRelativePath = '.agent/task-base';

function git(cwd, args) {
  return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

function usage() {
  console.log('Usage: node scripts/agent/task-base.mjs [--set [REF] | --show | --clear]');
  console.log('Default: record the current HEAD as this worktree\'s local task baseline.');
  console.log('The baseline is stored in .agent/task-base, which is ignored and not shared across worktrees.');
}

export function baselinePath(cwd) {
  return path.join(realpathSync(cwd), baselineRelativePath);
}

export function recordBaseline(cwd = defaultRoot, ref = 'HEAD') {
  const root = git(cwd, ['rev-parse', '--show-toplevel']);
  if (realpathSync(cwd) !== realpathSync(root)) {
    throw new Error(`Run task-base from the repository root: ${root}`);
  }
  const commit = git(root, ['rev-parse', '--verify', '--end-of-options', `${ref}^{commit}`]);
  const target = baselinePath(root);
  mkdirSync(path.dirname(target), { recursive: true });
  const temporary = `${target}.${process.pid}.tmp`;
  writeFileSync(temporary, `${commit}\n`, { mode: 0o600 });
  renameSync(temporary, target);
  return { root, commit, target };
}

export function readBaseline(cwd = defaultRoot) {
  const target = baselinePath(cwd);
  let source;
  try {
    source = readFileSync(target, 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT') {
      throw new Error('No local task baseline. Run `pnpm task:base` before starting a task.');
    }
    throw error;
  }
  const ref = source.trim();
  if (!/^[0-9a-f]{40}$/.test(ref)) throw new Error(`Invalid local task baseline in ${baselineRelativePath}.`);
  const commit = git(cwd, ['rev-parse', '--verify', '--end-of-options', `${ref}^{commit}`]);
  return { commit, target };
}

export function main(args = process.argv.slice(2), cwd = process.cwd()) {
  if (args.includes('--help')) {
    usage();
    return 0;
  }
  if (args.length === 1 && args[0] === '--show') {
    const { commit, target } = readBaseline(cwd);
    console.log(`Task baseline: ${commit}`);
    console.log(`Stored in: ${target}`);
    return 0;
  }
  if (args.length === 1 && args[0] === '--clear') {
    rmSync(baselinePath(cwd), { force: true });
    console.log(`Cleared local task baseline: ${baselineRelativePath}`);
    return 0;
  }
  if (args.length > 2 || (args.length === 2 && args[0] !== '--set') || (args.length === 1 && args[0] !== '--set' && args[0].startsWith('-'))) {
    throw new Error('Invalid arguments. Use --help for usage.');
  }
  const ref = args.length === 2 ? args[1] : 'HEAD';
  const { commit, target } = recordBaseline(cwd, ref);
  console.log(`Task baseline: ${commit}`);
  console.log(`Stored in: ${target}`);
  console.log('Run full task checks: pnpm check:task');
  return 0;
}

const invokedPath = process.execArgv.includes('--eval') || process.argv[1]?.startsWith('-') ? null : process.argv[1];
if (invokedPath && realpathSync(fileURLToPath(import.meta.url)) === realpathSync(invokedPath)) {
  try { process.exitCode = main(); }
  catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
