import assert from 'node:assert/strict';
import test from 'node:test';
import { classifySeverity, runObserver, transitionState } from '../src/observer.mjs';

const manifest = { release_id: 'rel-test', services: [{ service: 'api', script: 'api', previous_version: 'old', new_version: 'new', rollback_allowed: true }] };
const twoServiceManifest = {
  release_id: 'rel-attribution',
  services: [
    { service: 'api', script: 'api', previous_version: 'old-api', new_version: 'new-api', rollback_allowed: true },
    { service: 'worker', script: 'worker', previous_version: 'old-worker', new_version: 'new-worker', rollback_allowed: true },
  ],
};
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

test('attributes core failures to one service and preserves low-traffic hard-failure escalation', async () => {
  const b = bucket();
  const rollbackCalls = [];
  let apiVersionChecks = 0;
  const result = await runObserver({
    manifest: twoServiceManifest,
    bucket: b,
    step,
    observability: fakeClient({ invocations: 0, errors: 0, errorRate: 0 }),
    coreCheck: async () => [{ name: 'api health endpoint', ok: false, detail: 'synthetic failure' }],
    activeVersionCheck: async script => script === 'api'
      ? (++apiVersionChecks <= 2 ? 'new-api' : 'old-api')
      : 'new-worker',
    rollbackWorker: async args => { rollbackCalls.push(args); return { active_version: args.targetVersion }; },
    rollbackApi: async () => {},
    notify: async () => {},
  });
  assert.equal(result.state, 'rollback_verified');
  assert.equal(rollbackCalls.length, 1);
  assert.equal(rollbackCalls[0].script, 'api');
  const firstPoll = JSON.parse(b.data.get('reports/observer/rel-attribution/poll-0.json'));
  const secondPoll = JSON.parse(b.data.get('reports/observer/rel-attribution/poll-1.json'));
  assert.equal(firstPoll.services.find(item => item.script === 'api').severity, 'healthy');
  assert.equal(secondPoll.services.find(item => item.script === 'api').severity, 'critical');
  assert.equal(secondPoll.services.find(item => item.script === 'worker').severity, 'healthy');
  assert.deepEqual(secondPoll.core, [{ name: 'api health endpoint', ok: false, detail: 'synthetic failure' }]);
});


test('keeps an unattributed global core failure in diagnostics without penalizing services', async () => {
  const b = bucket();
  const result = await runObserver({
    manifest: twoServiceManifest,
    bucket: b,
    step,
    observability: fakeClient({ invocations: 0, errors: 0, errorRate: 0 }),
    coreCheck: async () => [{ name: 'legacy route stays closed', ok: false, detail: 'synthetic global failure' }],
    activeVersionCheck: async script => script === 'api' ? 'new-api' : 'new-worker',
    notify: async () => {},
  });
  assert.equal(result.state, 'healthy_reported');
  const poll = JSON.parse(b.data.get('reports/observer/rel-attribution/poll-1.json'));
  assert.deepEqual(poll.services.map(item => item.severity), ['healthy', 'healthy']);
  assert.deepEqual(poll.core, [{ name: 'legacy route stays closed', ok: false, detail: 'synthetic global failure' }]);
});
test('version mismatch is immediately critical and rollback can be blocked', async () => {
  const b = bucket();
  const result = await runObserver({ manifest: { ...manifest, services: [{ ...manifest.services[0], rollback_allowed: false }] }, bucket: b, step, observability: fakeClient({ invocations: 20, errors: 0, errorRate: 0 }), activeVersionCheck: async () => 'wrong', notify: async () => {} });
  assert.equal(result.state, 'rollback_blocked');
  assert.match([...b.data.values()].join('\n'), /critical_detected/);
});

test('active version check failure is an observation degradation, not a mismatch or rollback', async () => {
  const b = bucket();
  const result = await runObserver({
    manifest,
    bucket: b,
    step,
    observability: fakeClient({ invocations: 0, errors: 0, errorRate: 0 }),
    activeVersionCheck: async () => { throw new Error('control plane unavailable'); },
    notify: async () => {},
  });
  assert.equal(result.state, 'degraded_reported');
  const poll = JSON.parse(b.data.get('reports/observer/rel-test/poll-0.json'));
  assert.equal(poll.services[0].version_mismatch, false);
  assert.equal(poll.services[0].active_version_check_failed, true);
  assert.equal(poll.services[0].severity, 'degraded');
});

