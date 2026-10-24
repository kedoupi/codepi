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

test('severity derives an effective error rate when metrics omit errorRate', () => {
  assert.equal(classifySeverity({ metrics: { invocations: 20, errors: 1 }, criticalRounds: 0 }), 'degraded');
  assert.equal(classifySeverity({ metrics: { invocations: 20, errors: 20 }, criticalRounds: 1 }), 'critical');
  assert.equal(classifySeverity({ metrics: { invocations: 20, errors: 20, errorRate: .01 }, criticalRounds: 1 }), 'healthy');
});

test('runObserver derives missing error rate for degraded and critical outcomes', async () => {
  const degradedBucket = bucket();
  const degraded = await runObserver({
    manifest,
    bucket: degradedBucket,
    step,
    observability: fakeClient({ invocations: 20, errors: 1 }),
    activeVersionCheck: active,
    notify: async () => {},
  });
  assert.equal(degraded.state, 'degraded_reported');
  const degradedPoll = JSON.parse(degradedBucket.data.get('reports/observer/rel-test/poll-0.json'));
  assert.equal(degradedPoll.services[0].severity, 'degraded');

  const criticalBucket = bucket();
  const criticalManifest = { ...manifest, services: [{ ...manifest.services[0], rollback_allowed: false }] };
  const critical = await runObserver({
    manifest: criticalManifest,
    bucket: criticalBucket,
    step,
    observability: fakeClient({ invocations: 20, errors: 20 }),
    activeVersionCheck: active,
    notify: async () => {},
  });
  assert.equal(critical.state, 'rollback_blocked');
  const criticalPoll = JSON.parse(criticalBucket.data.get('reports/observer/rel-test/poll-1.json'));
  assert.equal(criticalPoll.services[0].severity, 'critical');
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

test('uses a distinct event id for each degraded and critical observation round', async () => {
  const degradedNotifications = [];
  await runObserver({
    manifest,
    bucket: bucket(),
    step,
    observability: fakeClient({ invocations: 20, errors: 1, errorRate: .05 }),
    activeVersionCheck: active,
    notify: async payload => degradedNotifications.push(payload),
  });
  const degraded = degradedNotifications.filter(payload => payload.severity === 'degraded');
  assert.equal(degraded.length, 7);
  assert.deepEqual(degraded.map(payload => payload.event_id), [
    'rel-test-round-0-degraded',
    'rel-test-round-1-degraded',
    'rel-test-round-2-degraded',
    'rel-test-round-3-degraded',
    'rel-test-round-4-degraded',
    'rel-test-round-5-degraded',
    'rel-test-round-6-degraded',
  ]);
  const criticalNotifications = [];
  await runObserver({
    manifest: { ...manifest, services: [{ ...manifest.services[0], rollback_allowed: false }] },
    bucket: bucket(),
    step,
    observability: fakeClient({ invocations: 20, errors: 20, errorRate: .20 }),
    activeVersionCheck: async () => 'wrong',
    notify: async payload => criticalNotifications.push(payload),
  });
  assert.equal(criticalNotifications.find(payload => payload.severity === 'critical')?.event_id, 'rel-test-round-0-critical');
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

test('retries transient rollback failures with bounded STEP options', async () => {
  const b = bucket();
  let activeVersion = 'new';
  let attempts = 0;
  const retryingStep = {
    ...step,
    async do(name, options, fn) {
      fn ??= options;
      if (!name.startsWith('rollback ')) return fn();
      assert.equal(options.retries.limit, 2);
      let lastError;
      for (let attempt = 0; attempt <= options.retries.limit; attempt++) {
        try { return await fn(); } catch (error) { lastError = error; }
      }
      throw lastError;
    },
  };
  const result = await runObserver({
    manifest,
    bucket: b,
    step: retryingStep,
    observability: fakeClient({ invocations: 20, errors: 20, errorRate: .20 }),
    activeVersionCheck: async () => activeVersion,
    rollbackWorker: async args => {
      attempts++;
      if (attempts < 3) throw new Error('transient rollback failure');
      activeVersion = args.targetVersion;
      return { active_version: activeVersion };
    },
    rollbackApi: async () => {},
    notify: async () => {},
  });
  assert.equal(result.state, 'rollback_verified');
  assert.equal(attempts, 3);
});

test('records rollback success when POST applies before its response throws', async () => {
  const b = bucket();
  let activeVersion = 'new';
  const result = await runObserver({
    manifest,
    bucket: b,
    step,
    observability: fakeClient({ invocations: 20, errors: 20, errorRate: .20 }),
    activeVersionCheck: async () => activeVersion,
    rollbackWorker: async args => {
      activeVersion = args.targetVersion;
      throw new Error('response lost after POST');
    },
    rollbackApi: async () => {},
    notify: async () => {},
  });
  const summary = JSON.parse(b.data.get('reports/observer/rel-test/summary.json'));
  assert.equal(result.state, 'rollback_verified');
  assert.deepEqual(summary.rollback.successful_services, [{ service: 'api', script: 'api', version: 'old' }]);
  assert.deepEqual(summary.rollback.failed_services, []);
  assert.deepEqual(summary.rollback.lingering, []);
});
