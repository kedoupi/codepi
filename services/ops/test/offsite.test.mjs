import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { DATABASES, DATABASE_NAMES } from '../../../scripts/cloudflare/backup-core.mjs';
import { OFFSITE_ASSET_LIMIT, OFFSITE_INDEX, offsiteRelease } from '../src/offsite.mjs';
import { bucketFixture } from './fixtures.mjs';

const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const createdAt = '2026-10-20T00:00:00.000Z';
const prefix = 'backups/synthetic';
const mainTag = 'ops-backup-synthetic';

function materialIds(source, count) {
  return Array.from({ length: count }, (_, index) => source === 'codepi-gu'
    ? `00000000-0000-4000-8000-${(index + 1).toString(16).padStart(12, '0')}`
    : `01J${String(index + 1).padStart(23, '0')}`);
}

async function fixture({ version = 3, guCount = 2, meCount = 2 } = {}) {
  const bucket = bucketFixture();
  const databaseNames = version === 2 ? Object.keys(DATABASES) : DATABASE_NAMES;
  const databases = [];
  for (const [index, database] of databaseNames.entries()) {
    const bytes = Buffer.from(`encrypted database ${database}`);
    const database_id = DATABASES[database]
      ?? `99999999-9999-4999-8999-${String(index + 1).padStart(12, '0')}`;
    const entry = { database, database_id, file: `${database}.sql.enc`,
      bytes: bytes.length, sha256: digest(bytes), created_at: createdAt };
    await bucket.put(`${prefix}/${entry.file}`, bytes);
    databases.push(entry);
  }
  const collection = async (source, kind, objectPrefix, ids) => {
    const entries = [];
    for (const material_id of ids) {
      const bytes = Buffer.from(`encrypted ${kind} ${material_id}`);
      const entry = {
        kind, material_id, object_key: `${objectPrefix}/${material_id}`,
        file: `${kind}-${material_id}.bin.enc`, source_bytes: 1,
        source_sha256: digest(Buffer.from('synthetic source')),
        bytes: bytes.length, sha256: digest(bytes), created_at: createdAt,
      };
      await bucket.put(`${prefix}/materials/${entry.file}`, bytes);
      entries.push(entry);
    }
    return { source, kind, through: entries.length, objects: entries.length, entries };
  };
  const gu = await collection('codepi-gu', 'gu-material', 'materials',
    materialIds('codepi-gu', guCount));
  const me = await collection('codepi-me', 'me-import', 'imports',
    materialIds('codepi-me', meCount));
  const materials = version === 2
    ? { source: 'codepi-gu', through: gu.objects, objects: gu.objects, entries: gu.entries }
    : { objects: gu.objects + me.objects, collections: [gu, me] };
  const manifest = { version, created_at: createdAt, key_id: '0'.repeat(64), databases, materials };
  await bucket.put(`${prefix}/manifest.json`, JSON.stringify(manifest));
  return { bucket, manifest, gu, me };
}

function githubFixture() {
  const releases = new Map(), uploads = [], attempts = [];
  let nextId = 100, failName;
  const request = async (input, init = {}) => {
    const url = new URL(input);
    if (url.hostname === 'uploads.github.com') {
      const id = Number(url.pathname.match(/\/releases\/(\d+)\/assets$/)?.[1]);
      const release = [...releases.values()].find(item => item.id === id);
      assert.ok(release, 'upload targets an unknown release');
      const name = url.searchParams.get('name');
      const bytes = Buffer.from(await new Response(init.body).arrayBuffer());
      attempts.push({ tag: release.tag_name, name, bytes: bytes.length });
      if (failName === name) {
        failName = undefined;
        return Response.json({ message: 'synthetic upload interruption' }, { status: 500 });
      }
      assert.ok(!release.assets.some(asset => asset.name === name), 'asset names must be unique');
      const asset = { id: nextId++, name, state: 'uploaded', size: bytes.length,
        digest: `sha256:${digest(bytes)}` };
      release.assets.push({ ...asset, bytes });
      uploads.push({ tag: release.tag_name, name });
      const { bytes: _, ...metadata } = release.assets.at(-1);
      return Response.json(metadata);
    }
    assert.equal(url.hostname, 'api.github.com');
    const tag = url.pathname.match(/\/releases\/tags\/([^/]+)$/)?.[1];
    if (tag && init.method === 'GET') {
      const release = releases.get(decodeURIComponent(tag));
      return release
        ? Response.json({ id: release.id, tag_name: release.tag_name })
        : new Response('', { status: 404 });
    }
    if (url.pathname.endsWith('/releases') && init.method === 'POST') {
      const body = JSON.parse(init.body);
      const release = { id: nextId++, tag_name: body.tag_name, assets: [] };
      releases.set(body.tag_name, release);
      return Response.json({ id: release.id, tag_name: release.tag_name });
    }
    const id = Number(url.pathname.match(/\/releases\/(\d+)\/assets$/)?.[1]);
    const release = [...releases.values()].find(item => item.id === id);
    assert.ok(release, 'asset list targets an unknown release');
    const page = Number(url.searchParams.get('page')), perPage = Number(url.searchParams.get('per_page'));
    return Response.json(release.assets.slice((page - 1) * perPage, page * perPage)
      .map(({ bytes: _, ...asset }) => asset));
  };
  return {
    request, releases, uploads, attempts,
    failNext(name) { failName = name; },
    seed(tag, name, bytes) {
      let release = releases.get(tag);
      if (!release) {
        release = { id: nextId++, tag_name: tag, assets: [] };
        releases.set(tag, release);
      }
      release.assets.push({ id: nextId++, name, state: 'uploaded', size: bytes.length,
        digest: `sha256:${digest(bytes)}`, bytes });
    },
    bytes(tag, name) {
      return releases.get(tag)?.assets.find(asset => asset.name === name)?.bytes;
    },
  };
}

