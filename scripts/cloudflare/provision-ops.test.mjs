import assert from 'node:assert/strict';
import test from 'node:test';
import { provisionOps } from './provision-ops.mjs';

const env = { CLOUDFLARE_ACCOUNT_ID: '69f1de4c8f3c7411593613711207e7b3', CLOUDFLARE_API_TOKEN: 'broad-synthetic' };
const ok = result => Response.json({ success: true, result });

test('Ops receives a dedicated runtime token with no Worker write or token-creation permissions', async () => {
  const calls = [];
  const result = await provisionOps('credentials', { env, request: async (url, init) => {
    calls.push({ path: new URL(url).pathname, method: init.method, body: init.body && JSON.parse(init.body) });
    if (url.endsWith('/secrets') && init.method === 'GET') return ok([]);
    if (url.endsWith('/tokens') && init.method === 'GET') return ok([]);
    if (url.endsWith('/permission_groups')) return ok([
      { name: 'D1 Write', id: 'd1', is_selectable: true },
      { name: 'Workers Scripts Read', id: 'workers', is_selectable: true },
      { name: 'Workers Scripts Write', id: 'write', is_selectable: true },
    ]);
    if (url.endsWith('/tokens')) return ok({ id: 'token-id', value: 'dedicated-synthetic' });
    return ok({});
  } });
  const policy = calls.find(call => call.path.endsWith('/tokens') && call.method === 'POST').body.policies[0];
  assert.deepEqual(policy.permission_groups, [{ id: 'd1' }, { id: 'workers' }]);
  assert.equal(calls.at(-1).body.text, 'dedicated-synthetic');
  assert.doesNotMatch(JSON.stringify(result), /broad-synthetic|dedicated-synthetic/);
  let callsWithoutRotation = 0;
  const existing = await provisionOps('credentials', { env, request: async () => {
    callsWithoutRotation++;
    return ok([{ name: 'CLOUDFLARE_API_TOKEN' }]);
  } });
  assert.equal(callsWithoutRotation, 1);
  assert.match(existing.runtime_token, /not rotated/);
});

test('Ops storage initialization targets only its private bucket and bounded backup/report retention', async () => {
  const calls = [];
  await provisionOps('storage', { env, request: async (url, init) => {
    calls.push({ path: new URL(url).pathname, body: init.body && JSON.parse(init.body) });
    return ok(url.endsWith('/buckets') && init.method === 'GET' ? { buckets: [{ name: 'unrelated' }] } : {});
  } });
  assert.deepEqual(calls[1].body, { name: 'codepi-ops-backups' });
  assert.deepEqual(calls[2].body, { enabled: false });
  assert.ok(calls[3].body.rules.every(rule => rule.deleteObjectsTransition.condition.maxAge === 14 * 86400));
  await assert.rejects(provisionOps('storage', { env: { ...env, CLOUDFLARE_ACCOUNT_ID: 'other' } }), /registered/);
});
