import assert from 'node:assert/strict';
import test from 'node:test';
import { classifySeverity, runObserver, transitionState } from '../src/observer.mjs';

const manifest = { release_id: 'rel-test', services: [{ service: 'api', script: 'api', previous_version: 'old', new_version: 'new', rollback_allowed: true }] };
function bucket() { const data = new Map(); return { data, async put(key, value) { data.set(key, String(value)); } }; }
function fakeClient(metrics) { return { async queryWorkerMetrics() { return metrics; }, async listIssues() { return []; } }; }
const active = async () => 'new';
// Mirrors the Workflows contract: sleep(name, duration) and do(name, [options], fn).
const sleeps = [];
const step = {
  async sleep(name, duration) {
    assert.equal(typeof name, 'string');
    assert.match(String(duration), /^\d+ minutes$/);
    sleeps.push([name, duration]);
  },
  async do(_name, options, fn) { fn ??= options; return fn(); },
};

test('state transitions are monotonic and event-idempotent', () => {
  const seen = new Set();
  assert.equal(transitionState('observing', 'degraded_notified', 'e1', seen).state, 'degraded_notified');
  assert.equal(transitionState('degraded_notified', 'observing', 'e2', seen).state, 'observing');
  assert.equal(transitionState('observing', 'degraded_notified', 'e2', seen).changed, false);
  assert.equal(transitionState('healthy_reported', 'observing', 'e3', seen).state, 'healthy_reported');
});

test('severity boundaries require invocation and consecutive critical evidence', () => {
  assert.equal(classifySeverity({ metrics: { invocations: 19, errors: 19, errorRate: .20 }, criticalRounds: 2 }), 'healthy');
  assert.equal(classifySeverity({ metrics: { invocations: 20, errors: 1, errorRate: .05 }, baseline: {} }), 'degraded');
  assert.equal(classifySeverity({ metrics: { invocations: 20, errors: 20, errorRate: .20 }, criticalRounds: 0 }), 'degraded');
  assert.equal(classifySeverity({ metrics: { invocations: 20, errors: 20, errorRate: .20 }, criticalRounds: 1 }), 'critical');
});

test('version mismatch is immediately critical and rollback can be blocked', async () => {
  const b = bucket();
  const result = await runObserver({ manifest: { ...manifest, services: [{ ...manifest.services[0], rollback_allowed: false }] }, bucket: b, step, observability: fakeClient({ invocations: 20, errors: 0, errorRate: 0 }), activeVersionCheck: async () => 'wrong', notify: async () => {} });
  assert.equal(result.state, 'rollback_blocked');
  assert.match([...b.data.values()].join('\n'), /critical_detected/);
});

test('notification failure does not stop observation and reports contain no secrets', async () => {
  const b = bucket();
  const result = await runObserver({ manifest, bucket: b, step, observability: fakeClient({ invocations: 20, errors: 1, errorRate: .05 }), activeVersionCheck: active, notify: async () => { throw new Error('forbidden?token=secret'); } });
  assert.equal(result.state, 'healthy_reported');
  const reports = [...b.data.values()].join('\n');
  assert.doesNotMatch(reports, /secret|token=secret|PRIVATE KEY|SELECT .* FROM/i);
});

test('waits between the seven polls with uniquely named Workflow sleeps', async () => {
  sleeps.length = 0;
  await runObserver({ manifest, bucket: bucket(), step, observability: fakeClient(null), activeVersionCheck: active, notify: async () => {} });
  assert.equal(sleeps.length, 6);
  assert.equal(new Set(sleeps.map(([name]) => name)).size, 6);
  assert.ok(sleeps.every(([, duration]) => duration === '5 minutes'));
});
