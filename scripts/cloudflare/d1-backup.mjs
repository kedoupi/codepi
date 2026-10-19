import assert from 'node:assert/strict';
import { constants, createCipheriv, createDecipheriv, createHash, createPublicKey,
  privateDecrypt, publicEncrypt, randomBytes } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { gzipSync, gunzipSync } from 'node:zlib';

export const DATABASES = {
  'codepi-auth': 'ecc90eed-e9ff-459d-99aa-4e7f4c6d6ef1',
  'codepi-desk': 'adfb0f6e-b776-471b-9f25-71982b53cbc4',
  'codepi-gu': '4d3b6713-85dd-4f61-ac55-9925db72394b',
  'codepi-gzh': 'acedb64c-d374-4e40-b61e-7df7f0766694',
  'codepi-health': '2e35deaa-8066-49c1-b19a-afcd8706d58c',
  'codepi-mcp': '73c6ef4e-e2a0-41c2-9bce-ab41c7391caa',
};
export const PUBLIC_KEY_PATH = fileURLToPath(new URL('./backup-public-key.pem', import.meta.url));
const MAGIC = Buffer.from('KDPB001\n');

export function keyId(publicKey) {
  const key = createPublicKey(publicKey);
  assert.equal(key.asymmetricKeyType, 'rsa', 'backup recipient must be an RSA public key');
  assert.ok(key.asymmetricKeyDetails.modulusLength >= 3072, 'backup RSA key must be at least 3072 bits');
  return createHash('sha256').update(key.export({ type: 'spki', format: 'der' })).digest('hex');
}

// CI receives only the public recipient. Each export uses a fresh AES key,
// wrapped with RSA-OAEP; all envelope metadata is authenticated as GCM AAD.
export function encrypt(sql, publicKey, metadata = {}) {
  const key = randomBytes(32);
  const iv = randomBytes(12);
  const header = Buffer.from(JSON.stringify({
    version: 1, cipher: 'aes-256-gcm', compression: 'gzip', key_id: keyId(publicKey),
    wrapped_key: publicEncrypt({ key: publicKey, padding: constants.RSA_PKCS1_OAEP_PADDING,
      oaepHash: 'sha256' }, key).toString('base64'),
    iv: iv.toString('base64'), metadata,
  }));
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(header);
  const ciphertext = Buffer.concat([cipher.update(gzipSync(sql)), cipher.final()]);
  const size = Buffer.alloc(4);
  size.writeUInt32BE(header.length);
  return Buffer.concat([MAGIC, size, header, cipher.getAuthTag(), ciphertext]);
}

export function decrypt(payload, privateKey) {
  assert.ok(payload.length > 28 && payload.subarray(0, 8).equals(MAGIC), 'unsupported backup envelope');
  const size = payload.readUInt32BE(8);
  assert.ok(size > 0 && size <= 4096 && payload.length > 12 + size + 16, 'invalid backup header');
  const header = payload.subarray(12, 12 + size);
  const info = JSON.parse(header);
  assert.ok(info.version === 1 && info.cipher === 'aes-256-gcm' && info.compression === 'gzip',
    'unsupported backup format');
  assert.equal(info.key_id, keyId(privateKey), 'recovery key does not match this backup');
  const key = privateDecrypt({ key: privateKey, padding: constants.RSA_PKCS1_OAEP_PADDING,
    oaepHash: 'sha256' }, Buffer.from(info.wrapped_key, 'base64'));
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(info.iv, 'base64'));
  decipher.setAAD(header);
  decipher.setAuthTag(payload.subarray(12 + size, 28 + size));
  const compressed = Buffer.concat([decipher.update(payload.subarray(28 + size)), decipher.final()]);
  return { sql: gunzipSync(compressed), metadata: info.metadata };
}

export async function cloudflareApi(endpoint, body, { accountId, token, request = fetch }) {
  assert.ok(accountId && token, 'CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN are required');
  const response = await request(`https://api.cloudflare.com/client/v4/accounts/${accountId}${endpoint}`, {
    method: 'POST', signal: AbortSignal.timeout(30000),
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await response.json();
  // Provider error text can contain SQL, URLs or tokens; log only status/codes.
  assert.ok(response.ok && data.success, `Cloudflare request failed: HTTP ${response.status}; codes=${(data.errors || []).map(e => e.code).join(',')}`);
  return data.result;
}

export async function exportDatabase(databaseId, options) {
  const wait = options.wait ?? (ms => new Promise(resolve => setTimeout(resolve, ms)));
  const now = options.now ?? Date.now;
  const deadline = now() + (options.timeoutMs ?? 600000);
  let status = await cloudflareApi(`/d1/database/${databaseId}/export`, { output_format: 'polling' }, options);
  for (;;) {
    assert.notEqual(status.success, false, 'D1 export failed');
    if (status.status === 'complete') {
      assert.ok(status.result?.signed_url, 'completed D1 export has no download URL');
      return status.result.signed_url;
    }
    assert.equal(status.status, 'active', 'unexpected D1 export state');
    assert.ok(status.at_bookmark, 'active D1 export has no bookmark');
    assert.ok(now() < deadline, 'D1 export timed out');
    await wait(4000);
    status = await cloudflareApi(`/d1/database/${databaseId}/export`, {
      output_format: 'polling', current_bookmark: status.at_bookmark,
    }, options);
  }
}

export async function runBackup({ outDir, publicKey, env = process.env, request = fetch,
  databases = DATABASES, now = new Date(), wait, timeoutMs } = {}) {
  const accountId = env.CLOUDFLARE_ACCOUNT_ID;
  const token = env.CLOUDFLARE_API_TOKEN;
  assert.ok(accountId && token && outDir, 'Cloudflare credentials and --out <dir> are required');
  publicKey ??= await readFile(PUBLIC_KEY_PATH, 'utf8');
  const recipient = keyId(publicKey);
  await mkdir(outDir, { recursive: true, mode: 0o700 });
  const manifest = { version: 1, created_at: now.toISOString(), key_id: recipient, databases: [] };
  for (const [name, databaseId] of Object.entries(databases)) {
    const url = await exportDatabase(databaseId, { accountId, token, request, wait, timeoutMs });
    const parsed = new URL(url);
    assert.ok(parsed.protocol === 'https:' && parsed.hostname.endsWith('.r2.cloudflarestorage.com'),
      'export download URL must be a Cloudflare HTTPS object');
    const response = await request(url, { signal: AbortSignal.timeout(120000) });
    assert.ok(response.ok, `export download failed: HTTP ${response.status}`);
    const sql = Buffer.from(await response.arrayBuffer());
    assert.ok(sql.length > 0, 'D1 export is empty');
    const metadata = { database: name, database_id: databaseId, created_at: manifest.created_at };
    const encrypted = encrypt(sql, publicKey, metadata);
    const file = `${name}.sql.enc`;
    await writeFile(path.join(outDir, file), encrypted, { mode: 0o600, flag: 'wx' });
    manifest.databases.push({ ...metadata, file, bytes: encrypted.length,
      sha256: createHash('sha256').update(encrypted).digest('hex') });
    console.log(`PASS encrypted backup: ${name}`);
  }
  await writeFile(path.join(outDir, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n',
    { mode: 0o600, flag: 'wx' });
  return manifest;
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
