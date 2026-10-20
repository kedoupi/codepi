import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { cloudflareApi, DATABASES, decrypt } from './d1-backup.mjs';
import { prepareRestoreSql } from './d1-restore-sql.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));

// Restore to a new, empty D1 first. Production databases are excluded;
// a traffic cutover remains a separate, reviewed incident operation.
export async function restoreBackup({ file, privateKeyFile, databaseId, env = process.env,
  request = fetch, execute = spawnSync }) {
  assert.match(databaseId || '', /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i, 'target D1 UUID is required');
  assert.ok(!Object.values(DATABASES).includes(databaseId.toLowerCase()), 'refusing to restore over a production database');
  const { sql, metadata } = decrypt(await readFile(file), await readFile(privateKeyFile, 'utf8'));
  const accountId = env.CLOUDFLARE_ACCOUNT_ID;
  const token = env.CLOUDFLARE_API_TOKEN;
  const result = await cloudflareApi(`/d1/database/${databaseId}/query`, {
    sql: "SELECT count(*) AS n FROM sqlite_master WHERE type IN ('table','view') AND name NOT GLOB '_cf_*' AND name NOT GLOB 'sqlite_*'",
  }, { accountId, token, request });
  assert.ok(result?.[0]?.success && result[0].results?.[0]?.n === 0,
    'restore target must be empty; existing data was not changed');
  const dir = await mkdtemp(path.join(os.tmpdir(), 'codepi-restore-'));
  try {
    const sqlFile = path.join(dir, 'restore.sql');
    const configFile = path.join(dir, 'wrangler.json');
    await writeFile(sqlFile, prepareRestoreSql(sql), { mode: 0o600 });
    await writeFile(configFile, JSON.stringify({ name: 'codepi-health-restore',
      account_id: accountId, d1_databases: [{ binding: 'DB', database_name: 'restore-target', database_id: databaseId }] }),
    { mode: 0o600 });
    const result = execute('pnpm', ['--dir', path.join(root, 'apps/health/workers/api'), 'exec', 'wrangler',
      'd1', 'execute', 'restore-target', '--config', configFile, '--remote', '--file', sqlFile, '--yes', '--json'],
    { env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 600000 });
    // Wrangler error output can include SQL values; keep only the exit status.
    assert.ok(!result.error && result.status === 0, `D1 restore failed (exit ${result.status ?? 'unavailable'})`);
    console.log(`PASS restored ${metadata.database} into the empty recovery database`);
    return metadata;
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  try {
    const args = process.argv.slice(2);
    assert.ok(args.length === 6, 'Usage: d1-restore.mjs --file <sql.enc> --private-key <pem> --database-id <new-empty-D1-UUID>');
    const opts = {};
    for (let i = 0; i < args.length; i += 2) {
      assert.ok(['--file', '--private-key', '--database-id'].includes(args[i]), 'unknown restore option');
      assert.ok(!opts[args[i]], 'duplicate restore option');
      opts[args[i]] = args[i + 1];
    }
    await restoreBackup({ file: opts['--file'], privateKeyFile: opts['--private-key'], databaseId: opts['--database-id'] });
  } catch (error) {
    console.error(`Restore failed: ${error.message}`);
    process.exitCode = 1;
  }
}
