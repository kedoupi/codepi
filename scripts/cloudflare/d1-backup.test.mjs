import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { decrypt, encrypt, exportDatabase, keyId, runBackup, DATABASES, PUBLIC_KEY_PATH } from './d1-backup.mjs';

const pair = () => generateKeyPairSync('rsa', { modulusLength: 3072,
  publicKeyEncoding: { type: 'spki', format: 'pem' }, privateKeyEncoding: { type: 'pkcs8', format: 'pem' } });
const keys = pair();
const ok = result => Response.json({ success: true, result });

test('public recipient round-trips compressed SQL and authenticates metadata', () => {
  const sql = Buffer.from('CREATE TABLE sample(id INTEGER);\n'.repeat(1000));
  const metadata = { database: 'synthetic', created_at: '2026-10-18T00:00:00Z' };
  const encrypted = encrypt(sql, keys.publicKey, metadata);
  assert.ok(encrypted.length < sql.length, 'compress before encryption');
  assert.deepEqual(decrypt(encrypted, keys.privateKey), { sql, metadata });
  assert.notDeepEqual(encrypt(sql, keys.publicKey), encrypt(sql, keys.publicKey), 'fresh AES key and IV per export');
  const tampered = Buffer.from(encrypted);
  tampered[tampered.length - 1] ^= 1;
  assert.throws(() => decrypt(tampered, keys.privateKey));
  const headerTampered = Buffer.from(encrypted);
  headerTampered[headerTampered.indexOf('synthetic')] = 'x'.charCodeAt(0);
  assert.throws(() => decrypt(headerTampered, keys.privateKey), /auth|authenticate/i);
  assert.throws(() => decrypt(encrypted, pair().privateKey), /does not match/);
  assert.throws(() => decrypt(Buffer.from('truncated'), keys.privateKey), /envelope/);
});

test('export polls current bookmarks, supports immediate completion, and never logs signed URLs', async () => {
  const url = 'https://export.r2.cloudflarestorage.com/file?signature=not-for-logs';
  const replies = [
    { success: true, status: 'active', at_bookmark: 'a' },
    { success: true, status: 'active', at_bookmark: 'b' },
    { success: true, status: 'complete', result: { signed_url: url } },
  ];
  const calls = [];
  const options = { accountId: 'acct', token: 'synthetic', wait: async () => {},
    request: async (_url, init) => { calls.push(JSON.parse(init.body)); return ok(replies.shift()); } };
  assert.equal(await exportDatabase('db', options), url);
  assert.deepEqual(calls.map(body => body.current_bookmark), [undefined, 'a', 'b']);
  assert.equal(await exportDatabase('db', { ...options,
    request: async () => ok({ success: true, status: 'complete', result: { signed_url: url } }) }), url);
  await assert.rejects(exportDatabase('db', { ...options,
    request: async () => ok({ success: false, error: url }) }), error => !error.message.includes(url));
  await assert.rejects(exportDatabase('db', { ...options, timeoutMs: -1,
    request: async () => ok({ status: 'active', at_bookmark: 'a' }) }), /timed out/);
});

test('backup writes only encrypted files and a portable manifest; refuses missing credentials', async t => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'codepi-backup-test-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const sql = Buffer.from('CREATE TABLE sample(id); INSERT INTO sample VALUES(42);');
  const manifest = await runBackup({ outDir: dir, publicKey: keys.publicKey,
    env: { CLOUDFLARE_ACCOUNT_ID: 'acct', CLOUDFLARE_API_TOKEN: 'synthetic' },
    databases: { synthetic: 'db' }, request: async url => url.includes('api.cloudflare.com')
      ? ok({ success: true, status: 'complete', result: { signed_url: 'https://export.r2.cloudflarestorage.com/sql' } })
      : new Response(sql) });
  assert.deepEqual((await readdir(dir)).sort(), ['manifest.json', 'synthetic.sql.enc']);
  const encrypted = await readFile(path.join(dir, manifest.databases[0].file));
  assert.deepEqual(decrypt(encrypted, keys.privateKey).sql, sql);
  assert.equal(manifest.databases[0].file, 'synthetic.sql.enc');
  await assert.rejects(runBackup({ outDir: dir, env: {} }), /credentials/);
});

test('all five database IDs match the actual Wrangler bindings', async () => {
  const configs = { 'codepi-auth': 'services/auth/wrangler.jsonc', 'codepi-desk': 'apps/web/wrangler.toml',
    'codepi-gu': 'apps/gu/wrangler.toml', 'codepi-gzh': 'apps/gzh/wrangler.toml',
    'codepi-health': 'apps/health/workers/api/wrangler.toml' };
  assert.deepEqual(Object.keys(DATABASES).sort(), Object.keys(configs).sort());
  for (const [name, file] of Object.entries(configs)) {
    const config = await readFile(new URL('../../' + file, import.meta.url), 'utf8');
    assert.ok(config.includes(DATABASES[name]), `${name} must match its deployed binding`);
  }
});

test('the checked-in recipient contains public key material only', async () => {
  const publicKey = await readFile(PUBLIC_KEY_PATH, 'utf8');
  assert.match(publicKey, /^-----BEGIN PUBLIC KEY-----\n/);
  assert.doesNotMatch(publicKey, /PRIVATE KEY/);
  assert.match(keyId(publicKey), /^[a-f0-9]{64}$/);
});
