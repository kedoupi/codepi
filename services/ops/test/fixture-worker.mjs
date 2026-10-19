import { WorkflowEntrypoint } from 'cloudflare:workers';
import { backupOperation, STEP } from '../src/operations.mjs';

// Local-only entrypoint. Production has no HTTP operation endpoint.
STEP.retries.limit = 0;
export class SyntheticWorkflow extends WorkflowEntrypoint {
  run(event, step) {
    return backupOperation(this.env, step, event, this.env.RECIPIENT);
  }
}
export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === '/start') {
      await env.OPERATIONS.create({ id: 'synthetic-native', params: { kind: 'backup' } });
      return Response.json({ id: 'synthetic-native' });
    }
    const instance = await env.OPERATIONS.get('synthetic-native');
    return Response.json(await instance.status());
  },
};
