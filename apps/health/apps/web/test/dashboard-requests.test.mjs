import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';
import * as health from '../src/lib/health.ts';
import * as journal from '../src/lib/journal.ts';
import { RequestError, errorText } from '../src/lib/api.ts';
import { api } from '../src/lib/api.ts';
import { createAutomaticSync } from '../src/lib/automatic-sync.ts';

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
    exports: {}, AbortController,
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
      if (name === '../lib/automatic-sync') return { createAutomaticSync };
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

const flush = () => new Promise(setImmediate);
const queue = (overrides = {}) => ({
  enabled: true, status: 'running', started_at: '2026-10-15T01:00:00Z', finished_at: null,
  scores: { status: 'pending', error: null },
  details: { total: 10, completed: 0, failed: 0, remaining: 10 }, current: null,
  ...overrides,
});

function mountDashboard(t, request, { personal = true, source = 'sso' } = {}) {
  const script = readFileSync(new URL('../src/components/Dashboard.svelte', import.meta.url), 'utf8')
    .match(/<script lang="ts">([\s\S]*?)<\/script>/)[1];
  const { outputText } = ts.transpileModule(`${script}
    globalThis.dashboard = { load, syncNow, poll: sync.refresh, read: () => ({ allDays, automatic, syncBusy, loading, end, syncError }) };
  `, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } });
  let rollover, mount;
  t.mock.method(globalThis, 'fetch', request);
  const derived = value => value;
  derived.by = fn => fn();
  const context = vm.createContext({
    exports: {}, AbortController, Date,
    $state: value => value, $derived: derived,
    $props: () => ({ me: { source, capabilities: { personal } }, locale: 'zh', onUnauthorized() {}, onLogout() {} }),
    require(name) {
      if (name === 'svelte') return { onMount: fn => { mount = fn; } };
      if (name === '../lib/api') return { api, RequestError, errorText };
      if (name === '../lib/automatic-sync') return { createAutomaticSync };
      if (name === '../lib/health') return health;
      if (name === '../lib/journal') return journal;
      if (name === '../lib/calendar') return { watchCalendarDay: fn => { rollover = fn; return () => {}; } };
      if (name === '../lib/i18n') return { t: (_locale, key) => key };
      if (name === '../lib/ai' || name.endsWith('.svelte') || name.endsWith('.css')) return {};
      throw new Error(`Unexpected component import: ${name}`);
    },
  });
  vm.runInContext(outputText, context);
  const unmount = mount();
  t.after(unmount);
  return { ...context.dashboard, rollover: day => rollover(day), unmount };
}

test('owner queue score completion supersedes a late rollover read of the old cache', async t => {
  let score = 60, reads = 0, status = queue(), completePost, resolveRollover;
  const view = mountDashboard(t, async (path, init) => {
    if (path.endsWith('/automatic')) {
      if (init.method === 'POST') await new Promise(resolve => { completePost = resolve; });
      return Response.json(status, { status: init.method === 'POST' ? 202 : 200 });
    }
    if (path.startsWith('/api/me/health-records?')) return Response.json({ records: [], next_offset: null, sync: {} });
    assert.equal(path, '/api/me/daily?days=90');
    if (++reads === 2) return new Promise(resolve => { resolveRollover = resolve; });
    return Response.json({ ok: true, days: [{ date: '2026-10-16', sleep: { score } }] });
  });
  await flush();
  assert.equal(view.read().allDays[0].sleep.score, 60);
  const syncing = view.syncNow();
  view.rollover('2026-10-16');
  await flush();
  assert.equal(view.read().syncBusy, true);
  completePost();
  await syncing;
  assert.equal(view.read().syncBusy, false, 'submission finishes before background work');
  assert.equal(view.read().automatic.status, 'running');
  score = 90;
  status = queue({ scores: { status: 'completed', error: null } });
  await view.poll();
  await flush();
  resolveRollover(Response.json({ ok: true, days: [{ date: '2026-10-16', sleep: { score: 60 } }] }));
  await flush();
  assert.equal(reads, 3, 'initial read, rollover read, score completion read');
  assert.equal(view.read().allDays[0].sleep.score, 90);
  assert.equal(view.read().loading, false);
  assert.equal(view.read().end, '2026-10-16');
  await view.poll();
  await flush();
  assert.equal(reads, 3, 'unchanged score status does not repeatedly reload');
});

test('detail progress throttles sleep reads and completion always re-reads', async t => {
  t.mock.timers.enable({ apis: ['Date'], now: Date.parse('2026-10-15T01:00:00Z') });
  let sleepReads = 0, status = queue();
  const view = mountDashboard(t, async path => {
    if (path.endsWith('/automatic')) return Response.json(status);
    if (path.startsWith('/api/me/health-records?')) {
      sleepReads++;
      return Response.json({ records: [], next_offset: null, sync: {} });
    }
    return Response.json({ ok: true, days: [] });
  });
  await flush();
  assert.equal(sleepReads, 1);
  status = queue({ details: { total: 10, completed: 1, failed: 0, remaining: 9 } });
  await view.poll();
  await flush();
  assert.equal(sleepReads, 1);
  t.mock.timers.tick(30_000);
  await view.poll();
  await flush();
  assert.equal(sleepReads, 2, 'throttled progress is eventually read even while the next batch is waiting');
  status = queue({ details: { total: 10, completed: 2, failed: 0, remaining: 8 } });
  await view.poll();
  await flush();
  assert.equal(sleepReads, 2, 'more progress within the throttle window does not duplicate reads');
  status = queue({ status: 'completed', details: { total: 10, completed: 10, failed: 0, remaining: 0 } });
  await view.poll();
  await flush();
  assert.equal(sleepReads, 3, 'terminal transition bypasses throttling');
});

test('non-owner and dev dashboards never request owner-only queue or sleep APIs', async t => {
  for (const access of [{ personal: false, source: 'oauth' }, { personal: true, source: 'dev' }]) {
    const paths = [];
    const view = mountDashboard(t, async path => {
      paths.push(path);
      return Response.json({ ok: true, days: [] });
    }, access);
    await flush();
    await view.syncNow();
    view.unmount();
    assert.deepEqual(paths, ['/api/me/daily?days=90', '/api/me/sync?days=90']);
  }
});
