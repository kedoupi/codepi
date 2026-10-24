// Guard the append-only D1 migration contract:
//  1. No duplicate numeric prefixes within one migrations directory, beyond the
//     documented GU baseline (`0002_calendar.sql` + `0002_sso.sql`), which predates
//     this guard and must not grow.
//  2. No migration file recorded in the baseline may be modified afterwards;
//     a modified applied migration can diverge local/CI/remote schemas.
//
// The baseline lives in check-migrations-baseline.json and is the frozen SHA-256
// of every migration that existed when the guard was introduced.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';

export const MIGRATION_DIRS = {
  'apps/web/migrations': 'apps/web',
  'apps/web/migrations-blog': 'apps/web',
  'apps/gu/migrations': 'apps/gu',
  'apps/gzh/migrations': 'apps/gzh',
  'apps/project/migrations': 'apps/project',
  'apps/me/migrations': 'apps/me',
  'services/auth/migrations': 'services/auth',
  'services/mcp/migrations': 'services/mcp',
  'apps/health/migrations': 'apps/health',
};

// Pre-guard history we deliberately tolerate; anything beyond this list fails.
const LEGACY_PAIR = new Set([
  'apps/gu/migrations/0002_calendar.sql', 'apps/gu/migrations/0002_sso.sql',
]);

const root = fileURLToPath(new URL('../../', import.meta.url));
const baselinePath = fileURLToPath(new URL('./check-migrations-baseline.json', import.meta.url));

export function sha256(content) {
  return createHash('sha256').update(content).digest('hex');
}

export function numericPrefix(filename) {
  const match = /^(\d+)_/.exec(filename);
  return match ? match[1] : null;
}

export function scanMigrations(cwd = root) {
  const entries = [];
  for (const dir of Object.keys(MIGRATION_DIRS)) {
    let files;
    try {
      files = readdirSync(path.join(cwd, dir)).filter(f => f.endsWith('.sql'));
    } catch {
      continue; // directory not present in this worktree
    }
    for (const file of files.sort()) {
      const rel = `${dir}/${file}`;
      entries.push({ rel, prefix: numericPrefix(file), hash: sha256(readFileSync(path.join(cwd, rel))) });
    }
  }
  return entries;
}

export function findDuplicatePrefixes(entries) {
  const byDirPrefix = new Map();
  for (const { rel, prefix } of entries) {
    if (!prefix) continue;
    const normalized = prefix.replace(/^0+/, '') || '0';
    const key = `${path.posix.dirname(rel)}/${normalized.padStart(4, '0')}`;
    byDirPrefix.set(key, [...(byDirPrefix.get(key) || []), rel]);
  }
  return [...byDirPrefix.entries()]
    .filter(([, files]) => files.length > 1 && !files.every(file => LEGACY_PAIR.has(file)))
    .map(([key, files]) => ({ key, files }));
}

export function findModifiedBaseline(entries, baseline) {
  const current = new Map(entries.map(e => [e.rel, e.hash]));
  const problems = [];
  for (const [rel, hash] of Object.entries(baseline)) {
    if (current.has(rel) && current.get(rel) !== hash) problems.push({ rel, kind: 'modified' });
    if (!current.has(rel)) problems.push({ rel, kind: 'deleted' });
  }
  return problems;
}

export function findUnbaselined(entries, baseline, notApplied = []) {
  const allowlist = new Set(notApplied);
  return entries
    .filter(({ rel }) => !Object.hasOwn(baseline, rel) && !allowlist.has(rel))
    .map(({ rel }) => ({ rel, kind: 'unbaselined' }));
}

export function main(args = process.argv.slice(2), cwd = root) {
  const entries = scanMigrations(cwd);
  assert.ok(entries.length > 0, 'no migrations found; refusing to validate an empty tree');

  const duplicates = findDuplicatePrefixes(entries);
  for (const { key, files } of duplicates) {
    console.error(`Duplicate migration prefix ${key}:\n  ${files.join('\n  ')}`);
  }

  const baselineDocument = JSON.parse(readFileSync(baselinePath, 'utf8'));
  const baseline = baselineDocument.files;
  const drift = findModifiedBaseline(entries, baseline);
  const unbaselined = findUnbaselined(entries, baseline, baselineDocument.notApplied);
  for (const { rel, kind } of [...drift, ...unbaselined]) console.error(`Baseline migration ${kind}: ${rel}`);

  if (duplicates.length || drift.length || unbaselined.length) {
    console.error(`${duplicates.length} duplicate prefix(es), ${drift.length} baseline drift(s), ${unbaselined.length} unbaselined migration(s). Migrations are append-only.`);
    return 1;
  }
  console.log(`${entries.length} migration files OK (GU duplicate-0002 baseline preserved).`);
  return 0;
}

const isMain = process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;
if (isMain) process.exitCode = main();
