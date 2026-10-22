import test from 'node:test';
import assert from 'node:assert/strict';
import {
  OBSERVATION_POLL_OFFSETS_MINUTES,
  buildReleaseManifest,
  validateReleaseManifest,
} from './release-observation.mjs';

const service = {
  service: 'health-api', script: 'codepi-health-api', previous_version: 'old',
  new_version: 'new', previous_build_sha: 'oldsha', new_build_sha: 'newsha',
  smoke: 'pass', migration_applied: false, secret_changed: false,
  binding_changed: false, external_side_effects: false,
};

test('builds the fixed observation window and derives rollback permission', () => {
  const manifest = buildReleaseManifest({
    sourceSha: 'newsha', services: [service], startedAt: '2026-10-23T00:00:00.000Z', nonce: 'n1',
  });
  assert.deepEqual(manifest.poll_offsets_minutes, OBSERVATION_POLL_OFFSETS_MINUTES);
  assert.equal(manifest.observation_window_minutes, 30);
  assert.equal(manifest.services[0].rollback_allowed, true);
});

test('blocks rollback when any unsafe change or no previous version exists', () => {
  for (const key of ['migration_applied', 'secret_changed', 'binding_changed', 'external_side_effects']) {
    const manifest = buildReleaseManifest({
      sourceSha: 'newsha', services: [{ ...service, [key]: true }],
      startedAt: '2026-10-23T00:00:00.000Z', nonce: 'n2',
    });
    assert.equal(manifest.services[0].rollback_allowed, false, key);
  }
  const manifest = buildReleaseManifest({
    sourceSha: 'newsha', services: [{ ...service, previous_version: '' }],
    startedAt: '2026-10-23T00:00:00.000Z', nonce: 'n3',
  });
  assert.equal(manifest.services[0].rollback_allowed, false);
});

test('validation rejects tampering, malformed entries and sensitive fields', () => {
  const manifest = buildReleaseManifest({
    sourceSha: 'newsha', services: [service], startedAt: '2026-10-23T00:00:00.000Z', nonce: 'n4',
  });
  assert.throws(() => validateReleaseManifest({ ...manifest, observation_window_minutes: 31 }));
  assert.throws(() => validateReleaseManifest({ ...manifest, services: [{ ...manifest.services[0], rollback_allowed: false }] }));
  assert.throws(() => buildReleaseManifest({
    sourceSha: 'newsha', services: [{ ...service, sql: 'SELECT 1' }],
    startedAt: '2026-10-23T00:00:00.000Z', nonce: 'n5',
  }));
});
