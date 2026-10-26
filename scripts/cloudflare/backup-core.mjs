import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { constants, createCipheriv, createDecipheriv, createHash, createPublicKey,
  privateDecrypt, publicEncrypt, randomBytes } from 'node:crypto';
import { gzipSync, gunzipSync } from 'node:zlib';

export const DATABASES = {
  'codepi-auth': 'ecc90eed-e9ff-459d-99aa-4e7f4c6d6ef1',
  'codepi-desk': 'adfb0f6e-b776-471b-9f25-71982b53cbc4',
  'codepi-gu': '4d3b6713-85dd-4f61-ac55-9925db72394b',
  'codepi-gzh': 'acedb64c-d374-4e40-b61e-7df7f0766694',
  'codepi-health': '2e35deaa-8066-49c1-b19a-afcd8706d58c',
  'codepi-mcp': '73c6ef4e-e2a0-41c2-9bce-ab41c7391caa',
  'codepi-blog': '22e27bb5-230a-4b89-b969-3dc29c8a1d22',
};
// Project and Me are resolved by exact name at release time; existing IDs remain pinned.
export const DATABASE_NAMES = Object.freeze([
  ...Object.keys(DATABASES),
  'codepi-project',
  'codepi-me',
]);
export const ORIGINAL_COLLECTIONS = Object.freeze([
  {
    source: 'codepi-gu', binding: 'GU', kind: 'gu-material', database: 'codepi-gu',
    table: 'gu_materials', key_column: 'object_key', size_column: 'size', key_prefix: 'materials',
    id_pattern: '^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$',
  },
  {
    source: 'codepi-me', binding: 'ME', kind: 'me-import', database: 'codepi-me',
    table: 'imports', key_column: 'r2_key', size_column: 'bytes', key_prefix: 'imports',
    id_pattern: '^[0-9A-HJKMNP-TV-Z]{26}$',
  },
  {
    source: 'codepi-blog', binding: 'BLOG', kind: 'blog-media', database: 'codepi-blog',
    table: 'blog_media', key_column: 'object_key', size_column: 'bytes', key_prefix: 'media',
    id_pattern: '^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$',
  },
]);

export function originalCollection(source) {
  const collection = ORIGINAL_COLLECTIONS.find(item => item.source === source);
  assert.ok(collection, `unknown original collection ${source}`);
  return collection;
}

export function validOriginalId(collection, id) {
  return typeof id === 'string' && new RegExp(collection.id_pattern).test(id);
}

export function validOriginalObjectKey(collection, id, objectKey) {
  return validOriginalId(collection, id)
    && objectKey === `${collection.key_prefix}/${id}`;
}

export function originalFileName(collection, id) {
  assert.ok(validOriginalId(collection, id), `invalid ${collection.source} original ID`);
  return `${collection.kind}-${id}.bin.enc`;
}

export function requireDatabaseManifest(entries, { legacy = false } = {}) {
  const expected = legacy ? Object.keys(DATABASES) : [...DATABASE_NAMES];
  assert.ok(Array.isArray(entries) && entries.length === expected.length,
    'backup manifest database coverage is incomplete');
  const names = new Set();
  for (const entry of entries) {
    const name = entry?.database;
    assert.ok(expected.includes(name) && !names.has(name), 'backup manifest has an invalid or duplicate database');
    const id = validateDatabaseId(entry.database_id, name);
    if (DATABASES[name]) assert.equal(id, DATABASES[name], `${name} UUID differs from the managed production ID`);
    assert.equal(entry.file, `${name}.sql.enc`, 'invalid database backup filename');
    names.add(name);
  }
  assert.deepEqual([...names].sort(), [...expected].sort(),
    'backup manifest database coverage is incomplete');
  return entries;
}
const MAGIC = Buffer.from('KDPB001\n');

export function keyId(publicKey) {
  const key = createPublicKey(publicKey);
  assert.equal(key.asymmetricKeyType, 'rsa', 'backup recipient must be an RSA public key');
  assert.ok(key.asymmetricKeyDetails.modulusLength >= 3072, 'backup RSA key must be at least 3072 bits');
  return createHash('sha256').update(key.export({ type: 'spki', format: 'der' })).digest('hex');
}

// The tag precedes ciphertext in KDPB001. Streaming writers retain the first
// multipart part until finalization so old recovery tools can read new backups.
export function createEnvelope(publicKey, metadata = {}) {
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
  key.fill(0);
  const size = Buffer.alloc(4);
  size.writeUInt32BE(header.length);
  return { cipher, prefix: Buffer.concat([MAGIC, size, header, Buffer.alloc(16)]) };
}

export function encrypt(sql, publicKey, metadata = {}) {
  const { cipher, prefix } = createEnvelope(publicKey, metadata);
  const ciphertext = Buffer.concat([cipher.update(gzipSync(sql)), cipher.final()]);
  cipher.getAuthTag().copy(prefix, prefix.length - 16);
  return Buffer.concat([prefix, ciphertext]);
}

export function decrypt(payload, privateKey, { maxBytes } = {}) {
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
  return { sql: gunzipSync(compressed, maxBytes === undefined ? {} : { maxOutputLength: maxBytes }), metadata: info.metadata };
}