test('full eight-database and two-thousand-original coverage is sharded, indexed and idempotent', async () => {
  const data = await fixture({ guCount: 1000, meCount: 1000 });
  const github = githubFixture();
  const run = () => offsiteRelease(data.manifest, prefix, data.bucket,
    { token: 'synthetic', request: github.request });
  const result = await run();
  assert.equal(result.format, 'sharded-v1');
  assert.equal(result.payload_assets, 2008);
  assert.equal(result.assets, 2010);
  assert.deepEqual(result.shards.map(shard => shard.assets), [900, 900, 208]);
  assert.ok(result.shards.every(shard => shard.assets <= OFFSITE_ASSET_LIMIT));

  const main = github.releases.get(mainTag);
  assert.deepEqual(main.assets.map(asset => asset.name), [OFFSITE_INDEX, 'manifest.json']);
  const index = JSON.parse(github.bytes(mainTag, OFFSITE_INDEX));
  assert.equal(index.format, 'codepi-offsite-v1');
  assert.equal(index.assets, 2008);
  assert.equal(index.manifest.sha256, digest(github.bytes(mainTag, 'manifest.json')));
  assert.deepEqual(index.shards.map(shard => shard.assets.length), [900, 900, 208]);
  assert.ok(index.shards.every(shard => shard.release_id > 0 && shard.tag.startsWith(`${mainTag}-part-`)));
  const mapped = new Map();
  for (const shard of index.shards) {
    for (const entry of shard.assets) {
      assert.ok(!mapped.has(entry.path), 'recovery paths must be unique');
      const bytes = github.bytes(shard.tag, entry.file);
      assert.ok(bytes);
      assert.equal(bytes.length, entry.bytes);
      assert.equal(digest(bytes), entry.sha256);
      mapped.set(entry.path, bytes);
    }
  }
  assert.equal(mapped.size, 2008);
  assert.equal(mapped.get(`${DATABASE_NAMES[0]}.sql.enc`).toString(),
    `encrypted database ${DATABASE_NAMES[0]}`);
  assert.ok(mapped.has(`materials/${data.me.entries[999].file}`));

  const uploaded = github.uploads.length;
  await run();
  assert.equal(github.uploads.length, uploaded);
});

test('an interrupted final manifest upload resumes without repeating shard uploads', async () => {
  const data = await fixture({ guCount: 3, meCount: 3 });
  const github = githubFixture();
  github.failNext('manifest.json');
  const run = () => offsiteRelease(data.manifest, prefix, data.bucket,
    { token: 'synthetic', request: github.request });
  await assert.rejects(run(), /HTTP 500/);
  assert.equal(github.bytes(mainTag, 'manifest.json'), undefined);
  assert.ok(github.bytes(mainTag, OFFSITE_INDEX));
  const firstAttempts = github.attempts.length;
  await run();
  assert.deepEqual(github.attempts.slice(firstAttempts).map(item => item.name), ['manifest.json']);
  assert.deepEqual([...github.releases.keys()].sort(), [
    mainTag, `${mainTag}-part-01`,
  ]);
});

test('legacy v2 and v3 single-release backups remain readable without creating shards', async () => {
  for (const version of [2, 3]) {
    const data = await fixture({ version, guCount: 2, meCount: 2 });
    const github = githubFixture();
    const entries = [
      ...data.manifest.databases,
      ...(version === 2
        ? data.gu.entries
        : data.manifest.materials.collections.flatMap(collection => collection.entries)),
    ];
    for (const entry of entries) {
      const key = entry.kind === undefined ? `${prefix}/${entry.file}` : `${prefix}/materials/${entry.file}`;
      github.seed(mainTag, entry.file, data.bucket.data.get(key).bytes);
    }
    github.seed(mainTag, 'manifest.json', data.bucket.data.get(`${prefix}/manifest.json`).bytes);
    const result = await offsiteRelease(data.manifest, prefix, data.bucket,
      { token: 'synthetic', request: github.request });
    assert.equal(result.format, 'single-release-v1');
    assert.equal(result.payload_assets, entries.length);
    assert.deepEqual([...github.releases.keys()], [mainTag]);
    assert.equal(github.uploads.length, 0);
  }
});

test('corrupted shard assets fail closed without replacing evidence', async () => {
  const data = await fixture({ guCount: 2, meCount: 2 });
  const github = githubFixture();
  await offsiteRelease(data.manifest, prefix, data.bucket, { token: 'synthetic', request: github.request });
  const shard = github.releases.get(`${mainTag}-part-01`);
  shard.assets[0].digest = `sha256:${'0'.repeat(64)}`;
  const uploads = github.uploads.length;
  await assert.rejects(offsiteRelease(data.manifest, prefix, data.bucket,
    { token: 'synthetic', request: github.request }), /cannot be verified/);
  assert.equal(github.uploads.length, uploads);
});