test('observability query failure is reported as degraded, not healthy', async () => {
  const b = bucket();
  const result = await runObserver({
    manifest,
    bucket: b,
    step,
    observability: {
      async queryWorkerMetrics() { throw new Error('telemetry unavailable'); },
      async listIssues() { return []; },
    },
    activeVersionCheck: active,
    notify: async () => {},
  });
  assert.equal(result.state, 'degraded_reported');
  const poll = JSON.parse(b.data.get('reports/observer/rel-test/poll-0.json'));
  assert.equal(poll.services[0].observability_failed, true);
  assert.equal(poll.services[0].severity, 'degraded');
});

test('persistent degradation is reported from the final poll', async () => {
  const b = bucket();
  const notifications = [];
  const result = await runObserver({
    manifest,
    bucket: b,
    step,
    observability: fakeClient({ invocations: 20, errors: 1, errorRate: .05 }),
    activeVersionCheck: active,
    notify: async payload => notifications.push(payload),
  });
  assert.equal(result.state, 'degraded_reported');
  assert.equal(JSON.parse(b.data.get('reports/observer/rel-test/summary.json')).state, 'degraded_reported');
  assert.equal(notifications.at(-1).severity, 'degraded_reported');
});

test('notification failure does not stop observation and reports contain no secrets', async () => {
  const b = bucket();
  const result = await runObserver({ manifest, bucket: b, step, observability: fakeClient({ invocations: 20, errors: 1, errorRate: .05 }), activeVersionCheck: active, notify: async () => { throw new Error('forbidden?token=secret'); } });
  assert.equal(result.state, 'degraded_reported');
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
test('rolls back every critical service and verifies the previous versions', async () => {
  const b = bucket();
  const calls = [];
  let checks = 0;
  const result = await runObserver({
    manifest,
    bucket: b,
    step,
    observability: fakeClient({ invocations: 20, errors: 20, errorRate: .20 }),
    activeVersionCheck: async () => (++checks <= 2 ? 'new' : 'old'),
    rollbackWorker: async args => { calls.push(args); return { script: args.script, active_version: args.targetVersion }; },
    rollbackApi: async () => {},
    notify: async () => {},
  });
  assert.equal(result.state, 'rollback_verified');
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0], { script: 'api', expectedActiveVersion: 'new', targetVersion: 'old', api: calls[0].api });
  assert.match([...b.data.values()].join('\n'), /rollback_executed/);
  assert.match([...b.data.values()].join('\n'), /rollback_verified/);
});

test('summarizes partial multi-service rollback and stops after terminal state', async () => {
  sleeps.length = 0;
  const b = bucket();
  const multiManifest = {
    ...manifest,
    services: [
      ...manifest.services,
      { service: 'worker', script: 'worker', previous_version: 'worker-old', new_version: 'worker-new', rollback_allowed: true },
    ],
  };
  let apiChecks = 0;
  const result = await runObserver({
    manifest: multiManifest,
    bucket: b,
    step,
    observability: fakeClient({ invocations: 20, errors: 20, errorRate: .20 }),
    activeVersionCheck: async script => script === 'api' ? (++apiChecks === 1 ? 'new' : 'old') : 'worker-new',
    rollbackWorker: async args => {
      if (args.script === 'worker') throw new Error('worker rollback failed');
      return { script: args.script, active_version: args.targetVersion };
    },
    rollbackApi: async () => {},
    notify: async () => {},
  });
  const summary = JSON.parse(b.data.get('reports/observer/rel-test/summary.json'));
  assert.equal(result.state, 'rollback_blocked');
  assert.deepEqual(summary.rollback.successful_services.map(item => item.service), ['api']);
  assert.deepEqual(summary.rollback.successful_services.map(item => item.version), ['old']);
  assert.deepEqual(summary.rollback.failed_services.map(item => item.service), ['worker']);
  assert.equal(summary.rollback.lingering[0].service, 'worker');
  assert.equal(sleeps.length, 1);
});
test('blocks rollback when the worker or post-rollback verification fails', async () => {
  const b = bucket();
  const result = await runObserver({
    manifest,
    bucket: b,
    step,
    observability: fakeClient({ invocations: 20, errors: 20, errorRate: .20 }),
    activeVersionCheck: async () => 'new',
    rollbackWorker: async () => { throw new Error('rollback API unavailable'); },
    rollbackApi: async () => {},
    notify: async () => {},
  });
  assert.equal(result.state, 'rollback_blocked');
  const events = [...b.data.values()].join('\n');
  assert.match(events, /rollback_pending/);
  assert.match(events, /rollback_blocked/);
  assert.doesNotMatch(events, /rollback_verified/);
});
