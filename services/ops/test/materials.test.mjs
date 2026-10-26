import assert from 'node:assert/strict';
import test from 'node:test';
import { collectionIndex, materialIndex } from '../src/materials.mjs';
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

test('blog media uses lowercase UUID identity and the media/ key namespace', async () => {
  const blog = materialFixture(['Synthetic blog image'], { prefix: 'media' });
  assert.deepEqual((await collectionIndex('codepi-blog', blog)).items.map(row => row.object_key),
    [`media/${blog.rows[0].id}`]);
  for (const mutate of [
    binding => { binding.rows[0].id = '01J00000000000000000000001'; binding.rows[0].object_key = `media/${binding.rows[0].id}`; },
    binding => { binding.rows[0].object_key = `imports/${binding.rows[0].id}`; },
    binding => { binding.rows[0].id = `${binding.rows[0].id}ff`; binding.rows[0].object_key = `media/${binding.rows[0].id}`; },
  ]) {
    const binding = materialFixture(['Synthetic blog image'], { prefix: 'media' });
    mutate(binding);
    await assert.rejects(collectionIndex('codepi-blog', binding), /invalid codepi-blog original index/);
  }
});

test('Me imports use their ULID identity and imports/ key namespace without accepting GU identities', async () => {
  const me = materialFixture(['Synthetic Me import'], { prefix: 'imports', idKind: 'ulid' });
  assert.deepEqual((await collectionIndex('codepi-me', me)).items.map(row => row.object_key),
    [`imports/${me.rows[0].id}`]);
  for (const mutate of [
    binding => { binding.rows[0].id = '00000000-0000-4000-8000-000000000001'; },
    binding => { binding.rows[0].object_key = `materials/${binding.rows[0].id}`; },
    binding => { binding.listMaterials = async () => ({
      through: 1, items: [{ ...binding.rows[0], object_key: '../imports/escape', bytes: undefined }], next: null,
    }); },
  ]) {
    const binding = materialFixture(['Synthetic Me import'], { prefix: 'imports', idKind: 'ulid' });
    mutate(binding);
    await assert.rejects(collectionIndex('codepi-me', binding), /invalid codepi-me original index/);
  }
});
