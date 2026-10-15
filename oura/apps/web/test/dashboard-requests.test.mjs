import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';
import * as health from '../src/lib/health.ts';
import * as journal from '../src/lib/journal.ts';
import { RequestError, errorText } from '../src/lib/api.ts';

test('a completed manual sync re-reads after a rollover GET saw the old cache', async () => {
  const source = readFileSync(new URL('../src/components/Dashboard.svelte', import.meta.url), 'utf8');
  const script = source.match(/<script lang="ts">([\s\S]*?)<\/script>/)[1];
  const { outputText } = ts.transpileModule(`${script}
    globalThis.dashboard = { load, syncNow, read: () => ({ allDays, syncBusy, loading, end }) };
  `, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } });
  let rollover, mount;
  let completeSync;
  let score = 60;
  let reads = 0;
  const payload = () => ({ ok: true, days: [{ date: '2026-10-16', sleep: { score } }] });
  const derived = value => value;
  derived.by = fn => fn();
  const context = vm.createContext({
    exports: {},
    $state: value => value,
    $derived: derived,
    $props: () => ({ me: { capabilities: { personal: false } }, locale: 'zh', onUnauthorized() {}, onLogout() {} }),
    require(name) {
      if (name === 'svelte') return { onMount: fn => { mount = fn; } };
      if (name === '../lib/api') return {
        RequestError, errorText,
        api: async path => {
          if (path.startsWith('/api/me/sync')) {
            await new Promise(resolve => { completeSync = resolve; });
            score = 90;
          } else reads++;
          return payload();
        },
      };
      if (name === '../lib/health') return health;
      if (name === '../lib/journal') return journal;
      if (name === '../lib/calendar') return { watchCalendarDay: fn => { rollover = fn; return () => {}; } };
      if (name === '../lib/i18n') return { t: (_locale, key) => key };
      if (name === '../lib/ai') return {};
      if (name === '../journal.css') return {};
      throw new Error(`Unexpected component import: ${name}`);
    },
  });
  vm.runInContext(outputText, context);
  const unmount = mount();
  await new Promise(setImmediate);
  assert.equal(context.dashboard.read().allDays[0].sleep.score, 60);
  const syncing = context.dashboard.syncNow();
  rollover('2026-10-16');
  await new Promise(setImmediate);
  assert.equal(context.dashboard.read().allDays[0].sleep.score, 60);
  assert.equal(context.dashboard.read().syncBusy, true);
  completeSync();
  await syncing;
  assert.equal(reads, 3, 'initial read, rollover read, and read after successful sync');
  assert.equal(context.dashboard.read().allDays[0].sleep.score, 90);
  assert.equal(context.dashboard.read().syncBusy, false);
  assert.equal(context.dashboard.read().loading, false);
  assert.equal(context.dashboard.read().end, '2026-10-16');
  unmount();
});
