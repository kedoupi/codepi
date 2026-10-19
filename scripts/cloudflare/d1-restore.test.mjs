import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import { access, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import os from 'node:os';
import path from 'node:path';
import { DATABASES, encrypt } from './d1-backup.mjs';
import { restoreBackup } from './d1-restore.mjs';
import { MAX_RESTORE_STATEMENT_BYTES } from './d1-restore-sql.mjs';

const keys = generateKeyPairSync('rsa', { modulusLength: 3072,
  publicKeyEncoding: { type: 'spki', format: 'pem' }, privateKeyEncoding: { type: 'pkcs8', format: 'pem' } });
const databaseId = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const env = { CLOUDFLARE_ACCOUNT_ID: 'acct', CLOUDFLARE_API_TOKEN: 'synthetic' };
async function fixture(t) {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'codepi-restore-test-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const file = path.join(dir, 'synthetic.sql.enc');
  const privateKeyFile = path.join(dir, 'private.pem');
  await writeFile(file, encrypt(Buffer.from('CREATE TABLE sample(id);'), keys.publicKey, { database: 'synthetic' }));
  await writeFile(privateKeyFile, keys.privateKey, { mode: 0o600 });
  return { file, privateKeyFile, env, databaseId };
}
const request = n => async () => Response.json({ success: true, result: [{ success: true, results: [{ n }] }] });

test('restores into an empty target with the pinned Wrangler and removes plaintext afterwards', async t => {
  const opts = await fixture(t);
  let sqlPath;
  const execute = (command, args) => {
    assert.equal(command, 'pnpm');
    assert.ok(args.includes('--remote') && args.includes('--config') && args.includes('--yes'));
    sqlPath = args[args.indexOf('--file') + 1];
    return { status: 0 };
  };
  await restoreBackup({ ...opts, request: request(0), execute });
  await assert.rejects(access(sqlPath), { code: 'ENOENT' });
});

test('refuses production and nonempty targets before importing any SQL', async t => {
  const opts = await fixture(t);
  const execute = () => { throw new Error('must not import'); };
  for (const id of Object.values(DATABASES)) {
    await assert.rejects(restoreBackup({ ...opts, databaseId: id, request: request(0), execute }), /production/);
  }
  await assert.rejects(restoreBackup({ ...opts, request: request(1), execute }), /must be empty/);
});

test('failed imports remove plaintext and never echo provider SQL output', async t => {
  const opts = await fixture(t);
  let sqlPath;
  await assert.rejects(restoreBackup({ ...opts, request: request(0), execute: (_command, args) => {
    sqlPath = args[args.indexOf('--file') + 1];
    return { status: 1, stdout: 'PRIVATE SQL', stderr: 'PRIVATE SQL' };
  } }), error => error.message.includes('exit 1') && !error.message.includes('PRIVATE'));
  await assert.rejects(access(sqlPath), { code: 'ENOENT' });
  assert.equal((await stat(opts.privateKeyFile)).mode & 0o777, 0o600);
  assert.ok((await readFile(opts.file)).length > 0);
});

test('the encrypted restore path passes bounded statements to Wrangler without shortening large text', async t => {
  const opts = await fixture(t);
  const body = "synthetic report; 'quoted'\n".repeat(12000);
  const source = `CREATE TABLE sample(id INTEGER PRIMARY KEY,body TEXT);
INSERT INTO sample VALUES(1,'${body.replaceAll("'", "''")}');`;
  await writeFile(opts.file, encrypt(Buffer.from(source), keys.publicKey, { database: 'synthetic' }));
  let sqlPath;
  await restoreBackup({ ...opts, request: request(0), execute: (_command, args) => {
    sqlPath = args[args.indexOf('--file') + 1];
    const sql = readFileSync(sqlPath, 'utf8');
    const db = new DatabaseSync(':memory:');
    try {
      let offset = 0;
      while (sql.slice(offset).trim()) {
        const statement = db.prepare(sql.slice(offset));
        assert.ok(Buffer.byteLength(statement.sourceSQL) <= MAX_RESTORE_STATEMENT_BYTES);
        statement.run();
        offset += statement.sourceSQL.length;
      }
      assert.equal(db.prepare('SELECT body FROM sample').get().body, body);
      assert.equal(db.prepare("SELECT count(*) AS n FROM sqlite_master WHERE name GLOB '__codepi_restore_text_*'").get().n, 0);
    } finally { db.close(); }
    return { status: 0 };
  } });
  await assert.rejects(access(sqlPath), { code: 'ENOENT' });
});
