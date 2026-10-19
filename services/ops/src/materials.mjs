import assert from 'node:assert/strict';
import { backupStream } from './backup.mjs';

export const MAX_MATERIALS = 1000;
const MAX_MATERIAL_BYTES = 8 * 1024 * 1024;
const uuid = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/;

export async function materialIndex(gu) {
  assert.ok(gu?.listMaterials && gu?.readMaterial, 'GU material backup binding is required');
  const items = [], ids = new Set();
  let after = 0, through;
  for (;;) {
    const page = await gu.listMaterials(after, through);
    assert.ok(Number.isSafeInteger(page?.through) && page.through >= after
      && (through === undefined || through === page.through), 'GU material snapshot changed');
    through = page.through;
    assert.ok(Array.isArray(page.items) && page.items.length <= 100, 'invalid GU material page');
    for (const row of page.items) {
      assert.ok(Number.isSafeInteger(row.cursor) && row.cursor > after && row.cursor <= through
        && uuid.test(row.id) && row.object_key === `materials/${row.id}` && !ids.has(row.id)
        && Number.isSafeInteger(row.size) && row.size > 0 && row.size <= MAX_MATERIAL_BYTES
        && /^[a-f0-9]{64}$/.test(row.sha256), 'invalid GU material index');
      after = row.cursor;
      ids.add(row.id);
      items.push({ id: row.id, object_key: row.object_key, size: row.size, sha256: row.sha256 });
      assert.ok(items.length <= MAX_MATERIALS, 'GU material backup exceeds 1000 objects; increase the verified limit');
    }
    if (page.next === null) break;
    assert.ok(page.items.length > 0 && page.next === after, 'GU material pagination did not advance');
  }
  return { through, items };
}

export async function backupMaterial(row, publicKey, createdAt, { gu, bucket, prefix }) {
  const metadata = { kind: 'gu-material', material_id: row.id, object_key: row.object_key,
    source_bytes: row.size, source_sha256: row.sha256, created_at: createdAt };
  const file = `gu-material-${row.id}.bin.enc`;
  return backupStream(metadata, publicKey, {
    bucket, key: `${prefix}/materials/${file}`, file, label: 'GU material', maxBytes: MAX_MATERIAL_BYTES,
    expectedBytes: row.size, expectedSha256: row.sha256,
    async open() {
      try { return await gu.readMaterial(row.id); }
      catch { throw new Error('GU material original is unavailable'); }
    },
  });
}
