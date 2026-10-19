import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { githubApi } from '../../../scripts/cloudflare/github-api.mjs';
import { objectDigest } from './backup.mjs';

export async function offsiteRelease(manifest, prefix, bucket, { token, request = fetch } = {}) {
  assert.ok(token, 'GITHUB_TOKEN with repository Contents write access is required for offsite backup');
  const api = (endpoint, options = {}) => githubApi(endpoint, { token, request, ...options });
  const tag = `ops-backup-${prefix.split('/').at(-1)}`;
  let release = await api(`/releases/tags/${tag}`, { allow404: true });
  if (!release) release = await api('/releases', { method: 'POST', body: {
    tag_name: tag, target_commitish: 'main', name: tag, prerelease: true, make_latest: 'false',
    body: 'Encrypted CodePi D1 backup. Complete only when manifest.json and all matching ciphertext assets are present.',
  } });
  assert.ok(Number.isSafeInteger(release?.id) && release.id > 0 && release.tag_name === tag,
    'GitHub returned a mismatched backup release');
  const assets = [];
  for (let page = 1; page <= 2; page++) {
    const batch = await api(`/releases/${release.id}/assets?per_page=100&page=${page}`);
    assert.ok(Array.isArray(batch), 'GitHub release assets unavailable');
    assets.push(...batch);
    if (batch.length < 100) break;
    assert.ok(page < 2, 'too many assets in backup release');
  }
  // Manifest is uploaded last, so a partially transferred release cannot look complete.
  const files = [...manifest.databases.map(entry => entry.file), 'manifest.json'];
  for (const file of files) {
    assert.ok(file === 'manifest.json' || /^codepi-[a-z]+\.sql\.enc$/.test(file), 'invalid backup filename');
    const object = await bucket.get(`${prefix}/${file}`);
    assert.ok(object, 'R2 backup object missing during offsite copy');
    const hash = await objectDigest(object);
    const expected = file === 'manifest.json'
      ? createHash('sha256').update(JSON.stringify(manifest)).digest('hex')
      : manifest.databases.find(entry => entry.file === file)?.sha256;
    assert.equal(hash, expected, 'R2 backup does not match the complete manifest');
    const digest = `sha256:${hash}`;
    const existing = assets.filter(asset => asset.name === file);
    assert.ok(existing.length <= 1, 'duplicate GitHub backup asset');
    if (existing.length) {
      assert.ok(existing[0].state === 'uploaded' && existing[0].digest === digest,
        'GitHub backup asset cannot be verified; preserve it for investigation');
      continue;
    }
    const upload = await bucket.get(`${prefix}/${file}`);
    assert.ok(upload?.etag === object.etag && upload?.size === object.size,
      'R2 backup object changed before offsite copy');
    const asset = await api(`/releases/${release.id}/assets?name=${encodeURIComponent(file)}`, {
      method: 'POST', upload: true, body: upload.body, contentLength: upload.size,
    });
    assert.ok(asset?.state === 'uploaded' && asset.name === file && asset.digest === digest,
      'GitHub backup upload did not confirm its digest');
  }
  return { release_id: release.id, tag, assets: files.length };
}
