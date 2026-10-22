import { WorkflowEntrypoint } from 'cloudflare:workers';
import publicKey from '../../../scripts/cloudflare/backup-public-key.pem';
import { assertRecentMonitor, backupOperation, monitorOperation, observeOperation, scheduleOperation } from './operations.mjs';

export class OperationsWorkflow extends WorkflowEntrypoint {
  async run(event, step) {
    if (event.payload?.kind === 'monitor') return monitorOperation(this.env, step, event);
    if (event.payload?.kind === 'backup') return backupOperation(this.env, step, event, publicKey);
    if (event.payload?.kind === 'observe') return observeOperation(this.env, step, event);
    throw new Error('operations kind must be monitor, backup or observe');
  }
}

export default {
  async scheduled(controller, env) {
    const { kind } = await scheduleOperation(controller, env);
    // Surface failed/stalled Workflows as scheduled invocation errors as well.
    if (kind === 'monitor') await assertRecentMonitor(env.BACKUPS);
  },
  fetch() {
    return new Response('Not Found', { status: 404 });
  },
};
