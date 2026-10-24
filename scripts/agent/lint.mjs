// Zero-dependency lint: syntax-check every repo script with `node --check`, parse
// every JSON/JSONC-adjacent config we own, and validate Markdown links. This
// catches the most common breakages without adding an eslint dependency.
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

export function collectMarkdown(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    if (SKIP_DIRS.has(entry)) continue;
    const full = path.join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) collectMarkdown(full, out);
    else if (path.extname(entry).toLowerCase() === '.md') out.push(full);
  }
  return out;
}

function withoutCodeBlocks(source) {
  let fenced = false;
  return source.split('\n').map(line => {
    if (/^\s*(```|~~~)/.test(line)) {
      fenced = !fenced;
      return '';
    }
    return fenced ? '' : line;
  }).join('\n');
}

export function githubSlug(heading) {
  return heading
    .trim()
    .replace(/[`*_~]/g, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s-]/gu, '')
    .replace(/\s/g, '-');
}

function headingAnchors(source) {
  const anchors = new Set();
  const counts = new Map();
  for (const line of withoutCodeBlocks(source).split('\n')) {
    const match = /^(?: {0,3}#{1,6})\s+(.+?)\s*#*\s*$/.exec(line);
    if (!match) continue;
    const base = githubSlug(match[1]);
    const count = counts.get(base) || 0;
    anchors.add(count ? `${base}-${count}` : base);
    counts.set(base, count + 1);
  }
  return anchors;
}

function isExternal(target) {
  return /^(?:[a-z][a-z\d+.-]*:|\/\/)/i.test(target);
}

export function lintMarkdown(file) {
  const source = readFileSync(file, 'utf8');
  const clean = withoutCodeBlocks(source);
  const errors = [];
  const anchors = headingAnchors(source);
  const linkPattern = /(?<!!)\[[^\]]*]\((?:<([^>]+)>|([^)\s]+))(?:\s+["'][^"']*["'])?\)/g;
  for (const match of clean.matchAll(linkPattern)) {
    const target = (match[1] || match[2] || '').trim();
    if (!target || isExternal(target)) continue;
    const hashIndex = target.indexOf('#');
    const rawPath = hashIndex < 0 ? target : target.slice(0, hashIndex);
    const fragment = hashIndex < 0 ? '' : decodeURIComponent(target.slice(hashIndex + 1));
    if (!rawPath) {
      if (fragment && !anchors.has(fragment)) errors.push(`missing anchor #${fragment}`);
      continue;
    }
    let resolved;
    try {
      resolved = path.resolve(path.dirname(file), decodeURIComponent(rawPath.split('?')[0]));
    } catch {
      errors.push(`invalid link target ${target}`);
      continue;
    }
    try {
      if (!statSync(resolved).isFile() && !statSync(resolved).isDirectory()) errors.push(`missing path ${rawPath}`);
    } catch {
      errors.push(`missing path ${rawPath}`);
      continue;
    }
    if (fragment && statSync(resolved).isFile()) {
      const targetAnchors = headingAnchors(readFileSync(resolved, 'utf8'));
      if (!targetAnchors.has(fragment)) errors.push(`missing anchor ${fragment} in ${rawPath}`);
    }
  }
  return errors;
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
  for (const file of collectMarkdown(cwd)) {
    for (const error of lintMarkdown(file)) {
      failed += 1;
      console.error(`MARKDOWN ${path.relative(cwd, file)}: ${error}`);
    }
  }
  const jsonCount = collectJson(cwd).length;
  const markdownCount = collectMarkdown(cwd).length;
  if (failed) {
    console.error(`${failed} file(s) failed lint.`);
    return 1;
  }
  console.log(`${scripts.length} scripts, ${jsonCount} JSON files, and ${markdownCount} Markdown files lint-clean.`);
  return 0;
}

const isMain = process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href;
if (isMain) process.exitCode = main();
