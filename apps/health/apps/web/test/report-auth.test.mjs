import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';
import { errorText, RequestError } from '../src/lib/api.ts';

// Execute the actual component request handlers without a DOM or a second copy
// of their logic. Rune stubs cover plain state only, not Svelte rendering.
function reportHarness(component, request) {
  const source = readFileSync(new URL(`../src/components/${component}.svelte`, import.meta.url), 'utf8');
  const script = source.match(/<script lang="ts">([\s\S]*?)<\/script>/)[1];
  const { outputText } = ts.transpileModule(`${script}
    globalThis.report = {
      load,
      read: () => ({ payload, status, statusErr }),
    };
  `, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } });
  const me = { authenticated: true, source: 'oauth', userId: 'report-test-user' };
  let unauthorizedCalls = 0;
  const context = vm.createContext({
    exports: {},
    $state: value => value,
    $derived: Object.assign(value => value, { by: fn => fn() }),
    $effect: () => {},
    $props: () => ({
      me, locale: 'en', onLogout: () => {},
      onUnauthorized: () => { unauthorizedCalls++; },
    }),
    require: name => {
      if (name === 'svelte') return { onMount: () => {} };
      if (name === '../lib/api') return { api: (...args) => request(...args), RequestError, errorText };
      if (name === '../lib/i18n') return { t: (_locale, key) => key };
      if (name === '../lib/router.svelte') return { goto: () => {} };
      if (name === '../lib/calendar') return { watchCalendarDay: () => () => {} };
      if (name === '../lib/health') return {
        duration: () => '—', finite: value => typeof value === 'number' && Number.isFinite(value),
        readSleep: async () => ({ records: [], next_offset: null, sync: {} }),
        readSpo2: async () => [], readStress: async () => [], readTags: async () => [],
        sleepForDay: () => [],
      };
      if (name === '../lib/insights-model') return {
        compareSeries: () => null, daysOf: () => [], mainSleepSeries: () => [], nightlySeries: () => [],
        peakDates: () => [], rollingRanges: () => ({ current: { from: '2026-10-14', to: '2026-10-20' }, previous: { from: '2026-10-07', to: '2026-10-13' } }),
        seriesOf: () => ({ mean: null, count: 0 }), spo2Series: () => [], stepSeries: () => [],
        stressSeries: () => [], tagsForDay: () => [], tagLabel: () => '', weekday: () => '',
      };
      if (name === './MiniBars.svelte' || name === './MiniLine.svelte') return { default: {} };
      throw new Error(`Unexpected component import: ${name}`);
    },
  });
  vm.runInContext(outputText, context);
  return {
    load: (...args) => context.report.load(...args),
    read: () => context.report.read(),
    needsReconnect: () => vm.runInContext('typeof needsReconnect === "undefined" ? undefined : needsReconnect', context),
    unauthorizedCalls: () => unauthorizedCalls,
    me,
  };
}

const savedReport = { thisPeriod: { from: '2026-10-01', to: '2026-10-07' } };

for (const component of ['WeeklyPage', 'ComparePage']) {
  test(`${component}: Oura 401 preserves the site identity and saved report`, async () => {
    let failure = false;
    const report = reportHarness(component, async () => {
      if (failure) throw new RequestError('reconnect_required', 401);
      return savedReport;
    });
    await report.load();
    failure = true;
    await report.load();
    assert.equal(report.unauthorizedCalls(), 0);
    assert.equal(report.me.authenticated, true);
    assert.equal(report.read().payload, savedReport);
    assert.equal(report.read().statusErr, true);
    assert.equal(report.read().status, errorText(new RequestError('reconnect_required', 401), 'en'));
    assert.equal(report.needsReconnect(), true);
  });

  test(`${component}: Oura reconnect is actionable without an existing report`, async () => {
    for (const status of [401, 503]) {
      const report = reportHarness(component, async () => { throw new RequestError('reconnect_required', status); });
      await report.load();
      assert.equal(report.unauthorizedCalls(), 0);
      assert.equal(report.read().payload, null);
      assert.equal(report.read().statusErr, true);
      assert.equal(report.needsReconnect(), true);
    }
  });

  test(`${component}: only a site-session 401 invokes the login callback`, async () => {
    for (const [code, status, calls] of [
      ['unauthorized', 401, 1],
      ['unauthorized', 503, 0],
      ['upstream_unavailable', 401, 0],
      ['upstream_unavailable', 502, 0],
    ]) {
      const report = reportHarness(component, async () => { throw new RequestError(code, status); });
      await report.load();
      assert.equal(report.unauthorizedCalls(), calls, `${status}/${code}`);
    }
  });

  test(`${component}: retry clears the reconnect action while pending and after recovery`, async () => {
    let request = async () => { throw new RequestError('reconnect_required', 401); };
    const report = reportHarness(component, () => request());
    await report.load();
    assert.equal(report.needsReconnect(), true);
    let resolve;
    request = () => new Promise(done => { resolve = done; });
    const pending = report.load();
    assert.equal(report.needsReconnect(), false);
    assert.equal(report.read().statusErr, false);
    resolve(savedReport);
    await pending;
    assert.equal(report.needsReconnect(), false);
    assert.equal(report.read().payload, savedReport);
    assert.equal(report.unauthorizedCalls(), 0);
  });

  test(`${component}: a later service error does not keep the reconnect action`, async () => {
    let code = 'reconnect_required';
    const report = reportHarness(component, async () => { throw new RequestError(code, 503); });
    await report.load();
    assert.equal(report.needsReconnect(), true);
    code = 'upstream_unavailable';
    await report.load();
    assert.equal(report.needsReconnect(), false);
    assert.equal(report.read().statusErr, true);
  });
}

test('ComparePage: a superseded reconnect failure cannot overwrite a newer report', async () => {
  let reject;
  let calls = 0;
  const report = reportHarness('ComparePage', () => ++calls === 1
    ? new Promise((_resolve, fail) => { reject = fail; })
    : Promise.resolve(savedReport));
  const previous = report.load('week');
  await report.load('range');
  reject(new RequestError('reconnect_required', 401));
  await previous;
  assert.equal(report.read().payload, savedReport);
  assert.equal(report.read().statusErr, false);
  assert.equal(report.needsReconnect(), false);
  assert.equal(report.unauthorizedCalls(), 0);
});