export async function cloudflareApi(endpoint, body, { accountId, token, request = fetch }) {
  assert.ok(accountId && token, 'CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN are required');
  let response, data;
  try {
    response = await request(`https://api.cloudflare.com/client/v4/accounts/${accountId}${endpoint}`, {
      method: 'POST', redirect: 'manual', signal: AbortSignal.timeout(30000),
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    data = await response.json();
  } catch { throw new Error('Cloudflare backup API failed (network or invalid JSON)'); }
  // Provider error text can contain SQL, URLs or tokens; log only status/codes.
  assert.ok(response.ok && data.success, `Cloudflare request failed: HTTP ${response.status}; codes=${(data.errors || []).map(e => e.code).join(',')}`);
  return data.result;
}

async function cloudflareGet(endpoint, { accountId, token, request = fetch }) {
  assert.ok(accountId && token, 'CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN are required');
  let response, data;
  try {
    response = await request(`https://api.cloudflare.com/client/v4/accounts/${accountId}${endpoint}`, {
      method: 'GET', redirect: 'manual', signal: AbortSignal.timeout(30000),
      headers: { authorization: `Bearer ${token}` },
    });
    data = await response.json();
  } catch { throw new Error('Cloudflare D1 inventory failed (network or invalid JSON)'); }
  assert.ok(response.ok && data.success,
    `Cloudflare D1 inventory failed: HTTP ${response.status}; codes=${(data.errors || []).map(e => e.code).join(',')}`);
  return data;
}

function validateDatabaseId(value, label) {
  assert.match(value ?? '', /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i,
    `${label} has an invalid D1 UUID`);
  return value;
}

export function parseDatabaseConfig(value) {
  let mapping = value;
  if (typeof value === 'string') {
    try { mapping = JSON.parse(value); }
    catch { throw new Error('D1_DATABASE_IDS must be valid JSON'); }
  }
  assert.ok(mapping && typeof mapping === 'object' && !Array.isArray(mapping),
    'D1_DATABASE_IDS must map every required database name to its D1 UUID');
  const actual = Object.keys(mapping).sort();
  const expected = [...DATABASE_NAMES].sort();
  assert.deepEqual(actual, expected, 'D1_DATABASE_IDS must contain every required database name and no others');
  const seen = new Set();
  return DATABASE_NAMES.map(name => {
    const id = validateDatabaseId(mapping[name], name);
    assert.ok(!seen.has(id), 'D1_DATABASE_IDS contains a duplicate UUID');
    seen.add(id);
    if (DATABASES[name]) assert.equal(id, DATABASES[name], `${name} UUID differs from the managed production ID`);
    return { name, id };
  });
}

export async function resolveProductionDatabases({ accountId, token, request = fetch, explicit } = {}) {
  if (explicit) {
    const databases = parseDatabaseConfig(explicit);
    assert.equal(databases.length, DATABASE_NAMES.length, 'explicit D1 inventory is incomplete');
    return databases;
  }
  assert.ok(accountId && token, 'CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN are required to resolve D1 names');
  const discovered = [];
  let expectedPages;
  for (let page = 1; page <= 20; page++) {
    const data = await cloudflareGet(`/d1/database?page=${page}&per_page=100`,
      { accountId, token, request });
    assert.ok(Array.isArray(data.result), 'Cloudflare D1 inventory returned an unexpected payload');
    discovered.push(...data.result);
    const totalPages = data.result_info?.total_pages;
    if (totalPages !== undefined) {
      assert.ok(Number.isSafeInteger(totalPages) && totalPages >= 1, 'Cloudflare D1 pagination is invalid');
      expectedPages ??= totalPages;
      assert.equal(totalPages, expectedPages, 'Cloudflare D1 inventory changed during pagination');
      if (page === totalPages) break;
    } else if (data.result.length < 100) break;
    assert.ok(page < 20, 'Cloudflare D1 inventory exceeds the pagination limit');
  }
  assert.ok(discovered.length > 0, 'Cloudflare D1 inventory is empty');
  const databases = DATABASE_NAMES.map(name => {
    const matches = discovered.filter(database => database?.name === name);
    assert.equal(matches.length, 1, `required D1 ${name} was not resolved to exactly one exact-name database`);
    const id = validateDatabaseId(matches[0].uuid, name);
    if (DATABASES[name]) assert.equal(id, DATABASES[name], `${name} UUID differs from the managed production ID`);
    return { name, id };
  });
  assert.equal(new Set(databases.map(database => database.id)).size, databases.length,
    'D1 inventory resolved multiple required names to the same UUID');
  return databases;
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

export async function downloadExport(databaseId, options) {
  const url = new URL(await exportDatabase(databaseId, options));
  assert.ok(url.protocol === 'https:' && url.hostname.endsWith('.r2.cloudflarestorage.com'),
    'export download URL must be a Cloudflare HTTPS object');
  let response;
  try {
    response = await (options.request ?? fetch)(url.href, {
      redirect: 'manual', signal: AbortSignal.timeout(120000),
    });
  } catch { throw new Error('D1 export download failed (network)'); }
  if (!response.ok || !response.body) {
    await response.body?.cancel().catch(() => {});
    throw new Error(`export download failed: HTTP ${response.status}`);
  }
  return response.body;
}

