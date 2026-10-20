import assert from 'node:assert/strict';
import {
  ORIGINAL_COLLECTIONS,
  originalCollection,
  originalFileName,
  validOriginalId,
  validOriginalObjectKey,
} from '../../../scripts/cloudflare/backup-core.mjs';
import { backupStream } from './backup.mjs';

export const MAX_MATERIALS = 1000;
const MAX_MATERIAL_BYTES = 8 * 1024 * 1024;

export { ORIGINAL_COLLECTIONS, originalCollection };

function validatePage(page, after, through, label) {
  assert.ok(Number.isSafeInteger(page?.through) && page.through >= after
    && (through === undefined || through === page.through), `${label} material snapshot changed`);
  return page.through;
}

export function assertCollectionBinding(source, binding) {
  const collection = originalCollection(source);
  assert.ok(binding?.listMaterials && binding?.readMaterial, `${collection.source} original backup binding is required`);
  return collection;
}

export async function collectionIndex(source, binding) {
  const collection = assertCollectionBinding(source, binding);
  const items = [], ids = new Set();
  let after = 0, through;
  for (;;) {
    const page = await binding.listMaterials(after, through);
    through = validatePage(page, after, through, collection.source);
    assert.ok(Array.isArray(page.items) && page.items.length <= 100, `invalid ${collection.source} original page`);
    for (const row of page.items) {
      assert.ok(Number.isSafeInteger(row.cursor) && row.cursor > after && row.cursor <= through
        && validOriginalId(collection, row.id)
        && validOriginalObjectKey(collection, row.id, row.object_key) && !ids.has(row.id)
        && Number.isSafeInteger(row.size) && row.size > 0 && row.size <= MAX_MATERIAL_BYTES
        && /^[a-f0-9]{64}$/.test(row.sha256), `invalid ${collection.source} original index`);
      after = row.cursor;
      ids.add(row.id);
      items.push({ id: row.id, object_key: row.object_key, size: row.size, sha256: row.sha256 });
      assert.ok(items.length <= MAX_MATERIALS,
        `${collection.source} original backup exceeds 1000 objects; increase the verified limit`);
    }
    if (page.next === null) break;
    assert.ok(page.items.length > 0 && page.next === after,
      `${collection.source} original pagination did not advance`);
  }
  return { through, items };
}

export function materialIndex(gu) {
  return collectionIndex('codepi-gu', gu);
}

export async function backupCollectionMaterial(source, row, publicKey, createdAt, { binding, bucket, prefix }) {
  const collection = originalCollection(source);
  const metadata = { kind: collection.kind, material_id: row.id, object_key: row.object_key,
    source_bytes: row.size, source_sha256: row.sha256, created_at: createdAt };
  const file = originalFileName(collection, row.id);
  return backupStream(metadata, publicKey, {
    bucket, key: `${prefix}/materials/${file}`, file, label: `${collection.source} original`,
    maxBytes: MAX_MATERIAL_BYTES,
    expectedBytes: row.size, expectedSha256: row.sha256,
    async open() {
      try { return await binding.readMaterial(row.id); }
      catch { throw new Error(`${collection.source} original is unavailable`); }
    },
  });
}

export function backupMaterial(row, publicKey, createdAt, { gu, bucket, prefix }) {
  return backupCollectionMaterial('codepi-gu', row, publicKey, createdAt, { binding: gu, bucket, prefix });
}
