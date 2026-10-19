import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { createHash } from 'node:crypto';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { createGzip } from 'node:zlib';
import { createEnvelope, downloadExport, keyId } from '../../../scripts/cloudflare/backup-core.mjs';

export const PART_BYTES = 5 * 1024 * 1024;
const MAX_EXPORT_BYTES = 1024 * 1024 * 1024;
const receiptKey = key => `${key}.receipt.json`;

export async function objectDigest(object) {
  assert.ok(object?.body, 'backup ciphertext is missing');
  const hash = createHash('sha256');
  const reader = object.body.getReader();
  let size = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      assert.ok(size <= object.size, 'backup ciphertext size changed');
      hash.update(value);
    }
    assert.equal(size, object.size, 'backup ciphertext was truncated');
    return hash.digest('hex');
  } finally {
    await reader.cancel().catch(() => {});
  }
}

export async function verifyBackupObject(bucket, key, entry, recipient) {
  const object = await bucket.head(key);
  const receipt = await bucket.get(receiptKey(key));
  assert.ok(object && receipt && receipt.size <= 4096, 'completed backup ciphertext or receipt is missing or changed');
  const saved = await receipt.json();
  const identity = JSON.stringify({
    database: entry.database, database_id: entry.database_id, created_at: entry.created_at,
  });
  assert.ok(object.size === entry.bytes && object.customMetadata?.key_id === recipient
    && object.customMetadata?.identity === identity && saved.etag === object.etag
    && JSON.stringify(saved.entry) === JSON.stringify(entry),
  'completed backup ciphertext or receipt is missing or changed');
  return object;
}

export async function backupDatabase(name, databaseId, publicKey, createdAt, options) {
  const { bucket, key } = options;
  const metadata = { database: name, database_id: databaseId, created_at: createdAt };
  const recipient = keyId(publicKey);
  const identity = JSON.stringify(metadata);
  const objectOptions = {
    httpMetadata: { contentType: 'application/octet-stream' },
    customMetadata: { identity, key_id: recipient },
  };
  const saveReceipt = async object => {
    assert.ok(object?.customMetadata?.identity === identity && object.customMetadata?.key_id === recipient,
      'existing backup object has invalid metadata');
    const entry = { ...metadata, file: `${name}.sql.enc`, bytes: object.size, sha256: await objectDigest(object) };
    await bucket.put(receiptKey(key), JSON.stringify({ etag: object.etag, entry }),
      { httpMetadata: { contentType: 'application/json' } });
    return entry;
  };
  const existing = await bucket.head(key);
  if (existing) {
    const receipt = await bucket.get(receiptKey(key));
    if (receipt) {
      assert.ok(receipt.size <= 4096, 'backup receipt is too large');
      const { entry } = await receipt.json();
      assert.ok(entry?.database === name && entry.database_id === databaseId && entry.created_at === createdAt
        && entry.file === `${name}.sql.enc` && /^[a-f0-9]{64}$/.test(entry.sha256),
      'existing backup receipt has invalid metadata');
      await verifyBackupObject(bucket, key, entry, recipient);
      return entry;
    }
    // CompleteMultipartUpload may succeed just before a Workflow interruption.
    // Re-hash the committed ciphertext; never re-export or replace that snapshot.
    return saveReceipt(await bucket.get(key));
  }
  assert.equal(await bucket.head(receiptKey(key)), null, 'backup ciphertext expired; start a new instance');

  const body = await downloadExport(databaseId, options);
  const { cipher, prefix } = createEnvelope(publicKey, metadata);
  let inputBytes = 0;
  const bounded = new Transform({
    transform(chunk, _encoding, done) {
      inputBytes += chunk.byteLength;
      if (inputBytes > (options.maxBytes ?? MAX_EXPORT_BYTES)) {
        done(new Error('D1 export exceeds the streaming size limit'));
      } else done(null, chunk);
    },
  });
  const compressed = createGzip();
  const transfer = new AbortController();
  const pumping = Promise.allSettled([pipeline(Readable.fromWeb(body), bounded, compressed,
    { signal: transfer.signal })]);
  const reader = compressed[Symbol.asyncIterator]();
  // Keep part 1 for the final authentication tag and one outgoing part only.
  const first = Buffer.alloc(PART_BYTES);
  prefix.copy(first);
  let part = first, used = prefix.length, number = 1, upload;
  const parts = [];
  const append = async bytes => {
    let offset = 0;
    while (offset < bytes.length) {
      const count = Math.min(PART_BYTES - used, bytes.length - offset);
      part.set(bytes.subarray(offset, offset + count), used);
      offset += count;
      used += count;
      if (used === PART_BYTES) {
        if (number === 1) upload = await bucket.createMultipartUpload(key, objectOptions);
        else parts.push(await upload.uploadPart(number, part));
        number++;
        part = Buffer.alloc(PART_BYTES);
        used = 0;
      }
    }
  };
  try {
    for (;;) {
      let chunk;
      try { chunk = await reader.next(); }
      catch { throw new Error('D1 export stream failed or exceeded the streaming size limit'); }
      if (chunk.done) break;
      await append(cipher.update(chunk.value));
    }
    assert.ok(inputBytes > 0, 'D1 export is empty');
    await append(cipher.final());
    cipher.getAuthTag().copy(first, prefix.length - 16);
    if (upload) {
      if (used) parts.push(await upload.uploadPart(number, part.subarray(0, used)));
      const firstPart = await upload.uploadPart(1, first);
      await upload.complete([firstPart, ...parts]);
    } else {
      await bucket.put(key, first.subarray(0, used), objectOptions);
    }
  } catch (error) {
    if (upload) await upload.abort().catch(() => {});
    throw error;
  } finally {
    transfer.abort(new Error('backup stream closed'));
    await reader.return().catch(() => {});
    await pumping;
  }
  // The v1 tag is at the front, so compute the file hash in a bounded second
  // pass. A small separate receipt links the digest to the exact R2 object.
  return saveReceipt(await bucket.get(key));
}
