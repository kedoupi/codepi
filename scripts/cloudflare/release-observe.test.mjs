import assert from 'node:assert/strict';
import test from 'node:test';
import { parseArgs, prepareObservation, resolveServiceVersions, triggerObservation } from './release-observe.mjs';

const SHA = '7d0c81416a61601123fcde87d140b4980fb21105';
const OLD = '08bdfeded1964f9df915d881c1e1e6753e7d4051';
const env = { CLOUDFLARE_ACCOUNT_ID: 'acct', CLOUDFLARE_API_TOKEN: 'synthetic-token' };
const ok = result => Response.json({ success: true, result });
const deployment = id => ({ versions: [{ version_id: id, percentage: 100 }] });
const version = build => ({ resources: { bindings: [{ name: 'BUILD_SHA', type: 'plain_text', text: build }] } });

function controlPlane(scripts) {
  return async url => {
    const [, script, kind, id] = url.match(/workers\/scripts\/([^/]+)\/(deployments|versions)(?:\/([^/?]+))?/);
    const s = scripts[script];
    if (kind === 'deployments') return ok({ deployments: s.deployments });
    return ok(version(s.builds[id]));
  };
}

const allNone = ['--migration-applied', 'none', '--secret-changed', 'none', '--binding-changed', 'none', '--external-side-effects', 'none'];

test('resolves the active release version and the previous full-traffic version', async () => {
  const request = controlPlane({ 'codepi-gu': {
    deployments: [deployment('new'), deployment('new'), { versions: [{ version_id: 'mid', percentage: 50 }, { version_id: 'new', percentage: 50 }] }, deployment('old')],
    builds: { new: SHA.slice(0, 12), old: OLD.slice(0, 12) },
  } });
  const result = await resolveServiceVersions('codepi-gu', SHA, { env, request });
  assert.deepEqual(result, { active: 'new', activeBuild: SHA.slice(0, 12), previous: 'old', previousBuild: OLD.slice(0, 12) });
});

test('refuses to observe a service that is not running the released build or is split', async () => {
  await assert.rejects(resolveServiceVersions('codepi-gu', SHA, { env, request: controlPlane({ 'codepi-gu': {
    deployments: [deployment('new')], builds: { new: OLD.slice(0, 12) },
  } }) }), /not the release/);
  await assert.rejects(resolveServiceVersions('codepi-gu', SHA, { env, request: controlPlane({ 'codepi-gu': {
    deployments: [{ versions: [{ version_id: 'a', percentage: 90 }, { version_id: 'b', percentage: 10 }] }], builds: {},
  } }) }), /exactly one version/);
});

test('facts must be declared for every flag and only for released services', () => {
  assert.throws(() => parseArgs(['--sha', SHA, '--nonce', 'r1', '--services', 'gu']), /missing --migration-applied/);
  assert.throws(() => parseArgs(['--sha', SHA, '--nonce', 'r1', '--services', 'gu', ...allNone.slice(0, 6), '--external-side-effects', 'web']), /unreleased service/);
  assert.throws(() => parseArgs(['--sha', SHA.slice(0, 12), '--nonce', 'r1', '--services', 'gu', ...allNone]), /full released/);
  assert.throws(() => parseArgs(['--sha', SHA, '--nonce', 'r1', '--services', 'nope', ...allNone]), /unknown service/);
  const options = parseArgs(['--sha', SHA, '--nonce', 'r1', '--services', 'gu,health-api', ...allNone.slice(0, 1), 'health-api', ...allNone.slice(2), '--dry-run']);
  assert.deepEqual(options.facts.migration_applied, ['health-api']);
  assert.equal(options.dryRun, true);
});

test('builds one manifest whose rollback permission follows the declared facts', async () => {
  const builds = { new: SHA.slice(0, 12), old: OLD.slice(0, 12) };
  const request = controlPlane({
    'codepi-gu': { deployments: [deployment('new'), deployment('old')], builds },
    'codepi-health-api': { deployments: [deployment('new'), deployment('old')], builds },
  });
  const options = parseArgs(['--sha', SHA, '--nonce', 'r1', '--services', 'gu,health-api', '--migration-applied', 'health-api', ...allNone.slice(2)]);
  const manifest = await prepareObservation(options, { env, request, now: () => '2026-10-25T00:00:00.000Z' });
  assert.equal(manifest.release_id, `release-${SHA.slice(0, 12)}-r1`);
  assert.deepEqual(manifest.services.map(s => [s.service, s.previous_version, s.rollback_allowed]), [['gu', 'old', true], ['health-api', 'old', false]]);
});

test('trigger passes the manifest as the observe payload and requires an instance id', () => {
  const manifest = { release_id: 'release-x-r1', services: [] };
  let seen;
  const instance = triggerObservation(manifest, { cwd: '/repo', execute: (cmd, args, opts) => {
    seen = { cmd, args, cwd: opts.cwd };
    return { status: 0, stdout: 'Workflow instance "cf_abc" has been queued successfully' };
  } });
  assert.equal(instance, 'cf_abc');
  assert.equal(seen.cwd, '/repo/services/ops');
  assert.deepEqual(JSON.parse(seen.args.at(-1)), { kind: 'observe', release_id: 'release-x-r1', manifest });
  assert.throws(() => triggerObservation(manifest, { execute: () => ({ status: 0, stdout: 'nothing' }) }), /instance id/);
  assert.throws(() => triggerObservation(manifest, { execute: () => ({ status: 1, stdout: '' }) }), /trigger failed/);
});
