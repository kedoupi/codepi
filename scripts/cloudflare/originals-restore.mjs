import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { lstat, mkdir, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  cloudflareApi,
  DATABASES,
  decrypt,
  keyId,
  ORIGINAL_COLLECTIONS,
  originalCollection,
  originalFileName,
  requireDatabaseManifest,
  validOriginalId,
  validOriginalObjectKey,
} from './backup-core.mjs';

const MAX_FILE = 8 * 1024 * 1024;
const uuid = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/;
const sha = /^[a-f0-9]{64}$/;

async function regularFile(file, maxBytes) {
  const info = await lstat(file);
  assert.ok(info.isFile() && info.size > 0 && info.size <= maxBytes,
    'backup file is invalid or exceeds the size limit');
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
  assert.ok(info.size === entry.bytes && sha.test(entry.sha256),
    'backup ciphertext size or SHA-256 is invalid');
  assert.equal(await fileHash(file), entry.sha256, 'backup ciphertext SHA-256 mismatch');
  return file;
}

function validateEntry(collection, entry, manifest, seenFiles, seenObjects) {
  const definition = originalCollection(collection.source);
  assert.ok(entry.kind === definition.kind && validOriginalId(definition, entry.material_id)
    && validOriginalObjectKey(definition, entry.material_id, entry.object_key)
    && !seenFiles.has(entry.file) && !seenObjects.has(entry.object_key)
    && entry.file === originalFileName(definition, entry.material_id)
    && entry.created_at === manifest.created_at
    && Number.isSafeInteger(entry.source_bytes) && entry.source_bytes > 0 && entry.source_bytes <= MAX_FILE
    && Number.isSafeInteger(entry.bytes) && entry.bytes > 0
    && sha.test(entry.source_sha256), `invalid or duplicate ${collection.source} original entry`);
  seenFiles.add(entry.file);
  seenObjects.add(entry.object_key);
}

export function manifestOriginalCollections(manifest) {
  assert.ok(manifest && typeof manifest === 'object', 'backup manifest is invalid');
  const seenFiles = new Set(), seenObjects = new Set();
  if (manifest.version === 2) {
    requireDatabaseManifest(manifest.databases, { legacy: true });
    const materials = manifest.materials;
    assert.ok(materials?.source === 'codepi-gu' && Array.isArray(materials.entries)
      && materials.objects === materials.entries.length
      && Number.isSafeInteger(materials.through) && materials.through >= 0,
    'complete GU original manifest is required');
    const collection = {
      source: 'codepi-gu', kind: 'gu-material', through: materials.through,
      objects: materials.objects, entries: materials.entries,
    };
    for (const entry of collection.entries) validateEntry(collection, entry, manifest, seenFiles, seenObjects);
    return [collection];
  }
  assert.equal(manifest.version, 3, 'unsupported backup manifest version');
  requireDatabaseManifest(manifest.databases);
  assert.ok(Array.isArray(manifest.materials?.collections)
    && manifest.materials.collections.length === ORIGINAL_COLLECTIONS.length,
  'complete original manifest is required');
  const sources = new Set();
  let total = 0;
  const collections = manifest.materials.collections.map(collection => {
    const definition = originalCollection(collection.source);
    assert.ok(!sources.has(collection.source) && collection.kind === definition.kind
      && Array.isArray(collection.entries) && collection.objects === collection.entries.length
      && Number.isSafeInteger(collection.through) && collection.through >= 0,
    'backup manifest has an invalid or duplicate original collection');
    sources.add(collection.source);
    total += collection.objects;
    for (const entry of collection.entries) validateEntry(collection, entry, manifest, seenFiles, seenObjects);
    return collection;
  });
  assert.deepEqual([...sources].sort(), ORIGINAL_COLLECTIONS.map(item => item.source).sort(),
    'complete original manifest is required');
  assert.equal(manifest.materials.objects, total, 'backup manifest original count is incomplete');
  return collections;
}

