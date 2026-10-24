import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createRuntime } from './runtime.mjs';

test('health probe accepts GET and rejects other methods', async t => {
  const runtime = createRuntime();
  t.after(() => runtime.dispose());
  await runtime.ready;
  const origin = 'https://oura.example';

  const ok = await runtime.dispatchFetch(`${origin}/api/health`);
  assert.equal(ok.status, 200);
  assert.equal((await ok.json()).ok, true);

  for (const method of ['POST', 'PUT', 'PATCH', 'DELETE', 'HEAD']) {
    const response = await runtime.dispatchFetch(`${origin}/api/health`, { method });
    assert.equal(response.status, 405, method);
    if (method !== 'HEAD') assert.equal((await response.json()).error, 'method_not_allowed');
  }
});
