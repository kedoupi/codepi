import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import { createAutomaticSync } from '../src/lib/automatic-sync.ts';
import { errorText, RequestError } from '../src/lib/api.ts';

const flush = () => new Promise(setImmediate);
const status = (state = 'running') => ({
  enabled: true, status: state, started_at: '2026-10-15T01:00:00Z',
  scores: { status: 'pending', error: null },
  details: { total: 10, completed: 0, failed: 0, remaining: 10 }, current: null,
});

test('a bodyless POST supersedes an old GET and slow polls never overlap', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const pending = [], seen = [], errors = [];
  t.mock.method(globalThis, 'fetch', (path, init) => new Promise(resolve => {
    assert.equal(path, '/api/me/health-records/automatic');
    pending.push({ init, resolve });
  }));
  const sync = createAutomaticSync({ onStatus: value => seen.push(value), onError: error => errors.push(error) });
  t.after(() => sync.dispose());
  const initial = sync.refresh();
  await sync.refresh();
  assert.equal(pending.length, 1);
  const start = sync.start();
  await sync.start();
  assert.equal(pending.length, 2);
  assert.equal(pending[0].init.signal.aborted, true);
  assert.equal(pending[1].init.method, 'POST');
  assert.equal(pending[1].init.body, undefined);
  pending[1].resolve(Response.json(status(), { status: 202 }));
  await start;
  pending[0].resolve(Response.json(status('idle')));
  await initial;
  assert.deepEqual(seen.map(value => value.status), ['running']);
  t.mock.timers.tick(5_000);
  await flush();
  assert.equal(pending.length, 3);
  t.mock.timers.tick(30_000);
  await flush();
  assert.equal(pending.length, 3, 'a pending GET owns the polling slot');
  pending[2].resolve(Response.json(status('completed')));
  await flush();
  assert.deepEqual(seen.map(value => value.status), ['running', 'completed']);
  assert.deepEqual(errors, []);
  sync.dispose();
  t.mock.timers.tick(60_000);
  assert.equal(pending.length, 3);
});

test('unmount aborts a submission and ignores late successes and failures', async t => {
  for (const fail of [false, true]) {
    let settle, signal;
    const mock = t.mock.method(globalThis, 'fetch', (_path, init) => {
      signal = init.signal;
      return new Promise((resolve, reject) => { settle = () => fail ? reject(new Error('offline')) : resolve(Response.json(status())); });
    });
    const seen = [];
    const sync = createAutomaticSync({ onStatus: value => seen.push(value), onError: error => seen.push(error) });
    const start = sync.start();
    sync.dispose();
    assert.equal(signal.aborted, true);
    settle();
    await start;
    await sync.refresh();
    await sync.start();
    assert.deepEqual(seen, []);
    assert.equal(mock.mock.callCount(), 1);
    mock.mock.restore();
  }
});

test('409 is observed with GET; disabled and blocked errors do not retry POST', async t => {
  for (const [http, code] of [[409, 'sync_in_progress'], [503, 'auto_sync_disabled'], [401, 'reconnect_required']]) {
    const methods = [], errors = [], seen = [];
    const mock = t.mock.method(globalThis, 'fetch', (_path, init) => {
      methods.push(init.method);
      return Promise.resolve(init.method === 'POST'
        ? Response.json({ error: code }, { status: http })
        : Response.json(status('blocked')));
    });
    const sync = createAutomaticSync({ onStatus: value => seen.push(value), onError: error => errors.push(error) });
    try {
      await sync.start();
      assert.equal(errors[0].code, code);
      assert.equal(errors[0].status, http);
      assert.deepEqual(methods, http === 409 ? ['POST', 'GET'] : ['POST']);
      assert.equal(seen.length, http === 409 ? 1 : 0);
    } finally { sync.dispose(); mock.mock.restore(); }
  }
});

test('reusing a running task preserves the server retry time', async t => {
  const value = { ...status(), next_batch_at: '2026-10-16T01:00:00Z', error: 'daily_sync_budget_reached' };
  t.mock.method(globalThis, 'fetch', async () => Response.json(value, { status: 202 }));
  let current;
  const sync = createAutomaticSync({ onStatus: result => { current = result; }, onError: error => { throw error; } });
  try {
    await sync.start();
    await sync.start();
    assert.equal(current.next_batch_at, value.next_batch_at);
    assert.equal(current.error, value.error);
  } finally { sync.dispose(); }
});

test('disabled background updates have a specific bilingual error', () => {
  const error = new RequestError('auto_sync_disabled', 503);
  assert.match(errorText(error, 'zh'), /后台数据更新暂未开启/);
  assert.match(errorText(error, 'en'), /Background data updates are disabled/);
});

test('queue presentation localizes score batches and distinguishes configuration blocks from reconnects', () => {
  const script = readFileSync(new URL('../src/components/AutomaticSync.svelte', import.meta.url), 'utf8')
    .match(/<script lang="ts">([\s\S]*?)<\/script>/)[1];
  const { outputText } = ts.transpileModule(`${script}
    globalThis.view = { title, reconnect, next: collectionLabel(value.current.collection), sleep: collectionLabel("sleep") };
  `, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } });
  for (const locale of ['zh', 'en']) {
    for (const code of ['oura_not_configured', 'reconnect_required']) {
      const context = vm.createContext({
        exports: {}, $derived: value => value,
        $props: () => ({
          locale, value: { ...status('blocked'), error: code, current: { collection: '__scores', from: '2026-10-15', to: '2026-10-15' } },
          collections: [{ name: 'sleep', label: '详细睡眠 / Sleep details' }],
        }),
        require: () => ({ errorText, RequestError }),
      });
      vm.runInContext(outputText, context);
      assert.equal(context.view.reconnect, code === 'reconnect_required');
      assert.match(context.view.title, code === 'oura_not_configured' ? /服务配置|service configuration/ : /重新连接|reconnect required/);
      assert.equal(context.view.next, locale === 'zh' ? '官方评分' : 'Official scores');
      assert.equal(context.view.sleep, locale === 'zh' ? '详细睡眠' : 'Sleep details');
    }
  }
});
