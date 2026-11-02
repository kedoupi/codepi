import assert from 'node:assert/strict';
import test from 'node:test';
import { releasePlan } from './release-plan.mjs';

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
