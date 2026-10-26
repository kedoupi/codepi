import assert from 'node:assert/strict';
import { createHash, generateKeyPairSync } from 'node:crypto';
import { access, mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { DATABASES, DATABASE_NAMES, encrypt, keyId } from './backup-core.mjs';
import { restoreOriginals } from './originals-restore.mjs';

const keys = generateKeyPairSync('rsa', { modulusLength: 3072,
  publicKeyEncoding: { type: 'spki', format: 'pem' }, privateKeyEncoding: { type: 'pkcs8', format: 'pem' } });
const meDatabaseId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const targetGu = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const targetMe = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const targetBlog = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const digest = bytes => createHash('sha256').update(bytes).digest('hex');

function collection(source, kind, table, objectPrefix, originals, createdAt, idKind) {
  const entries = [], index = [];
  for (const [i, bytes] of originals.entries()) {
    const id = idKind === 'ulid'
      ? `01J${String(i + 1).padStart(23, '0')}`
      : `00000000-0000-4000-8000-${String(i + 1).padStart(12, '0')}`;
    const object_key = `${objectPrefix}/${id}`;
    const metadata = { kind, material_id: id, object_key, source_bytes: bytes.length,
      source_sha256: digest(bytes), created_at: createdAt };
    const ciphertext = encrypt(bytes, keys.publicKey, metadata);
    entries.push({ ...metadata, file: `${kind}-${id}.bin.enc`, bytes: ciphertext.length, sha256: digest(ciphertext) });
    index.push({ id, object_key, size: bytes.length, sha256: metadata.source_sha256, ciphertext });
  }
  return { definition: { source, kind, table }, entries, index };
}

async function fixture(t, { version = 4, guCount = 1, meCount = 1, blogCount = 1 } = {}) {
  const dir = await mkdtemp(path.join(tmpdir(), 'originals-restore-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const backupDir = path.join(dir, 'backup'), outDir = path.join(dir, 'recovered');
  const privateKeyFile = path.join(dir, 'recovery.pem');
  await mkdir(path.join(backupDir, 'materials'), { recursive: true });
  await writeFile(privateKeyFile, keys.privateKey, { mode: 0o600 });
  const created_at = '2026-10-20T00:00:00.000Z';
  const gu = collection('codepi-gu', 'gu-material', 'gu_materials', 'materials',
    Array.from({ length: guCount }, (_, i) => Buffer.from(`Synthetic GU original ${i}`)), created_at, 'uuid');
  const me = collection('codepi-me', 'me-import', 'imports', 'imports',
    Array.from({ length: meCount }, (_, i) => Buffer.from(`Synthetic Me import ${i}`)), created_at, 'ulid');
  const blog = collection('codepi-blog', 'blog-media', 'blog_media', 'media',
    Array.from({ length: blogCount }, (_, i) => Buffer.from(`Synthetic blog media ${i}`)), created_at, 'uuid');
  const databaseIds = Object.fromEntries(DATABASE_NAMES.map((name, i) => [name,
    DATABASES[name] ?? (name === 'codepi-me' ? meDatabaseId
      : `99999999-9999-4999-8999-${String(i + 1).padStart(12, '0')}`)]));
  const databases = DATABASE_NAMES
    .filter(name => version >= 3 || Object.hasOwn(DATABASES, name))
    .map(name => ({
      database: name, database_id: databaseIds[name], file: `${name}.sql.enc`, created_at,
    }));
  for (const database of databases) {
    const sql = encrypt(Buffer.from(`CREATE TABLE ${database.database.replaceAll('-', '_')}(id);`),
      keys.publicKey, { database: database.database, database_id: database.database_id, created_at });
    database.bytes = sql.length;
    database.sha256 = digest(sql);
    await writeFile(path.join(backupDir, database.file), sql);
  }
  let materials;
  if (version === 2) {
    materials = { source: 'codepi-gu', through: gu.entries.length, objects: gu.entries.length, entries: gu.entries };
  } else if (version === 3) {
    materials = {
      objects: gu.entries.length + me.entries.length,
      collections: [
        { source: 'codepi-gu', kind: 'gu-material', through: gu.entries.length,
          objects: gu.entries.length, entries: gu.entries },
        { source: 'codepi-me', kind: 'me-import', through: me.entries.length,
          objects: me.entries.length, entries: me.entries },
      ],
    };
  } else {
    materials = {
      objects: gu.entries.length + me.entries.length + blog.entries.length,
      collections: [
        { source: 'codepi-gu', kind: 'gu-material', through: gu.entries.length,
          objects: gu.entries.length, entries: gu.entries },
        { source: 'codepi-me', kind: 'me-import', through: me.entries.length,
          objects: me.entries.length, entries: me.entries },
        { source: 'codepi-blog', kind: 'blog-media', through: blog.entries.length,
          objects: blog.entries.length, entries: blog.entries },
      ],
    };
  }
  const manifest = { version, created_at, key_id: keyId(keys.publicKey), databases, materials };
  for (const entry of [...gu.entries, ...me.entries, ...blog.entries]) {
    const source = entry.kind === 'gu-material' ? gu : entry.kind === 'me-import' ? me : blog;
    await writeFile(path.join(backupDir, 'materials', entry.file),
      source.index.find(row => row.id === entry.material_id).ciphertext);
  }
  const save = () => writeFile(path.join(backupDir, 'manifest.json'), JSON.stringify(manifest));
  await save();
  const queried = [];
  const request = async (url, init) => {
    const body = JSON.parse(init.body);
    if (url.includes(targetGu)) {
      assert.match(body.sql, /\bFROM gu_materials\b/);
      queried.push('codepi-gu');
      return Response.json({ success: true, result: [{ success: true,
        results: gu.index.map(({ ciphertext: _, ...row }) => row) }] });
    }
    if (url.includes(targetMe)) {
      assert.match(body.sql, /\bFROM imports\b/);
      queried.push('codepi-me');
      return Response.json({ success: true, result: [{ success: true,
        results: me.index.map(({ ciphertext: _, ...row }) => row) }] });
    }
    if (url.includes(targetBlog)) {
      assert.match(body.sql, /\bFROM blog_media\b/);
      queried.push('codepi-blog');
      return Response.json({ success: true, result: [{ success: true,
        results: blog.index.map(({ ciphertext: _, ...row }) => row) }] });
    }
    throw new Error('unexpected recovery database');
  };
  const selected = { 'codepi-gu': targetGu };
  if (version >= 3) selected['codepi-me'] = targetMe;
  if (version >= 4) selected['codepi-blog'] = targetBlog;
  return {
    dir, backupDir, outDir, privateKeyFile, manifest, gu, me, blog, save, queried,
    databaseIds: selected,
    env: { CLOUDFLARE_ACCOUNT_ID: 'synthetic', CLOUDFLARE_API_TOKEN: 'synthetic' },
    request,
  };
}

test('new v4 recovery validates every D1 index and restores GU, Me and blog originals byte-for-byte', async t => {
  const opts = await fixture(t, { guCount: 2, meCount: 2, blogCount: 2 });
  const report = await restoreOriginals(opts);
  assert.deepEqual(opts.queried, ['codepi-gu', 'codepi-me', 'codepi-blog']);
  assert.deepEqual(report.collections.map(item => [item.source, item.objects, item.indexed, item.extra_objects]), [
    ['codepi-gu', 2, 2, 0],
    ['codepi-me', 2, 2, 0],
    ['codepi-blog', 2, 2, 0],
  ]);
  assert.deepEqual([report.objects, report.indexed, report.extra_objects], [6, 6, 0]);
  assert.equal((await stat(opts.outDir)).mode & 0o777, 0o700);
  for (const [collection, label, noun] of [[opts.gu, 'GU', 'original'], [opts.me, 'Me', 'import'], [opts.blog, 'blog', 'media']]) {
    for (const [i, entry] of collection.entries.entries()) {
      const file = path.join(opts.outDir, collection.definition.source, entry.object_key);
      assert.equal((await readFile(file)).toString(), `Synthetic ${label} ${noun} ${i}`);
      assert.equal((await stat(file)).mode & 0o777, 0o600);
    }
  }
  const saved = JSON.parse(await readFile(path.join(opts.outDir, 'restore-report.json')));
  assert.equal(saved.ok, true);
  await assert.rejects(restoreOriginals(opts), { code: 'EEXIST' });
});

test('legacy v3 GU and Me backups remain readable without inventing blog coverage', async t => {
  const opts = await fixture(t, { version: 3, guCount: 1, meCount: 1 });
  const report = await restoreOriginals(opts);
  assert.deepEqual(opts.queried, ['codepi-gu', 'codepi-me']);
  assert.deepEqual(report.collections.map(item => [item.source, item.objects]), [
    ['codepi-gu', 1], ['codepi-me', 1],
  ]);
});

test('legacy v2 GU-only backups remain readable without inventing Me coverage', async t => {
  const opts = await fixture(t, { version: 2, guCount: 2 });
  const report = await restoreOriginals(opts);
  assert.deepEqual(report.collections.map(item => [item.source, item.objects]), [['codepi-gu', 2]]);
  assert.deepEqual(opts.queried, ['codepi-gu']);
  assert.equal((await readFile(path.join(opts.outDir, 'codepi-gu', opts.gu.entries[0].object_key))).toString(),
    'Synthetic GU original 0');
});

test('new originals after the D1 export remain recoverable as extra objects', async t => {
  const opts = await fixture(t);
  opts.manifest.materials.collections.find(collection => collection.source === 'codepi-gu').through = 0;
  opts.gu.index.pop();
  await opts.save();
  const report = await restoreOriginals(opts);
  assert.deepEqual(report.collections.map(item => [item.source, item.indexed, item.extra_objects]), [
    ['codepi-gu', 0, 1],
    ['codepi-me', 1, 0],
    ['codepi-blog', 1, 0],
  ]);
});

test('missing D1 rows cannot be reported as a successful recovery', async t => {
  const opts = await fixture(t);
  opts.gu.index.pop();
  await assert.rejects(restoreOriginals(opts), /missing exported originals/);
  await assert.rejects(access(opts.outDir), { code: 'ENOENT' });
});

test('all manifest production identities are excluded even when a new database UUID uses uppercase', async t => {
  const opts = await fixture(t);
  const projectId = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
  opts.manifest.databases.find(database => database.database === 'codepi-project').database_id =
    projectId.toUpperCase();
  await opts.save();
  opts.databaseIds['codepi-me'] = projectId;
  let queried = false;
  opts.request = async () => { queried = true; throw new Error('recovery must not query production'); };
  await assert.rejects(restoreOriginals(opts), /refusing to read a production database/);
  assert.equal(queried, false);
  await assert.rejects(access(opts.outDir), { code: 'ENOENT' });
});

test('Me corruption, missing coverage and target ambiguity fail before plaintext output', async t => {
  for (const kind of ['missing-original', 'missing-database', 'missing-collection',
    'database-count', 'index', 'ulid', 'production-target']) {
    const opts = await fixture(t);
    if (kind === 'missing-original') await rm(path.join(opts.backupDir, 'materials', opts.me.entries[0].file));
    if (kind === 'missing-database') {
      opts.manifest.databases = opts.manifest.databases.filter(database => database.database !== 'codepi-me');
      await opts.save();
    }
    if (kind === 'database-count') {
      opts.manifest.materials.objects++;
      await opts.save();
    }
    if (kind === 'missing-collection') {
      opts.manifest.materials.collections = opts.manifest.materials.collections
        .filter(collection => collection.source !== 'codepi-me');
      opts.manifest.materials.objects -= opts.me.entries.length;
      await opts.save();
    }
    if (kind === 'ulid') {
      opts.manifest.materials.collections.find(collection => collection.source === 'codepi-me')
        .entries[0].material_id = '00000000-0000-4000-8000-000000000001';
      await opts.save();
    }
    if (kind === 'index') {
      const normal = opts.request;
      const row = opts.me.index[0];
      opts.request = async (url, init) => url.includes(targetMe)
        ? Response.json({ success: true, result: [{ success: true,
          results: [{ id: row.id, object_key: row.object_key, size: row.size, sha256: '0'.repeat(64) }] }] })
        : normal(url, init);
    }
    if (kind === 'production-target') opts.databaseIds['codepi-me'] = meDatabaseId;
    await assert.rejects(restoreOriginals(opts), kind === 'production-target' ? /production/ : /./);
    await assert.rejects(access(opts.outDir), { code: 'ENOENT' });
  }
});

test('blog corruption, missing coverage and a v3-shaped current manifest fail before plaintext output', async t => {
  for (const kind of ['missing-original', 'missing-database', 'missing-collection',
    'v3-shape', 'uuid', 'index', 'production-target']) {
    const opts = await fixture(t);
    if (kind === 'missing-original') await rm(path.join(opts.backupDir, 'materials', opts.blog.entries[0].file));
    if (kind === 'missing-database') {
      opts.manifest.databases = opts.manifest.databases.filter(database => database.database !== 'codepi-blog');
      await opts.save();
    }
    if (kind === 'missing-collection' || kind === 'v3-shape') {
      opts.manifest.materials.collections = opts.manifest.materials.collections
        .filter(collection => collection.source !== 'codepi-blog');
      opts.manifest.materials.objects -= opts.blog.entries.length;
      if (kind === 'v3-shape') opts.manifest.version = 3;
      await opts.save();
    }
    if (kind === 'uuid') {
      opts.manifest.materials.collections.find(collection => collection.source === 'codepi-blog')
        .entries[0].material_id = '01J00000000000000000000001';
      await opts.save();
    }
    if (kind === 'index') {
      const normal = opts.request;
      const row = opts.blog.index[0];
      opts.request = async (url, init) => url.includes(targetBlog)
        ? Response.json({ success: true, result: [{ success: true,
          results: [{ id: row.id, object_key: row.object_key, size: row.size, sha256: '0'.repeat(64) }] }] })
        : normal(url, init);
    }
    if (kind === 'production-target') opts.databaseIds['codepi-blog'] = DATABASES['codepi-blog'];
    await assert.rejects(restoreOriginals(opts), kind === 'production-target' ? /production/ : /./);
    await assert.rejects(access(opts.outDir), { code: 'ENOENT' });
  }
});