function manifestDatabase(manifest, collection) {
  const definition = originalCollection(collection.source);
  const matches = (manifest.databases ?? []).filter(entry => entry?.database === definition.database);
  assert.equal(matches.length, 1, `matching ${definition.database} D1 backup is required`);
  const database = matches[0];
  assert.ok(uuid.test(database.database_id ?? '') && database.file === `${definition.database}.sql.enc`
    && database.created_at === manifest.created_at, `matching ${definition.database} D1 backup is required`);
  if (DATABASES[definition.database]) {
    assert.equal(database.database_id, DATABASES[definition.database],
      `${definition.database} D1 identity differs from the managed production ID`);
  }
  return database;
}

async function queryIndex(databaseId, collection, { env, request }) {
  const definition = originalCollection(collection.source);
  const result = await cloudflareApi(`/d1/database/${databaseId}/query`, {
    sql: `SELECT id,${definition.key_column} AS object_key,${definition.size_column} AS size,sha256
      FROM ${definition.table}
      ORDER BY ${definition.key_column}`,
  }, { accountId: env.CLOUDFLARE_ACCOUNT_ID, token: env.CLOUDFLARE_API_TOKEN, request });
  assert.ok(result?.length === 1 && result[0].success && Array.isArray(result[0].results),
    `recovery ${definition.database} original index is unavailable`);
  return result[0].results;
}

async function outputBoundary(outDir) {
  const parent = await realpath(path.dirname(path.resolve(outDir)));
  const git = spawnSync('git', ['-C', parent, 'rev-parse', '--show-toplevel'],
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, LC_ALL: 'C' } });
  assert.ok(!git.error && git.status !== null, 'cannot establish the recovery output boundary');
  assert.notEqual(git.status, 0, 'plaintext recovery output must be outside every Git checkout');
  assert.ok(git.status === 128 && /not a git repository/.test(git.stderr),
    'cannot establish the recovery output boundary');
  return path.join(parent, path.basename(path.resolve(outDir)));
}

