export { MeImportsBackup } from '../../../apps/me/worker/imports-backup.ts';

export default {
  fetch() {
    return new Response('Not found', { status: 404 });
  },
};
