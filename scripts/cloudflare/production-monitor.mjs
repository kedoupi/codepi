// Scheduled production checks for the kdp platform. Read-only: every check is a
// plain HTTP request or a Cloudflare API read. No secrets are ever printed.
//
// Usage:
//   node scripts/cloudflare/production-monitor.mjs
// Environment (optional locally; required in scheduled monitoring):
//   CLOUDFLARE_ACCOUNT_ID  Cloudflare account id
//   CLOUDFLARE_API_TOKEN   API token with D1 and Workers metadata read permission
import assert from 'node:assert/strict';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { checkReleaseDrift } from './release-drift.mjs';

import { runMonitor as runCore } from './monitor-core.mjs';

export function runMonitor(options = {}) {
  return runCore({ ...options, versionCheck: options.versionCheck ?? checkReleaseDrift });
}

function report(results) {
  let failed = 0;
  for (const { name, ok, detail, skipped } of results) {
    if (skipped) console.log(`SKIP ${name} (${skipped})`);
    else if (ok) console.log(`PASS ${name}`);
    else {
      failed += 1;
      console.error(`FAIL ${name}: ${detail}`);
    }
  }
  return failed;
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;
if (isMain) {
  const args = process.argv.slice(2);
  assert.ok(new Set(args).size === args.length && args.every(arg => ['--require-d1', '--require-versions'].includes(arg)),
    'Usage: production-monitor.mjs [--require-d1] [--require-versions]');
  const failed = report(await runMonitor({
    requireD1: args.includes('--require-d1'), requireVersions: args.includes('--require-versions'),
  }));
  if (failed > 0) {
    console.error(`${failed} production check(s) failed.`);
    process.exitCode = 1;
  } else {
    console.log('All production checks passed.');
  }
}
