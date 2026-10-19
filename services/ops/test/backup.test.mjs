import assert from 'node:assert/strict';
import { createHash, generateKeyPairSync, randomBytes } from 'node:crypto';
import test from 'node:test';
import { decrypt, keyId } from '../../../scripts/cloudflare/backup-core.mjs';
import { backupDatabase, PART_BYTES, verifyBackupObject } from '../src/backup.mjs';
import { bucketFixture, exportRequest } from './fixtures.mjs';

const keys = generateKeyPairSync('rsa', { modulusLength: 3072,
  publicKeyEncoding: { type: 'spki', format: 'pem' }, privateKeyEncoding: { type: 'pkcs8', format: 'pem' } });
const key = 'backups/synthetic/codepi-health.sql.enc';
const args = ['codepi-health', 'synthetic-db', keys.publicKey, '2026-10-19T00:00:00Z'];

function syntheticSql(rows = 640) {
  const hash = createHash('sha256');
  let produced = 0, bytes = 0, cancelled = false;
  return {
    get bytes() { return bytes; },
    get cancelled() { return cancelled; },
    digest: () => hash.digest('hex'),
    body: new ReadableStream({
      pull(controller) {
        if (produced++ > rows) return controller.close();
        const chunk = Buffer.from(produced === 1 ? 'CREATE TABLE synthetic(value TEXT);\n'
          : `INSERT INTO synthetic VALUES('${randomBytes(32768).toString('hex')}');\n`);
        bytes += chunk.length;
        hash.update(chunk);
        controller.enqueue(chunk);
      },
      cancel() { cancelled = true; },
    }, { highWaterMark: 0 }),
  };
}

test('large incompressible SQL is streamed into bounded multipart pieces, keeping the v1 recovery format', async () => {
  const sql = syntheticSql(), bucket = bucketFixture();
  const entry = await backupDatabase(...args, {
    bucket, key, accountId: 'acct', token: 'synthetic', request: exportRequest(() => sql.body),
  });
  assert.ok(sql.bytes > 40 * 1024 * 1024);
  const encrypted = bucket.data.get(key).bytes;
  assert.ok(encrypted.length > 16 * 1024 * 1024, 'test must also exceed the old cap after compression');
  assert.equal(encrypted.subarray(0, 8).toString(), 'KDPB001\n');
  assert.equal(entry.bytes, encrypted.length);
  assert.equal(entry.sha256, createHash('sha256').update(encrypted).digest('hex'));
  const recovered = decrypt(encrypted, keys.privateKey);
  assert.equal(createHash('sha256').update(recovered.sql).digest('hex'), sql.digest());
  assert.equal(recovered.metadata.database_id, 'synthetic-db');
  const parts = bucket.events.filter(e => e.type === 'part');
  assert.ok(parts.length > 3);
  assert.ok(parts.every(p => p.size <= PART_BYTES));
  assert.equal(parts.at(-1).number, 1, 'first part waits for the final authentication tag');
  await verifyBackupObject(bucket, key, entry, keyId(keys.publicKey));
  const tampered = Buffer.from(encrypted);
  tampered[tampered.length - 1] ^= 1;
  assert.throws(() => decrypt(tampered, keys.privateKey), /auth|authenticate/i);
});

test('a committed upload survives an interruption before its digest receipt without re-exporting', async () => {
  const bucket = bucketFixture(), put = bucket.put.bind(bucket);
  bucket.put = async (target, ...rest) => {
    if (target.endsWith('.receipt.json')) throw new Error('synthetic interrupted receipt');
    return put(target, ...rest);
  };
  await assert.rejects(backupDatabase(...args, { bucket, key, accountId: 'acct', token: 'synthetic',
    request: exportRequest(() => 'CREATE TABLE synthetic(id);') }), /interrupted receipt/);
  const ciphertext = bucket.data.get(key);
  bucket.put = put;
  const options = { bucket, key, request: () => { throw new Error('must not export again'); } };
  const entry = await backupDatabase(...args, options);
  assert.equal(bucket.data.get(key), ciphertext);
  assert.deepEqual(await backupDatabase(...args, options), entry);
  await verifyBackupObject(bucket, key, entry, keyId(keys.publicKey));
  bucket.data.get(key).etag = 'changed';
  await assert.rejects(backupDatabase(...args, options), /missing or changed/);
});

test('failed multipart uploads abort and cancel the source; no receipt or committed object is created', async () => {
  const bucket = bucketFixture(), create = bucket.createMultipartUpload.bind(bucket), sql = syntheticSql();
  bucket.createMultipartUpload = async (...args) => {
    const upload = await create(...args);
    upload.uploadPart = async () => { throw new Error('synthetic R2 failure'); };
    return upload;
  };
  await assert.rejects(backupDatabase(...args, { bucket, key, accountId: 'acct', token: 'synthetic',
    request: exportRequest(() => sql.body) }), /synthetic R2 failure/);
  assert.equal(bucket.uploads.length, 1);
  assert.equal(bucket.uploads[0].aborted, true);
  assert.equal(sql.cancelled, true);
  assert.equal(bucket.data.has(key), false);
  assert.equal(bucket.data.has(`${key}.receipt.json`), false);
  assert.ok(sql.bytes < 40 * 1024 * 1024, 'backpressure stops reading after upload failure');
});

test('incomplete streams, redirects and empty exports cannot become successful ciphertext', async () => {
  for (const scenario of ['stream', 'redirect', 'empty']) {
    const bucket = bucketFixture();
    const normal = exportRequest(() => scenario === 'stream' ? new ReadableStream({
      pull(controller) { controller.error(new Error('PRIVATE SQL SECRET signed_url')); },
    }) : '');
    const request = async (url, init) => scenario === 'redirect' && !url.includes('api.cloudflare.com')
      ? new Response('SECRET', { status: 302, headers: { location: 'https://wrong.invalid/SECRET' } })
      : normal(url, init);
    await assert.rejects(backupDatabase(...args, { bucket, key, accountId: 'acct', token: 'synthetic', request }),
      error => !/SECRET|PRIVATE SQL|signed_url/.test(error.message));
    assert.equal(bucket.data.size, 0);
  }
});

test('expired ciphertext with a surviving receipt cannot be replaced under the same snapshot', async () => {
  const bucket = bucketFixture();
  await backupDatabase(...args, { bucket, key, accountId: 'acct', token: 'synthetic',
    request: exportRequest(() => 'CREATE TABLE synthetic(id);') });
  bucket.data.delete(key);
  await assert.rejects(backupDatabase(...args, { bucket, key }), /expired/);
});
