import assert from 'node:assert/strict';
import test from 'node:test';
import { affectedWorkers, WORKERS } from './release-scope.mjs';

test('notify source changes affect only notify', () => {
  assert.deepEqual(affectedWorkers(['services/notify/src/index.ts']), ['notify']);
});

test('shared notification contract changes affect notify without widening all Workers', () => {
  assert.deepEqual(affectedWorkers(['packages/shared/notify/contract.ts']), ['notify']);
  assert.deepEqual(affectedWorkers(['packages/shared/email/notification.ts']), ['notify']);
});

test('notify is registered as a Worker', () => {
  assert.equal(WORKERS.notify, 'codepi-notify');
});
