import { execFileSync } from 'node:child_process';
import { appendFileSync } from 'node:fs';
import { ciPlan } from './check-plan.mjs';
import { pathToFileURL } from 'node:url';
import path from 'node:path';

function git(args) {
  return execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}

export function main(args = process.argv.slice(2)) {
  let base, output;
  for (let index = 0; index < args.length; index++) {
    if (args[index] === '--base' && args[index + 1]) base = args[++index];
    else if (args[index] === '--output' && args[index + 1]) output = args[++index];
    else throw new Error('Usage: node scripts/agent/ci-plan.mjs [--base SHA] [--output PATH]');
  }
  if (!base) {
    const event = process.env.GITHUB_EVENT_NAME;
    if (!['push', 'workflow_dispatch'].includes(event)) throw new Error('Use --base for pull requests and local previews.');
    base = event === 'push' ? process.env.GITHUB_SHA : 'HEAD';
  }
  const commit = git(['rev-parse', '--verify', '--end-of-options', `${base}^{commit}`]).trim();
  const files = git(['diff', '--name-only', '-z', '--no-renames', `${commit}...HEAD`, '--']).split('\0').filter(Boolean);
  const plan = ciPlan(files);
  const values = {
    plan: JSON.stringify(plan),
    jobs: JSON.stringify(plan.jobs),
    has_jobs: String(plan.jobs.length > 0),
    manual: String(plan.manual.length > 0),
    shared_auth: String(plan.sharedAuth),
    governance: String(plan.governance),
    workflow: String(plan.workflow),
    migrations: String(plan.migrations),
  };
  if (output) for (const [name, value] of Object.entries(values)) appendFileSync(output, `${name}=${value}\n`);
  console.log(JSON.stringify(plan, null, 2));
  return plan.manual.length ? 2 : 0;
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  try { process.exitCode = main(); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
