// Build the single release manifest from the control plane and start the Ops observe session.
// Run inside the release lock after every service smoke has passed (local-release.md §4.1).
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { buildReleaseManifest } from './release-observation.mjs';
import { remoteMain } from './release-drift.mjs';
import { WORKERS } from './release-scope.mjs';
import { workerApi } from './worker-api.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
const SHA = /^[a-f0-9]{40}$/;
const NONCE = /^[a-z0-9][a-z0-9-]{0,39}$/;
const FACT_FLAGS = {
  '--migration-applied': 'migration_applied', '--secret-changed': 'secret_changed',
  '--binding-changed': 'binding_changed', '--external-side-effects': 'external_side_effects',
};

function singleActive(result, script) {
  const versions = result?.versions;
  assert.ok(Array.isArray(versions) && versions.length === 1 && versions[0]?.percentage === 100,
    `${script} must serve exactly one version at 100% before observation`);
  return versions[0].version_id;
}

function buildSha(detail, script) {
  const bindings = detail?.resources?.bindings?.filter(b => b.name === 'BUILD_SHA' && b.type === 'plain_text');
  assert.equal(bindings?.length, 1, `${script} version has no unique BUILD_SHA`);
  return bindings[0].text;
}

// Previous = the newest earlier deployment that served a different version at 100%.
export async function resolveServiceVersions(script, sha, { env = process.env, request = fetch } = {}) {
  const { deployments } = await workerApi(`${script}/deployments`, { env, request });
  assert.ok(Array.isArray(deployments) && deployments.length, `${script} has no deployments`);
  const active = singleActive(deployments[0], script);
  const activeBuild = buildSha(await workerApi(`${script}/versions/${active}`, { env, request }), script);
  assert.equal(activeBuild, sha.slice(0, 12), `${script} active BUILD_SHA ${activeBuild} is not the release ${sha.slice(0, 12)}`);
  let previous = '';
  for (const deployment of deployments.slice(1)) {
    const versions = deployment?.versions ?? [];
    const full = versions.length === 1 && versions[0]?.percentage === 100 ? versions[0].version_id : null;
    if (full && full !== active) { previous = full; break; }
  }
  const previousBuild = previous
    ? buildSha(await workerApi(`${script}/versions/${previous}`, { env, request }), script)
    : '';
  return { active, activeBuild, previous, previousBuild };
}

export function parseArgs(args) {
  const options = { services: null, facts: {}, nonce: null, dryRun: false };
  for (let i = 0; i < args.length; i++) {
    const flag = args[i];
    if (flag === '--dry-run') { options.dryRun = true; continue; }
    const value = args[++i];
    assert.ok(value !== undefined && !value.startsWith('--'), `${flag} requires a value`);
    if (flag === '--sha') options.sha = value;
    else if (flag === '--nonce') options.nonce = value;
    else if (flag === '--services') options.services = value.split(',');
    else if (Object.hasOwn(FACT_FLAGS, flag)) {
      // Each fact flag lists the services where it is true; every other service records false.
      options.facts[FACT_FLAGS[flag]] = value === 'none' ? [] : value.split(',');
    } else throw new Error(`Unknown option: ${flag}`);
  }
  assert.match(options.sha ?? '', SHA, '--sha must be the full released source SHA');
  assert.match(options.nonce ?? '', NONCE, '--nonce must be a short lowercase label');
  assert.ok(options.services?.length, '--services must list the released services');
  for (const service of options.services) assert.ok(Object.hasOwn(WORKERS, service), `unknown service: ${service}`);
  assert.equal(new Set(options.services).size, options.services.length, '--services must not repeat');
  for (const key of Object.values(FACT_FLAGS)) {
    // Facts must be declared explicitly so an omission cannot silently allow rollback.
    assert.ok(Array.isArray(options.facts[key]), `missing ${Object.keys(FACT_FLAGS).find(f => FACT_FLAGS[f] === key)} (use none)`);
    for (const service of options.facts[key]) assert.ok(options.services.includes(service), `${key} lists unreleased service ${service}`);
  }
  return options;
}

export async function prepareObservation(options, { env = process.env, request = fetch, now = () => new Date().toISOString() } = {}) {
  const services = [];
  for (const service of options.services) {
    const script = WORKERS[service];
    const v = await resolveServiceVersions(script, options.sha, { env, request });
    services.push({
      service, script, previous_version: v.previous, new_version: v.active,
      previous_build_sha: v.previousBuild, new_build_sha: options.sha, smoke: 'pass',
      ...Object.fromEntries(Object.entries(options.facts).map(([key, list]) => [key, list.includes(service)])),
    });
  }
  return buildReleaseManifest({ sourceSha: options.sha, services, startedAt: now(), nonce: options.nonce });
}

export function triggerObservation(manifest, { cwd = root, execute = spawnSync } = {}) {
  const payload = JSON.stringify({ kind: 'observe', release_id: manifest.release_id, manifest });
  const result = execute('pnpm', ['exec', 'wrangler', 'workflows', 'trigger', 'codepi-ops', payload], {
    cwd: path.join(cwd, 'services/ops'), encoding: 'utf8',
    env: { ...process.env, CI: 'true', WRANGLER_SEND_METRICS: 'false' }, stdio: ['ignore', 'pipe', 'pipe'],
  });
  assert.ok(!result.error && result.status === 0, `observe trigger failed (exit ${result.status ?? 'unavailable'})`);
  const instance = String(result.stdout).match(/instance "([^"]+)"/)?.[1];
  assert.ok(instance, 'observe trigger did not report a Workflow instance id');
  return instance;
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  try {
    const options = parseArgs(process.argv.slice(2));
    // Docs-only commits may land after a release; the released SHA must still be on main.
    const main = remoteMain(root);
    assert.equal(spawnSync('git', ['merge-base', '--is-ancestor', options.sha, main], { cwd: root }).status, 0,
      'released SHA must be an ancestor of current remote main');
    const manifest = await prepareObservation(options);
    const summary = manifest.services.map(s => ({ service: s.service, previous: s.previous_version, new: s.new_version, rollback_allowed: s.rollback_allowed }));
    if (options.dryRun) {
      console.log(JSON.stringify({ release_id: manifest.release_id, services: summary, triggered: false }));
    } else {
      const instance = triggerObservation(manifest);
      console.log(JSON.stringify({ release_id: manifest.release_id, instance, services: summary }));
    }
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
