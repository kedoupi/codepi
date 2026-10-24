import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  decrypt,
  encrypt,
  exportDatabase,
  keyId,
  runBackup,
  DATABASES,
  DATABASE_NAMES,
  PUBLIC_KEY_PATH,
} from './d1-backup.mjs';
import { parseRegistry } from './validate-governance.mjs';

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
test('rejects oversized exports before writing ciphertext or manifest', async t => {
  const cases = [
    {
      name: 'content-length',
      response: new Response('too large', { headers: { 'content-length': '11' } }),
    },
    {
      name: 'stream',
      response: new Response(new ReadableStream({
        start(controller) {
          controller.enqueue(new Uint8Array(7));
          controller.enqueue(new Uint8Array(5));
          controller.close();
        },
      })),
    },
  ];
  for (const scenario of cases) {
    const dir = await mkdtemp(path.join(os.tmpdir(), `codepi-backup-limit-${scenario.name}-`));
    t.after(() => rm(dir, { recursive: true, force: true }));
    await assert.rejects(runBackup({
      outDir: dir,
      publicKey: keys.publicKey,
      maxExportBytes: 10,
      env: { CLOUDFLARE_ACCOUNT_ID: 'acct', CLOUDFLARE_API_TOKEN: 'synthetic' },
      databases: { synthetic: 'db' },
      request: async url => url.includes('api.cloudflare.com')
        ? ok({ success: true, status: 'complete', result: { signed_url: 'https://export.r2.cloudflarestorage.com/sql' } })
        : scenario.response,
    }), /size limit|too large|exceeds/i);
    assert.deepEqual(await readdir(dir), [], `${scenario.name} must not leave backup files`);
  }
});


test('manual backup defaults to the full dynamic D1 inventory instead of silently keeping the legacy six', async t => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'codepi-backup-inventory-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const resolved = DATABASE_NAMES.map((name, i) => ({
    name,
    id: DATABASES[name] ?? `99999999-9999-4999-8999-${String(i + 1).padStart(12, '0')}`,
  }));
  let resolutions = 0;
  const manifest = await runBackup({
    outDir: dir,
    publicKey: keys.publicKey,
    env: { CLOUDFLARE_ACCOUNT_ID: 'acct', CLOUDFLARE_API_TOKEN: 'synthetic' },
    resolveDatabases: async () => { resolutions++; return resolved; },
    request: async url => url.includes('api.cloudflare.com')
      ? ok({ success: true, status: 'complete', result: { signed_url: 'https://export.r2.cloudflarestorage.com/sql' } })
      : new Response('CREATE TABLE synthetic(id);'),
  });
  assert.equal(resolutions, 1);
  assert.deepEqual(manifest.databases.map(entry => entry.database), [...DATABASE_NAMES]);
  assert.equal(manifest.databases.length, 9);
});

test('every production D1 is covered, including planned Project, Me and MCP bindings', async () => {
  const configs = { 'codepi-auth': 'services/auth/wrangler.jsonc', 'codepi-desk': 'apps/web/wrangler.toml',
    'codepi-blog': 'apps/web/wrangler.toml', 'codepi-gu': 'apps/gu/wrangler.toml', 'codepi-gzh': 'apps/gzh/wrangler.toml',
    'codepi-health': 'apps/health/workers/api/wrangler.toml', 'codepi-mcp': 'services/mcp/wrangler.toml',
    'codepi-project': 'apps/project/wrangler.toml', 'codepi-me': 'apps/me/wrangler.toml' };
  assert.deepEqual([...DATABASE_NAMES].sort(), Object.keys(configs).sort());
  const registry = parseRegistry(await readFile(new URL('../../docs/development/cloudflare-resource-registry.md', import.meta.url), 'utf8'));
  const managed = registry.filter(row => row.environment === 'production' && row.resource_type === 'd1' && row.status === 'managed');
  const runtimeResolved = new Set(['codepi-mcp', 'codepi-project', 'codepi-me']);
  for (const [name, file] of Object.entries(configs)) {
    const config = await readFile(new URL('../../' + file, import.meta.url), 'utf8');
    assert.match(config, new RegExp(`database_name["']?\\s*[:=]\\s*"${name}"`), `${name} binding must be present`);
    if (DATABASES[name]) {
      assert.ok(managed.some(row => row.physical_name === `${name} (${DATABASES[name]})`), `${name} UUID must match the registry`);
    }
    if (runtimeResolved.has(name)) {
      assert.ok(!/database_id\s*=/.test(config) || /database_id\s*=\s*"REPLACE_WITH_[A-Z0-9_]+"/.test(config),
        `${name} resolves its ID at release time`);
    } else {
      assert.ok(config.includes(DATABASES[name]), `${name} must match its deployed binding`);
    }
  }
});

test('the checked-in recipient contains public key material only', async () => {
  const publicKey = await readFile(PUBLIC_KEY_PATH, 'utf8');
  assert.match(publicKey, /^-----BEGIN PUBLIC KEY-----\n/);
  assert.doesNotMatch(publicKey, /PRIVATE KEY/);
  assert.match(keyId(publicKey), /^[a-f0-9]{64}$/);
});
