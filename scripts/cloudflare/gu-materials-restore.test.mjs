import assert from 'node:assert/strict';
import { createHash, generateKeyPairSync } from 'node:crypto';
import { access, mkdir, mkdtemp, readFile, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { DATABASES, encrypt, keyId } from './backup-core.mjs';
import { restoreMaterials } from './gu-materials-restore.mjs';

const keys = generateKeyPairSync('rsa', { modulusLength: 3072,
  publicKeyEncoding: { type: 'spki', format: 'pem' }, privateKeyEncoding: { type: 'pkcs8', format: 'pem' } });
const databaseId = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const digest = bytes => createHash('sha256').update(bytes).digest('hex');

async function fixture(t, count = 2) {
  const dir = await mkdtemp(path.join(tmpdir(), 'gu-originals-restore-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const backupDir = path.join(dir, 'backup'), outDir = path.join(dir, 'recovered');
  const privateKeyFile = path.join(dir, 'recovery.pem');
  await mkdir(path.join(backupDir, 'materials'), { recursive: true });
  await writeFile(privateKeyFile, keys.privateKey, { mode: 0o600 });
  const created_at = '2026-10-19T00:00:00.000Z';
  const database = { database: 'codepi-gu', database_id: DATABASES['codepi-gu'], created_at };
  const sql = encrypt(Buffer.from('CREATE TABLE synthetic(id);'), keys.publicKey, database);
  const manifest = { version: 2, created_at, key_id: keyId(keys.publicKey),
    databases: [{ ...database, file: 'codepi-gu.sql.enc', bytes: sql.length, sha256: digest(sql) }],
    materials: { source: 'codepi-gu', through: count, objects: count, entries: [] } };
  await writeFile(path.join(backupDir, 'codepi-gu.sql.enc'), sql);
  const index = [];
  for (let i = 0; i < count; i++) {
    const id = `00000000-0000-4000-8000-${String(i + 1).padStart(12, '0')}`;
    const original = Buffer.from(`Synthetic private original ${i}`);
    const metadata = { kind: 'gu-material', material_id: id, object_key: `materials/${id}`,
      source_bytes: original.length, source_sha256: digest(original), created_at };
    const ciphertext = encrypt(original, keys.publicKey, metadata);
    const entry = { ...metadata, file: `gu-material-${id}.bin.enc`, bytes: ciphertext.length, sha256: digest(ciphertext) };
    manifest.materials.entries.push(entry);
    await writeFile(path.join(backupDir, 'materials', entry.file), ciphertext);
    index.push({ id, object_key: metadata.object_key, size: original.length, sha256: digest(original) });
  }
  const save = () => writeFile(path.join(backupDir, 'manifest.json'), JSON.stringify(manifest));
  await save();
  const request = async (url, init) => {
    assert.ok(url.endsWith(`/d1/database/${databaseId}/query`));
    assert.match(JSON.parse(init.body).sql, /^SELECT .* FROM gu_materials/);
    return Response.json({ success: true, result: [{ success: true, results: index }] });
  };
  return { dir, backupDir, privateKeyFile, databaseId, outDir, manifest, index, save,
    env: { CLOUDFLARE_ACCOUNT_ID: 'synthetic', CLOUDFLARE_API_TOKEN: 'synthetic' }, request };
}

test('recovery verifies D1 references, restores exact bytes privately and reports newer originals separately', async t => {
  const opts = await fixture(t);
  opts.index.pop(); // The second original arrived after the D1 export.
  opts.manifest.materials.through = 1;
  await opts.save();
  const report = await restoreMaterials(opts);
  assert.deepEqual([report.objects, report.indexed, report.extra_objects], [2, 1, 1]);
  assert.equal((await stat(opts.outDir)).mode & 0o777, 0o700);
  for (const [i, entry] of opts.manifest.materials.entries.entries()) {
    const file = path.join(opts.outDir, entry.object_key);
    assert.equal((await readFile(file)).toString(), `Synthetic private original ${i}`);
    assert.equal((await stat(file)).mode & 0o777, 0o600);
  }
  assert.equal(JSON.parse(await readFile(path.join(opts.outDir, 'restore-report.json'))).ok, true);
  await assert.rejects(restoreMaterials(opts), { code: 'EEXIST' });
});

test('a verified empty index and archive restore as zero originals', async t => {
  const opts = await fixture(t, 0);
  assert.equal((await restoreMaterials(opts)).objects, 0);
});

test('missing D1 rows cannot be reported as a successful recovery', async t => {
  const opts = await fixture(t);
  opts.index.pop();
  await assert.rejects(restoreMaterials(opts), /missing exported originals/);
  await assert.rejects(access(opts.outDir), { code: 'ENOENT' });
});

test('missing originals, ciphertext corruption and source hash mismatches remove partial plaintext', async t => {
  for (const kind of ['missing', 'ciphertext', 'source', 'identity', 'symlink']) {
    const opts = await fixture(t), entry = opts.manifest.materials.entries[1];
    const file = path.join(opts.backupDir, 'materials', entry.file);
    if (kind === 'missing') await rm(file);
    if (kind === 'ciphertext') await writeFile(file, Buffer.alloc(entry.bytes));
    if (kind === 'source') {
      entry.source_sha256 = '0'.repeat(64);
      opts.index[1].sha256 = entry.source_sha256;
    }
    if (kind === 'identity') {
      const ciphertext = encrypt(Buffer.from('Synthetic private original 1'), keys.publicKey, { kind: 'wrong' });
      entry.bytes = ciphertext.length;
      entry.sha256 = digest(ciphertext);
      await writeFile(file, ciphertext);
    }
    if (kind === 'symlink') {
      await rm(file);
      await symlink(path.join(opts.backupDir, 'materials', opts.manifest.materials.entries[0].file), file);
    }
    await opts.save();
    await assert.rejects(restoreMaterials(opts));
    await assert.rejects(access(opts.outDir), { code: 'ENOENT' });
  }
});

test('missing D1 references, path traversal and duplicate entries fail before creating output', async t => {
  for (const kind of ['index', 'size', 'traversal', 'duplicate', 'legacy']) {
    const opts = await fixture(t);
    if (kind === 'index') opts.index[0].object_key = 'materials/missing';
    if (kind === 'size') opts.index[0].size++;
    if (kind === 'traversal') opts.manifest.materials.entries[0].object_key = '../outside';
    if (kind === 'duplicate') opts.manifest.materials.entries[1] = opts.manifest.materials.entries[0];
    if (kind === 'legacy') delete opts.manifest.materials;
    await opts.save();
    await assert.rejects(restoreMaterials(opts));
    await assert.rejects(access(opts.outDir), { code: 'ENOENT' });
  }
});

test('production database IDs, wrong keys and Git output targets are rejected', async t => {
  const opts = await fixture(t);
  for (const id of Object.values(DATABASES)) {
    await assert.rejects(restoreMaterials({ ...opts, databaseId: id, request: () => {
      throw new Error('must not access production');
    } }), /production/);
  }
  const outDir = fileURLToPath(new URL('../../must-not-write-recovery', import.meta.url));
  await assert.rejects(restoreMaterials({ ...opts, outDir }), /outside every Git checkout/);
  const other = generateKeyPairSync('rsa', { modulusLength: 3072, privateKeyEncoding: { type: 'pkcs8', format: 'pem' } });
  await writeFile(opts.privateKeyFile, other.privateKey);
  await assert.rejects(restoreMaterials(opts), /recovery key/);
  await assert.rejects(access(opts.outDir), { code: 'ENOENT' });
});
