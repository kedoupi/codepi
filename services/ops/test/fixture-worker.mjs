import { WorkflowEntrypoint } from 'cloudflare:workers';
import { monitorOperation, backupOperation, STEP } from '../src/operations.mjs';
STEP.retries.limit = 0;
export class SyntheticWorkflow extends WorkflowEntrypoint {
  run(event, step) {
    const env = this.env;
    if (event.payload?.kind === 'monitor') return monitorOperation(env, step, event, { monitor: async () => [{ name: 'synthetic monitor', ok: true }] });
    return backupOperation(env, step, event, this.env.RECIPIENT);
  }
}
export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const kind = url.searchParams.get('kind') ?? 'backup';
    const id = kind === 'monitor' ? 'synthetic-monitor' : 'synthetic-native';
    if (url.pathname === '/start') { await env.OPERATIONS.create({ id, params: { kind } }); return Response.json({ id }); }
    return Response.json(await (await env.OPERATIONS.get(id)).status());
  },
};
