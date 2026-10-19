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
};
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

