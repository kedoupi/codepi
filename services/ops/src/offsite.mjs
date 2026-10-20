import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { createHash } from 'node:crypto';
import { githubApi } from '../../../scripts/cloudflare/github-api.mjs';
import {
  ORIGINAL_COLLECTIONS,
  originalCollection,
  originalFileName,
  requireDatabaseManifest,
  validOriginalId,
  validOriginalObjectKey,
} from '../../../scripts/cloudflare/backup-core.mjs';
import { objectDigest } from './backup.mjs';

export const OFFSITE_ASSET_LIMIT = 900;
export const OFFSITE_INDEX = 'offsite-index.json';
const PAGE_SIZE = 100;
const LEGACY_ASSET_LIMIT = 1000;

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function manifestFiles(manifest, prefix) {
  const legacy = manifest?.version === 2;
  assert.ok(legacy || manifest?.version === 3, 'unsupported backup manifest version');
  const files = requireDatabaseManifest(manifest.databases, { legacy }).map(entry => {
    assert.ok(Number.isSafeInteger(entry.bytes) && entry.bytes > 0
      && /^[a-f0-9]{64}$/.test(entry.sha256 ?? ''), 'invalid database backup entry');
    return { ...entry, path: entry.file, key: `${prefix}/${entry.file}` };
  });
  if (legacy) {
    const materials = manifest.materials;
    assert.ok(materials?.source === 'codepi-gu' && Array.isArray(materials.entries)
      && materials.objects === materials.entries.length
      && Number.isSafeInteger(materials.through) && materials.through >= 0,
    'legacy GU material manifest is invalid');
    files.push(...materials.entries.map(entry => ({
      ...entry, collection: 'codepi-gu', path: `materials/${entry.file}`,
      key: `${prefix}/materials/${entry.file}`,
    })));
  } else {
    assert.ok(Array.isArray(manifest.materials?.collections)
      && manifest.materials.collections.length === ORIGINAL_COLLECTIONS.length,
    'backup manifest original coverage is incomplete');
    const sources = new Set();
    for (const collection of manifest.materials.collections) {
      const definition = originalCollection(collection.source);
      assert.ok(!sources.has(collection.source) && collection.kind === definition.kind
        && Array.isArray(collection.entries) && collection.objects === collection.entries.length
        && Number.isSafeInteger(collection.through) && collection.through >= 0,
      'backup manifest has an invalid or duplicate original collection');
      sources.add(collection.source);
      files.push(...collection.entries.map(entry => ({
        ...entry, collection: definition.source, path: `materials/${entry.file}`,
        key: `${prefix}/materials/${entry.file}`,
      })));
    }
    assert.deepEqual([...sources].sort(), ORIGINAL_COLLECTIONS.map(item => item.source).sort(),
      'backup manifest original coverage is incomplete');
    assert.ok(manifest.materials.objects === files.length - manifest.databases.length,
      'backup manifest original count is incomplete');
  }
  assert.equal(new Set(files.map(entry => entry.file)).size, files.length, 'duplicate backup filenames');
  assert.equal(new Set(files.map(entry => entry.path)).size, files.length, 'duplicate backup paths');
  for (const entry of files) {
    assert.match(entry.sha256 ?? '', /^[a-f0-9]{64}$/, 'invalid backup ciphertext digest');
    assert.ok(Number.isSafeInteger(entry.bytes) && entry.bytes > 0, 'invalid backup ciphertext size');
    assert.ok(entry.path === entry.file || entry.path === `materials/${entry.file}`, 'invalid recovery path');
    if (entry.kind === undefined) continue;
    const definition = originalCollection(entry.collection);
    assert.ok(entry.kind === definition.kind && validOriginalId(definition, entry.material_id)
      && validOriginalObjectKey(definition, entry.material_id, entry.object_key)
      && entry.file === originalFileName(definition, entry.material_id)
      && Number.isSafeInteger(entry.source_bytes) && entry.source_bytes > 0
      && /^[a-f0-9]{64}$/.test(entry.source_sha256 ?? '')
      && entry.created_at === manifest.created_at,
    'invalid original backup entry');
  }
  return files;
}

function fileIdentity(entry) {
  return {
    kind: entry.kind ?? 'database',
    file: entry.file,
    path: entry.path,
    sha256: entry.sha256,
    bytes: entry.bytes,
    ...(entry.kind === undefined ? { database: entry.database } : {
      source: entry.collection, material_id: entry.material_id,
    }),
  };
}

