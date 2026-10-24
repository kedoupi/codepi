import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, readFile, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  DATABASES,
  DATABASE_NAMES,
  encrypt,
  exportDatabase,
  keyId,
  resolveProductionDatabases,
} from './backup-core.mjs';
export { DATABASES, DATABASE_NAMES, cloudflareApi, decrypt, encrypt, exportDatabase, keyId } from './backup-core.mjs';

export const MAX_EXPORT_BYTES = 1024 * 1024 * 1024;

async function readBoundedExport(response, maxBytes) {
  const contentLength = response.headers?.get('content-length');
  if (/^\d+$/.test(contentLength ?? '')) {
    const declared = Number(contentLength);
    if (Number.isSafeInteger(declared) && declared > maxBytes) {
      throw new Error(`D1 export exceeds size limit (${maxBytes} bytes)`);
    }
  }
  if (!response.body?.getReader) {
    const sql = Buffer.from(await response.arrayBuffer());
    if (sql.length > maxBytes) throw new Error(`D1 export exceeds size limit (${maxBytes} bytes)`);
    return sql;
  }
  const reader = response.body.getReader();
  const chunks = [];
  let bytes = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      const chunk = Buffer.from(value);
      bytes += chunk.length;
      if (bytes > maxBytes) throw new Error(`D1 export exceeds size limit (${maxBytes} bytes)`);
      chunks.push(chunk);
    }
    return Buffer.concat(chunks, bytes);
  } catch (error) {
    await reader.cancel().catch(() => {});
    throw error;
  }
}

export const PUBLIC_KEY_PATH = fileURLToPath(new URL('./backup-public-key.pem', import.meta.url));

export async function runBackup({ outDir, publicKey, env = process.env, request = fetch,
  databases, resolveDatabases = resolveProductionDatabases,
  now = new Date(), wait, timeoutMs, maxExportBytes = MAX_EXPORT_BYTES } = {}) {
  const accountId = env.CLOUDFLARE_ACCOUNT_ID;
  const token = env.CLOUDFLARE_API_TOKEN;
  assert.ok(accountId && token && outDir, 'Cloudflare credentials and --out <dir> are required');
  let selected;
  if (databases) selected = Object.entries(databases);
  else {
    const resolved = await resolveDatabases({
      accountId,
      token,
      request,
      explicit: env.D1_DATABASE_IDS,
    });
    assert.equal(resolved.length, DATABASE_NAMES.length, 'resolved D1 inventory is incomplete');
    assert.deepEqual(resolved.map(database => database.name), [...DATABASE_NAMES],
      'resolved D1 inventory does not match the required names');
    selected = resolved.map(database => [database.name, database.id]);
  }
  publicKey ??= await readFile(PUBLIC_KEY_PATH, 'utf8');
  const recipient = keyId(publicKey);
  await mkdir(outDir, { recursive: true, mode: 0o700 });
  const manifest = { version: 1, created_at: now.toISOString(), key_id: recipient, databases: [] };
  const generatedFiles = [];
  try {
    for (const [name, databaseId] of selected) {
      const url = await exportDatabase(databaseId, { accountId, token, request, wait, timeoutMs });
      const parsed = new URL(url);
      assert.ok(parsed.protocol === 'https:' && parsed.hostname.endsWith('.r2.cloudflarestorage.com'),
        'export download URL must be a Cloudflare HTTPS object');
      const response = await request(url, { signal: AbortSignal.timeout(120000) });
      assert.ok(response.ok, `export download failed: HTTP ${response.status}`);
      const sql = await readBoundedExport(response, maxExportBytes);
      assert.ok(sql.length > 0, 'D1 export is empty');
      const metadata = { database: name, database_id: databaseId, created_at: manifest.created_at };
      const encrypted = encrypt(sql, publicKey, metadata);
      const file = `${name}.sql.enc`;
      const filePath = path.join(outDir, file);
      await writeFile(filePath, encrypted, { mode: 0o600, flag: 'wx' });
      generatedFiles.push(filePath);
      manifest.databases.push({ ...metadata, file, bytes: encrypted.length,
        sha256: createHash('sha256').update(encrypted).digest('hex') });
      console.log(`PASS encrypted backup: ${name}`);
    }
    await writeFile(path.join(outDir, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n',
      { mode: 0o600, flag: 'wx' });
    return manifest;
  } catch (error) {
    await Promise.all(generatedFiles.map(file => unlink(file).catch(() => {})));
    throw error;
  }
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  try {
    assert.ok(process.argv.length === 4 && process.argv[2] === '--out', 'Usage: node scripts/cloudflare/d1-backup.mjs --out <dir>');
    const manifest = await runBackup({ outDir: process.argv[3] });
    console.log(`Backup complete: ${manifest.databases.length} encrypted exports`);
  } catch (error) {
    console.error(`Backup failed: ${error.message}`);
    process.exitCode = 1;
  }
}
