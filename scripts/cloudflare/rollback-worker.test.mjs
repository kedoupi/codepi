import assert from 'node:assert/strict';
import test from 'node:test';
import { cloudflareApi, rollbackWorker } from './rollback-worker.mjs';

const deployment = version => ({ deployments: [{ versions: [{ version_id: version, percentage: 100 }] }] });

test('rejects redirects without following or leaking provider content', async () => {
  let calls = 0;
  const api = cloudflareApi({
    env: { CLOUDFLARE_ACCOUNT_ID: 'synthetic-account', CLOUDFLARE_ROLLBACK_TOKEN: 'synthetic-rollback-token' },
    request: async (url, init) => {
      calls++;
      assert.equal(init.redirect, 'manual');
      return Response.json({ success: false, errors: [{ message: 'private-provider-content' }] },
        { status: 302, headers: { location: 'https://other.synthetic/' } });
    },
  });
  await assert.rejects(api('/workers/scripts/codepi-ops/deployments'), error => {
    assert.match(error.message, /HTTP 302/);
    assert.doesNotMatch(error.message, /private-provider-content|synthetic-rollback-token/);
    return true;
  });
  assert.equal(calls, 1);
});

function fakeApi(sequence) {
  const calls = [];
  return {
    calls,
    api: async (endpoint, options = {}) => {
      calls.push({ endpoint, ...options });
      const response = sequence.shift();
      if (response instanceof Error) throw response;
      return response;
    },
  };
}

test('rolls back only after an atomic 100% active-version check', async () => {
  const fake = fakeApi([deployment('new-version'), {}, deployment('old-version')]);
  const result = await rollbackWorker({ script: 'codepi-ops', expectedActiveVersion: 'new-version', targetVersion: 'old-version', api: fake.api });
  assert.equal(result.active_version, 'old-version');
  assert.equal(fake.calls[1].method, 'POST');
  assert.deepEqual(fake.calls[1].body, { strategy: 'percentage', versions: [{ version_id: 'old-version', percentage: 100 }] });
  assert.ok(fake.calls.every(call => !Object.hasOwn(call.body ?? {}, 'force')));
});

test('rejects an unexpected active version without posting', async () => {
  const fake = fakeApi([deployment('other-version')]);
  await assert.rejects(rollbackWorker({ script: 'codepi-ops', expectedActiveVersion: 'new-version', targetVersion: 'old-version', api: fake.api }), /changed/);
  assert.equal(fake.calls.length, 1);
});

test('rejects split traffic without posting', async () => {
  const fake = fakeApi([{ deployments: [{ versions: [
    { version_id: 'new-version', percentage: 50 }, { version_id: 'other-version', percentage: 50 },
  ] }] }]);
  await assert.rejects(rollbackWorker({ script: 'codepi-ops', expectedActiveVersion: 'new-version', targetVersion: 'old-version', api: fake.api }), /100%/);
  assert.equal(fake.calls.length, 1);
});

test('fails closed when the post-rollback active version is wrong', async () => {
  const fake = fakeApi([deployment('new-version'), {}, deployment('other-version')]);
  await assert.rejects(rollbackWorker({ script: 'codepi-ops', expectedActiveVersion: 'new-version', targetVersion: 'old-version', api: fake.api }), /did not become active/);
  assert.equal(fake.calls.length, 3);
});
