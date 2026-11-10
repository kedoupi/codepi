import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import test from 'node:test';

const runner = new URL('./runtime-worker-runner.mjs', import.meta.url);
test('HTTP, RPC, scheduled merge, token auth and delivery fail-closed behavior', () => {
  execFileSync('bun', [runner.pathname], { stdio: 'inherit' });
});