function releaseBody(tag, manifestDigest) {
  return `Encrypted CodePi backup ${tag}. Complete only when ${OFFSITE_INDEX} and manifest.json are present in this release and every indexed shard asset verifies. Manifest SHA-256: ${manifestDigest}`;
}

async function findRelease(api, tag) {
  return api(`/releases/tags/${tag}`, { allow404: true });
}

async function ensureRelease(api, tag, body) {
  const existing = await findRelease(api, tag);
  if (existing) return existing;
  const release = await api('/releases', { method: 'POST', body: {
    tag_name: tag, target_commitish: 'main', name: tag, prerelease: true, make_latest: 'false', body,
  } });
  assert.ok(Number.isSafeInteger(release?.id) && release.id > 0 && release.tag_name === tag,
    'GitHub returned a mismatched backup release');
  return release;
}

async function listAssets(api, release, limit) {
  const assets = [];
  const lastPage = Math.ceil(limit / PAGE_SIZE) + 1;
  for (let page = 1; page <= lastPage; page++) {
    const batch = await api(`/releases/${release.id}/assets?per_page=${PAGE_SIZE}&page=${page}`);
    assert.ok(Array.isArray(batch), 'GitHub release assets unavailable');
    assets.push(...batch);
    assert.ok(assets.length <= limit, 'too many assets in backup release');
    if (batch.length < PAGE_SIZE) break;
  }
  const names = new Set();
  for (const asset of assets) {
    assert.ok(typeof asset?.name === 'string' && !names.has(asset.name), 'duplicate or invalid GitHub backup asset');
    names.add(asset.name);
  }
  return assets;
}

function verifyAsset(asset, entry, digest) {
  assert.ok(asset.state === 'uploaded' && asset.name === entry.file && asset.digest === digest
    && asset.size === entry.bytes, 'GitHub backup asset cannot be verified; preserve it for investigation');
}

async function uploadAsset(api, release, assets, entry, open, digest) {
  const existing = assets.filter(asset => asset.name === entry.file);
  assert.ok(existing.length <= 1, 'duplicate GitHub backup asset');
  if (existing.length) {
    verifyAsset(existing[0], entry, digest);
    return false;
  }
  const asset = await api(`/releases/${release.id}/assets?name=${encodeURIComponent(entry.file)}`, {
    method: 'POST', upload: true, body: await open(), contentLength: entry.bytes,
  });
  verifyAsset(asset, entry, digest);
  assets.push(asset);
  return true;
}

async function uploadR2File(api, release, assets, entry, bucket) {
  assert.ok(entry.file === OFFSITE_INDEX || /^codepi-[a-z0-9-]+\.sql\.enc$/.test(entry.file)
    || /^(?:gu-material-[a-f0-9-]{36}|me-import-[0-9A-HJKMNP-TV-Z]{26})\.bin\.enc$/.test(entry.file),
  'invalid backup filename');
  const object = await bucket.get(entry.key);
  assert.ok(object, 'R2 backup object missing during offsite copy');
  const digest = `sha256:${await objectDigest(object)}`;
  assert.equal(digest, `sha256:${entry.sha256}`, 'R2 backup does not match the complete manifest');
  return uploadAsset(api, release, assets, entry, async () => {
    const upload = await bucket.get(entry.key);
    assert.ok(upload?.etag === object.etag && upload?.size === object.size,
      'R2 backup object changed before offsite copy');
    return upload.body;
  }, digest);
}

async function uploadBytes(api, release, assets, entry, bytes) {
  const digest = `sha256:${sha256(bytes)}`;
  assert.equal(digest, `sha256:${entry.sha256}`, 'generated offline metadata changed');
  return uploadAsset(api, release, assets, entry,
    async () => new Response(bytes).body, digest);
}

function verifyAssetSet(assets, expected) {
  for (const entry of expected) {
    const matches = assets.filter(asset => asset.name === entry.file);
    assert.equal(matches.length, 1, 'required GitHub backup asset is missing');
    verifyAsset(matches[0], entry, `sha256:${entry.sha256}`);
  }
}

function chunks(items, size) {
  const result = [];
  for (let offset = 0; offset < items.length; offset += size) result.push(items.slice(offset, offset + size));
  return result;
}

