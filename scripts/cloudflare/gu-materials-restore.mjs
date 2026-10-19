import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { lstat, mkdir, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { cloudflareApi, DATABASES, decrypt, keyId } from './backup-core.mjs';

const MAX_FILE = 8 * 1024 * 1024;
const uuid = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/;
const sha = /^[a-f0-9]{64}$/;

async function regularFile(file, maxBytes) {
  const info = await lstat(file);
  assert.ok(info.isFile() && info.size > 0 && info.size <= maxBytes, 'backup file is invalid or exceeds the size limit');
  return info;
}

async function fileHash(file) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest('hex');
}

async function ciphertextPath(backupDir, entry, material = false) {
  let file = path.join(backupDir, material ? 'materials' : '', entry.file);
  if (material) {
    try { await lstat(file); }
    catch (error) {
      if (error.code !== 'ENOENT') throw error;
      file = path.join(backupDir, entry.file); // GitHub Release assets are flat.
    }
  }
  const info = await regularFile(file, material ? MAX_FILE + 65536 : 2 * 1024 ** 3);
  assert.ok(info.size === entry.bytes && sha.test(entry.sha256), 'backup ciphertext size or SHA-256 is invalid');
  assert.equal(await fileHash(file), entry.sha256, 'backup ciphertext SHA-256 mismatch');
  return file;
}

export async function restoreMaterials({ backupDir, privateKeyFile, databaseId, outDir,
  env = process.env, request = fetch } = {}) {
  assert.match(databaseId ?? '', uuid, 'target recovery D1 UUID is required');
  assert.ok(!Object.values(DATABASES).includes(databaseId), 'refusing to read a production database during recovery');
  assert.ok(backupDir && privateKeyFile && outDir, 'backup directory, private key and a new output directory are required');
  const manifestFile = path.join(backupDir, 'manifest.json');
  await regularFile(manifestFile, 1024 * 1024);
  const manifest = JSON.parse(await readFile(manifestFile, 'utf8'));
  const materials = manifest.materials;
  assert.ok(manifest.version === 2 && materials?.source === 'codepi-gu' && Array.isArray(materials.entries)
    && materials.objects === materials.entries.length && materials.objects <= 1000
    && Number.isSafeInteger(materials.through) && materials.through >= 0, 'complete GU material manifest is required');
  const privateKey = await readFile(privateKeyFile, 'utf8');
  assert.equal(manifest.key_id, keyId(privateKey), 'recovery key does not match this backup');
  const database = manifest.databases?.find(entry => entry.database === 'codepi-gu');
  assert.ok(database?.database_id === DATABASES['codepi-gu'] && database.file === 'codepi-gu.sql.enc'
    && database.created_at === manifest.created_at, 'matching GU D1 backup is required');
  await ciphertextPath(backupDir, database);
  const entries = new Map();
  for (const entry of materials.entries) {
    assert.ok(entry.kind === 'gu-material' && uuid.test(entry.material_id)
      && entry.object_key === `materials/${entry.material_id}` && !entries.has(entry.object_key)
      && entry.file === `gu-material-${entry.material_id}.bin.enc` && entry.created_at === manifest.created_at
      && Number.isSafeInteger(entry.source_bytes) && entry.source_bytes > 0 && entry.source_bytes <= MAX_FILE
      && sha.test(entry.source_sha256), 'invalid or duplicate GU material entry');
    entries.set(entry.object_key, entry);
  }
  const result = await cloudflareApi(`/d1/database/${databaseId}/query`, {
    sql: 'SELECT id,object_key,size,sha256 FROM gu_materials ORDER BY object_key',
  }, { accountId: env.CLOUDFLARE_ACCOUNT_ID, token: env.CLOUDFLARE_API_TOKEN, request });
  assert.ok(result?.length === 1 && result[0].success && Array.isArray(result[0].results),
    'recovery GU material index is unavailable');
  const index = result[0].results, indexed = new Set();
  for (const row of index) {
    const entry = entries.get(row.object_key);
    assert.ok(entry && entry.material_id === row.id && entry.source_bytes === row.size
      && entry.source_sha256 === row.sha256 && !indexed.has(row.object_key),
    'recovery D1 index has a missing or mismatched original');
    indexed.add(row.object_key);
  }

  const parent = await realpath(path.dirname(path.resolve(outDir)));
  const git = spawnSync('git', ['-C', parent, 'rev-parse', '--show-toplevel'],
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, LC_ALL: 'C' } });
  assert.ok(!git.error && git.status !== null, 'cannot establish the recovery output boundary');
  assert.notEqual(git.status, 0, 'plaintext recovery output must be outside every Git checkout');
  assert.ok(git.status === 128 && /not a git repository/.test(git.stderr),
    'cannot establish the recovery output boundary');
  const output = path.join(parent, path.basename(path.resolve(outDir)));
  await mkdir(output, { mode: 0o700 }); // An existing target is never overwritten.
  try {
    await mkdir(path.join(output, 'materials'), { mode: 0o700 });
    for (const entry of entries.values()) {
      const file = await ciphertextPath(backupDir, entry, true);
      const recovered = decrypt(await readFile(file), privateKey, { maxBytes: entry.source_bytes });
      const metadata = { kind: entry.kind, material_id: entry.material_id, object_key: entry.object_key,
        source_bytes: entry.source_bytes, source_sha256: entry.source_sha256, created_at: entry.created_at };
      assert.deepEqual(recovered.metadata, metadata, 'GU material envelope identity mismatch');
      assert.equal(recovered.sql.length, entry.source_bytes, 'recovered GU material size mismatch');
      assert.equal(createHash('sha256').update(recovered.sql).digest('hex'), entry.source_sha256,
        'recovered GU material SHA-256 mismatch');
      await writeFile(path.join(output, entry.object_key), recovered.sql, { flag: 'wx', mode: 0o600 });
    }
    const report = { version: 1, ok: true, created_at: new Date().toISOString(), backup_created_at: manifest.created_at,
      key_id: manifest.key_id, database_id: databaseId, objects: entries.size, indexed: indexed.size,
      extra_objects: entries.size - indexed.size };
    await writeFile(path.join(output, 'restore-report.json'), JSON.stringify(report, null, 2) + '\n',
      { flag: 'wx', mode: 0o600 });
    return report;
  } catch (error) {
    await rm(output, { recursive: true, force: true });
    throw error;
  }
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  try {
    const args = process.argv.slice(2), opts = {};
    assert.equal(args.length, 8,
      'Usage: gu-materials-restore.mjs --backup-dir <dir> --private-key <pem> --database-id <recovery-D1-UUID> --out <new-dir>');
    for (let i = 0; i < args.length; i += 2) {
      assert.ok(['--backup-dir', '--private-key', '--database-id', '--out'].includes(args[i])
        && !opts[args[i]], 'unknown or duplicate material recovery option');
      opts[args[i]] = args[i + 1];
    }
    const report = await restoreMaterials({ backupDir: opts['--backup-dir'], privateKeyFile: opts['--private-key'],
      databaseId: opts['--database-id'], outDir: opts['--out'] });
    console.log(`PASS GU material recovery: ${report.objects} originals, ${report.indexed} indexed, ${report.extra_objects} newer originals`);
  } catch (error) {
    console.error(`GU material recovery failed: ${error.message}`);
    process.exitCode = 1;
  }
}
