// Zero-dependency lint: syntax-check every repo script with `node --check` and
// parse every JSON/JSONC-adjacent config we own. Catches the two most common
// breakages (a syntax error that only fails in CI, a malformed JSON manifest)
// without adding an eslint dependency the repo has explicitly deferred.
//
// Usage: node scripts/agent/lint.mjs
import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = fileURLToPath(new URL('../../', import.meta.url));

const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', '.wrangler', '.svelte-kit', 'coverage', '.astro']);
const CHECK_EXTENSIONS = new Set(['.mjs', '.js']);

export function collectScripts(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    if (SKIP_DIRS.has(entry)) continue;
    const full = path.join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) collectScripts(full, out);
    else if (CHECK_EXTENSIONS.has(path.extname(entry))) out.push(full);
  }
  return out;
}

export function collectJson(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    if (SKIP_DIRS.has(entry)) continue;
    const full = path.join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) collectJson(full, out);
    else if (entry === 'package.json' || entry === 'tsconfig.json' || entry.endsWith('.baseline.json')) out.push(full);
  }
  return out;
}

export function main(cwd = root) {
  const scripts = collectScripts(cwd);
  let failed = 0;
  for (const file of scripts) {
    try {
      execFileSync(process.execPath, ['--check', file], { stdio: ['ignore', 'ignore', 'pipe'] });
    } catch (error) {
      failed += 1;
      console.error(`SYNTAX ${path.relative(cwd, file)}: ${error.stderr?.toString().split('\n')[0] || error.message}`);
    }
  }
  for (const file of collectJson(cwd)) {
    try {
      JSON.parse(readFileSync(file, 'utf8'));
    } catch (error) {
      failed += 1;
      console.error(`JSON ${path.relative(cwd, file)}: ${error.message}`);
    }
  }
  if (failed) {
    console.error(`${failed} file(s) failed lint.`);
    return 1;
  }
  console.log(`${scripts.length} scripts and ${collectJson(cwd).length} JSON files lint-clean.`);
  return 0;
}

const isMain = process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href;
if (isMain) process.exitCode = main();
