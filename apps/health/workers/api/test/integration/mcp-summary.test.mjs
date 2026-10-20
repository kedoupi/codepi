import assert from 'node:assert/strict';
import { test } from 'node:test';
import { HealthMcp } from './node-worker.mjs';

function today() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date());
}

function fixture(owner) {
  const queries = [];
  const env = {
    PERSONAL_OWNER_ID: owner,
    DB: {
      prepare(sql) {
        queries.push(sql);
        return {
          bind() {
            return {
              all: async () => ({ results: [{
                day: today(),
                payload: JSON.stringify({ sleep: { score: 80 }, readiness: { score: 70 }, activity: { steps: 7000 } }),
              }] }),
              first: async () => ({ synced_at: new Date().toISOString(), last_error: null }),
            };
          },
        };
      },
    },
  };
  return { env, queries };
}

test('HealthMcp.summary enforces the fixed owner and omits privateMetric', async () => {
  const denied = fixture('test-owner');
  const deniedRpc = new HealthMcp({}, denied.env);
  assert.equal((await deniedRpc.summary('other-owner')).status, 'unavailable');
  assert.equal(denied.queries.length, 0);

  const allowed = fixture('test-owner');
  const rpc = new HealthMcp({}, allowed.env);
  const summary = await rpc.summary('kdp-owner');
  assert.equal(summary.source, 'health');
  assert.equal(summary.status, 'ok');
  assert.equal('privateMetric' in summary, false);
  assert.equal(summary.metrics.some(metric => metric.label === '睡眠评分'), true);
  assert.equal(allowed.queries.every(sql => /daily_cache|sync_state/.test(sql)), true);
});

test('HealthMcp.summary fails closed for dev-local and unconfigured owners', async () => {
  for (const owner of ['dev-local', undefined]) {
    const f = fixture(owner);
    const rpc = new HealthMcp({}, f.env);
    const summary = await rpc.summary('kdp-owner');
    assert.equal(summary.status, 'unavailable');
    assert.equal(f.queries.length, 0);
  }
});
