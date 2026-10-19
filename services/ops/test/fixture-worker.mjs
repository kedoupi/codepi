import { WorkflowEntrypoint } from 'cloudflare:workers';
import { backupOperation, STEP } from '../src/operations.mjs';

// Local-only entrypoint. Production has no HTTP operation endpoint.
STEP.retries.limit = 0;
export class SyntheticWorkflow extends WorkflowEntrypoint {
  run(event, step) {
    const env = { ...this.env, ...(event.payload?.withGithub ? { GITHUB_TOKEN: 'synthetic-token' } : {}) };
    return backupOperation(env, step, event, this.env.RECIPIENT);
  }
}
export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const withGithub = url.searchParams.get('withGithub') === '1';
    const id = withGithub ? 'synthetic-offsite' : 'synthetic-native';
    if (url.pathname === '/start') {
      await env.OPERATIONS.create({ id, params: { kind: 'backup', withGithub } });
      return Response.json({ id });
    }
    const instance = await env.OPERATIONS.get(id);
    return Response.json(await instance.status());
  },
};