export async function restoreOriginals({ backupDir, privateKeyFile, databaseIds, outDir,
  env = process.env, request = fetch } = {}) {
  assert.ok(backupDir && privateKeyFile && outDir && databaseIds,
    'backup directory, private key, recovery database IDs and a new output directory are required');
  const manifestFile = path.join(backupDir, 'manifest.json');
  await regularFile(manifestFile, 1024 * 1024);
  const manifest = JSON.parse(await readFile(manifestFile, 'utf8'));
  const collections = manifestOriginalCollections(manifest);
  const privateKey = await readFile(privateKeyFile, 'utf8');
  assert.equal(manifest.key_id, keyId(privateKey), 'recovery key does not match this backup');

  const productionIds = new Set(Object.values(DATABASES).map(id => id.toLowerCase()));
  for (const database of manifest.databases ?? []) {
    const id = typeof database?.database_id === 'string' ? database.database_id.toLowerCase() : '';
    if (uuid.test(id)) productionIds.add(id);
  }
  const selectedIds = {};
  for (const collection of collections) {
    const id = databaseIds[collection.source];
    assert.match(id ?? '', uuid, `target recovery D1 UUID is required for ${collection.source}`);
    assert.ok(!productionIds.has(id), 'refusing to read a production database during recovery');
    selectedIds[collection.source] = id;
  }
  assert.deepEqual(Object.keys(databaseIds).sort(), collections.map(item => item.source).sort(),
    'recovery database IDs must cover every original collection exactly once');

  const databases = new Map();
  const databaseIdsSeen = new Set();
  for (const collection of collections) {
    const database = manifestDatabase(manifest, collection);
    assert.ok(!databaseIdsSeen.has(database.database_id), 'backup manifest reuses a D1 identity');
    databaseIdsSeen.add(database.database_id);
    databases.set(collection.source, database);
    await ciphertextPath(backupDir, database);
  }

  const indexes = new Map();
  for (const collection of collections) {
    const definition = originalCollection(collection.source);
    const entries = new Map(collection.entries.map(entry => [entry.object_key, entry]));
    const rows = await queryIndex(selectedIds[collection.source], collection, { env, request });
    const indexed = new Set();
    for (const row of rows) {
      const entry = entries.get(row.object_key);
      assert.ok(entry && entry.material_id === row.id && entry.source_bytes === row.size
        && entry.source_sha256 === row.sha256 && !indexed.has(row.object_key),
      `recovery ${definition.database} index has a missing or mismatched original`);
      indexed.add(row.object_key);
    }
    assert.ok(indexed.size >= Math.min(collection.through, entries.size),
      `recovery ${definition.database} index is missing exported originals`);
    indexes.set(collection.source, { entries, indexed });
  }

  const output = await outputBoundary(outDir);
  await mkdir(output, { mode: 0o700 }); // An existing target is never overwritten.
  try {
    const reportCollections = [];
    for (const collection of collections) {
      const { entries, indexed } = indexes.get(collection.source);
      for (const entry of entries.values()) {
        const file = await ciphertextPath(backupDir, entry, true);
        const recovered = decrypt(await readFile(file), privateKey, { maxBytes: entry.source_bytes });
        const metadata = { kind: entry.kind, material_id: entry.material_id, object_key: entry.object_key,
          source_bytes: entry.source_bytes, source_sha256: entry.source_sha256, created_at: entry.created_at };
        assert.deepEqual(recovered.metadata, metadata, `${collection.source} original envelope identity mismatch`);
        assert.equal(recovered.sql.length, entry.source_bytes, 'recovered original size mismatch');
        assert.equal(createHash('sha256').update(recovered.sql).digest('hex'), entry.source_sha256,
          'recovered original SHA-256 mismatch');
        const target = path.join(output, collection.source, entry.object_key);
        await mkdir(path.dirname(target), { recursive: true, mode: 0o700 });
        await writeFile(target, recovered.sql, { flag: 'wx', mode: 0o600 });
      }
      reportCollections.push({
        source: collection.source,
        database_id: selectedIds[collection.source],
        objects: entries.size,
        indexed: indexed.size,
        extra_objects: entries.size - indexed.size,
      });
    }
    const report = {
      version: 2,
      ok: true,
      created_at: new Date().toISOString(),
      backup_created_at: manifest.created_at,
      key_id: manifest.key_id,
      collections: reportCollections,
      objects: reportCollections.reduce((sum, collection) => sum + collection.objects, 0),
      indexed: reportCollections.reduce((sum, collection) => sum + collection.indexed, 0),
      extra_objects: reportCollections.reduce((sum, collection) => sum + collection.extra_objects, 0),
    };
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
    const args = process.argv.slice(2), opts = { database: {} };
    assert.ok(args.length >= 8 && args.length % 2 === 0,
      'Usage: originals-restore.mjs --backup-dir <dir> --private-key <pem> --database <name=UUID> [--database <name=UUID>] --out <new-dir>');
    for (let i = 0; i < args.length; i += 2) {
      const flag = args[i], value = args[i + 1];
      assert.ok(['--backup-dir', '--private-key', '--database', '--out'].includes(flag) && value,
        'unknown, incomplete or duplicate material recovery option');
      if (flag === '--database') {
        const match = /^(codepi-(?:gu|me))=([a-f0-9-]{36})$/.exec(value);
        assert.ok(match && !opts.database[match[1]], 'invalid or duplicate --database name=UUID');
        opts.database[match[1]] = match[2];
      } else {
        assert.ok(!opts[flag], 'unknown, incomplete or duplicate material recovery option');
        opts[flag] = value;
      }
    }
    assert.ok(opts['--backup-dir'] && opts['--private-key'] && opts['--out'],
      'backup directory, private key and output directory are required');
    const report = await restoreOriginals({
      backupDir: opts['--backup-dir'],
      privateKeyFile: opts['--private-key'],
      databaseIds: opts.database,
      outDir: opts['--out'],
    });
    console.log(`PASS original recovery: ${report.objects} originals, ${report.indexed} indexed, `
      + `${report.extra_objects} newer originals across ${report.collections.length} collections`);
  } catch (error) {
    console.error(`Original recovery failed: ${error.message}`);
    process.exitCode = 1;
  }
}
