import { execFileSync } from 'node:child_process';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

test('HTTP, RPC, scheduled merge, token auth and delivery fail-closed behavior', () => {
  execFileSync(process.execPath, [
    '--experimental-strip-types', '--experimental-loader', fileURLToPath(new URL('./cloudflare-loader.mjs', import.meta.url)),
    '--test', fileURLToPath(new URL('./runtime-worker-runner.mjs', import.meta.url)),
  ], { stdio: 'inherit' });
});
