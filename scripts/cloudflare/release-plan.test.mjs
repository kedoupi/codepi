import assert from 'node:assert/strict';
import test from 'node:test';
import { releasePlan } from './release-plan.mjs';
import { WORKERS } from './release-scope.mjs';

test('release plan is read-only and follows service dependencies', () => {
  const plan = releasePlan(['apps/web/worker/blog.ts', 'services/mcp/src/modules.ts', 'apps/health/workers/api/src/app.ts']);
  assert.equal(plan.read_only, true);
  assert.deepEqual(plan.services, ['web', 'health-api', 'mcp']);
  assert.equal(plan.steps.find(step => step.service === 'mcp').dependency, 'Publish and accept Web/Blog before MCP.');
});

test('release plan distinguishes Health workers and reports migrations', () => {
  const plan = releasePlan(['apps/health/apps/web/src/main.ts']);
  assert.deepEqual(plan.services, ['health-web']);
  assert.equal(plan.steps[0].migration, null);
  assert.match(releasePlan(['apps/gu/migrations/0004_example.sql']).steps[0].migration, /apps\/gu\/migrations/);
});

test('release plan includes Rhythm with its migrations and keeps every Worker in the order', () => {
  const plan = releasePlan(['apps/rhythm/worker/index.ts', 'services/auth/src/index.ts']);
  assert.ok(plan.services.indexOf('auth') < plan.services.indexOf('rhythm'), 'Auth (SSO client) before Rhythm');
  const step = plan.steps.find(entry => entry.service === 'rhythm');
  assert.equal(step.worker, 'codepi-rhythm');
  assert.equal(step.directory, 'apps/rhythm');
  assert.match(step.migration, /apps\/rhythm\/migrations/);
  // Every registered Worker must appear in the ordering table, or the plan would silently drop it.
  assert.deepEqual([...releasePlan(['services/auth/src/index.ts']).services].sort(), Object.keys(WORKERS).sort());
});
