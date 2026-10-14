import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

export function shouldRetryQuotaDeployment(run, failedLog) {
  return run?.status === 'completed' && run.conclusion === 'failure'
    && run.headBranch === 'main'
    && /oura\s+Deploy API before publishing its frontend.*D1's free tier daily row write limit/.test(failedLog);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const gh = args => execFileSync('gh', args, { encoding: 'utf8', maxBuffer: 10 * 1024 * 1024 });
  const [run] = JSON.parse(gh(['run', 'list', '--workflow', 'deploy-product-apps.yml',
    '--branch', 'main', '--limit', '1', '--json', 'databaseId,status,conclusion,headBranch']));
  const log = run?.status === 'completed' && run.conclusion === 'failure'
    ? gh(['run', 'view', String(run.databaseId), '--log-failed']) : '';
  if (shouldRetryQuotaDeployment(run, log)) {
    gh(['run', 'rerun', String(run.databaseId), '--failed']);
    console.log(`Requested quota-reset retry for deployment ${run.databaseId}`);
  } else {
    console.log('No completed Oura deployment blocked by D1 daily write quota; nothing to retry.');
  }
}
