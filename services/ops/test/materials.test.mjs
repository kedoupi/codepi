import assert from 'node:assert/strict';
import test from 'node:test';
import { materialIndex } from '../src/materials.mjs';
import { materialFixture } from './fixtures.mjs';

test('material index paginates beyond the UI limit and freezes its high water mark', async () => {
  const gu = materialFixture(Array.from({ length: 501 }, (_, i) => `Synthetic ${i}`));
  const list = gu.listMaterials.bind(gu), throughs = [];
  gu.listMaterials = async (after, through) => { throughs.push(through); return list(after, through); };
  const result = await materialIndex(gu);
  assert.equal(result.items.length, 501);
  assert.equal(result.through, 501);
  assert.deepEqual(throughs, [undefined, 501, 501, 501, 501, 501]);
});

test('empty material stores are complete, invalid or nonadvancing pages fail closed', async () => {
  assert.deepEqual(await materialIndex(materialFixture([])), { through: 0, items: [] });
  for (const mutate of [
    gu => { gu.rows[0].object_key = '../private'; },
    gu => { gu.rows[0].size = 9 * 1024 * 1024; },
    gu => { gu.rows[0].sha256 = 'invalid'; },
    gu => { gu.listMaterials = async () => ({ through: 1, items: [], next: 0 }); },
    gu => { gu.listMaterials = async () => ({ through: 1, items: [], next: undefined }); },
  ]) {
    const gu = materialFixture();
    mutate(gu);
    await assert.rejects(materialIndex(gu), /invalid|pagination/);
  }
});

test('oversized material collections fail rather than silently truncate coverage', async () => {
  await assert.rejects(materialIndex(materialFixture(Array.from({ length: 1001 }, () => 'Synthetic'))), /1000 objects/);
});
