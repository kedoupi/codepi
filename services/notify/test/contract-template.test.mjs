import { execFileSync } from 'node:child_process';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

test('notify contract, rules, decisions and template checks', () => {
  execFileSync(process.execPath, [
    '--experimental-strip-types', '--experimental-loader', fileURLToPath(new URL('./cloudflare-loader.mjs', import.meta.url)),
    '--test', fileURLToPath(new URL('./contract-template-runner.mjs', import.meta.url)),
  ], { stdio: 'inherit' });
});