function indexDocument(manifest, prefix, manifestEntry, shards) {
  const files = shards.flatMap(shard => shard.assets);
  return {
    format: 'codepi-offsite-v1',
    prefix,
    backup: {
      version: manifest.version, created_at: manifest.created_at, key_id: manifest.key_id,
    },
    manifest: {
      file: manifestEntry.file, sha256: manifestEntry.sha256, bytes: manifestEntry.bytes,
    },
    assets: files.length,
    bytes: files.reduce((sum, entry) => sum + entry.bytes, 0),
    shards: shards.map(shard => ({
      tag: shard.release.tag_name,
      release_id: shard.release.id,
      assets: shard.assets,
    })),
  };
}

function indexBytes(document) {
  return Buffer.from(JSON.stringify(document, null, 2) + '\n');
}

export async function offsiteRelease(manifest, prefix, bucket, { token, request = fetch } = {}) {
  assert.ok(token, 'GITHUB_TOKEN with repository Contents write access is required for offsite backup');
  const api = (endpoint, options = {}) => githubApi(endpoint, { token, request, ...options });
  const tag = `ops-backup-${prefix.split('/').at(-1)}`;
  const manifestBytes = Buffer.from(JSON.stringify(manifest));
  const manifestEntry = {
    file: 'manifest.json', path: 'manifest.json', bytes: manifestBytes.length, sha256: sha256(manifestBytes),
  };
  const files = manifestFiles(manifest, prefix);
  const main = await findRelease(api, tag);
  let mainAssets = main ? await listAssets(api, main, LEGACY_ASSET_LIMIT) : [];
  const hasIndex = mainAssets.some(asset => asset.name === OFFSITE_INDEX);
  assert.ok(!hasIndex || mainAssets.length <= OFFSITE_ASSET_LIMIT, 'too many assets in backup release');
  if (main && !hasIndex) {
    const expected = [...files, manifestEntry];
    const complete = expected.every(entry => mainAssets.some(asset => asset.name === entry.file));
    if (complete) {
      verifyAssetSet(mainAssets, expected);
      return {
        release_id: main.id, tag, format: 'single-release-v1',
        assets: expected.length, payload_assets: files.length,
      };
    }
    assert.equal(mainAssets.length, 0,
      'existing legacy backup release is incomplete; preserve it for investigation and start a new backup instance');
  }

  const shardPlans = chunks(files, OFFSITE_ASSET_LIMIT);
  const shards = [];
  for (const [index, expected] of shardPlans.entries()) {
    const shardTag = `${tag}-part-${String(index + 1).padStart(2, '0')}`;
    const release = await ensureRelease(api, shardTag, releaseBody(shardTag, manifestEntry.sha256));
    const assets = await listAssets(api, release, OFFSITE_ASSET_LIMIT);
    for (const entry of expected) await uploadR2File(api, release, assets, entry, bucket);
    const verified = await listAssets(api, release, OFFSITE_ASSET_LIMIT);
    verifyAssetSet(verified, expected);
    shards.push({ release, assets: expected.map(fileIdentity) });
  }

  const document = indexDocument(manifest, prefix, manifestEntry, shards);
  const bytes = indexBytes(document);
  const indexEntry = {
    file: OFFSITE_INDEX, path: OFFSITE_INDEX, bytes: bytes.length, sha256: sha256(bytes),
  };
  const mainRelease = main ?? await ensureRelease(api, tag,
    releaseBody(tag, manifestEntry.sha256));
  mainAssets = main ? mainAssets : await listAssets(api, mainRelease, OFFSITE_ASSET_LIMIT);
  await uploadBytes(api, mainRelease, mainAssets, indexEntry, bytes);
  verifyAssetSet(await listAssets(api, mainRelease, OFFSITE_ASSET_LIMIT), [indexEntry]);
  await uploadBytes(api, mainRelease, mainAssets, manifestEntry, manifestBytes);
  const finalAssets = await listAssets(api, mainRelease, OFFSITE_ASSET_LIMIT);
  verifyAssetSet(finalAssets, [indexEntry, manifestEntry]);
  return {
    release_id: mainRelease.id,
    tag,
    format: 'sharded-v1',
    assets: files.length + 2,
    payload_assets: files.length,
    index: { file: indexEntry.file, sha256: indexEntry.sha256, bytes: indexEntry.bytes },
    shards: shards.map(shard => ({
      tag: shard.release.tag_name, release_id: shard.release.id, assets: shard.assets.length,
    })),
  };
}
