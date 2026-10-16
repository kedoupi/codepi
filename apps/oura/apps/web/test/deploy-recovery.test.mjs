import assert from 'node:assert/strict';
import { test } from 'node:test';
import { shouldRetryQuotaDeployment } from '../../../scripts/retry-quota-deploy.mjs';

test('deployment recovery retries only the explicit Oura migration quota failure', () => {
  const run = { status: 'completed', conclusion: 'failure', headBranch: 'main' };
  const message = "health-api-deploy-production\tDeploy API before publishing its frontend\tYour account has exceeded D1's free tier daily row write limit.";
  assert.equal(shouldRetryQuotaDeployment(run, message), true);
  assert.equal(shouldRetryQuotaDeployment({ ...run, status: 'in_progress' }, message), false);
  assert.equal(shouldRetryQuotaDeployment({ ...run, conclusion: 'success' }, message), false);
  assert.equal(shouldRetryQuotaDeployment({ ...run, headBranch: 'feature' }, message), false);
  assert.equal(shouldRetryQuotaDeployment(run, message.replace('Deploy API before publishing its frontend', 'publish frontend')), false);
  assert.equal(shouldRetryQuotaDeployment(run, message.replace('Deploy API before publishing its frontend', 'Run pnpm test')), false);
  assert.equal(shouldRetryQuotaDeployment(run, 'Migration failed: SQL syntax error'), false);
  assert.equal(shouldRetryQuotaDeployment(undefined, message), false);
});
