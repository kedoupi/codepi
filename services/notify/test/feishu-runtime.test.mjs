import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';
import test from 'node:test';
import { resetFeishuTokenCache, setFeishuFetchForTest } from '../src/channels/feishu.ts';

const root = path.resolve(new URL('../../..', import.meta.url).pathname);
const migration = `${await readFile(path.join(root, 'services/notify/migrations/0001_notify.sql'), 'utf8')}\n${await readFile(path.join(root, 'services/notify/migrations/0002_channel_attempts.sql'), 'utf8')}`;
const { default: worker, ingest } = await import('../src/index.ts');
const MINUTE = 60 * 1000;
const MORNING = Date.parse('2026-11-11T01:00:00Z');
const samples = {
  appId: ['feishu', '-app-test'].join(''),
  appSecret: ['feishu', '-secret-test'].join(''),
  openId: ['ou_', 'test_receiver'].join(''),
  tenantToken: ['tenant', '-token-test'].join(''),
};

class D1 {
  constructor() { this.sqlite = new DatabaseSync(':memory:'); this.sqlite.exec(migration); }
  prepare(sql) {
    const db = this.sqlite;
    return { bind(...values) { const statement = db.prepare(sql); return {
      first: async () => statement.get(...values) ?? null,
      all: async () => ({ results: statement.all(...values) }),
      run: async () => ({ meta: { changes: Number(statement.run(...values).changes ?? 0) } }),
    }; } };
  }
  count(sql, ...values) { return Number(this.sqlite.prepare(sql).get(...values).count); }
  row(sql, ...values) { return this.sqlite.prepare(sql).get(...values); }
  rows(sql, ...values) { return this.sqlite.prepare(sql).all(...values); }
}

function response(body, status = 200) {
  return { ok: status >= 200 && status < 300, status, async json() { return body; } };
}
function feishuFetch(sendResults = []) {
  const calls = [];
  let tokenNumber = 0;
  const fetchImpl = async (url, init) => {
    calls.push({ url: String(url), init });
    if (String(url).includes('/tenant_access_token/')) return response({ code: 0, tenant_access_token: `${samples.tenantToken}-${tokenNumber++}`, expire: 7200 });
    const result = typeof sendResults === 'function' ? sendResults(calls.filter(call => call.url.includes('/im/v1/messages')).length) : sendResults.shift() ?? { code: 0, data: { message_id: `feishu-message-${calls.length}` } };
    if (result instanceof Error) throw result;
    return response(result);
  };
  fetchImpl.calls = calls;
  return fetchImpl;
}
function setup({ fetchImpl = feishuFetch(), send, configured = true } = {}) {
  resetFeishuTokenCache();
  setFeishuFetchForTest(fetchImpl);
  const db = new D1();
  const sent = [];
  const env = {
    DB: db,
    NOTIFY_TO: 'owner@example.invalid',
    EMAIL: { async send(message) { sent.push(message); return send ? send(message, sent.length) : { id: `email-message-${sent.length}` }; } },
  };
  if (configured) Object.assign(env, { FEISHU_APP_ID: samples.appId, FEISHU_APP_SECRET: samples.appSecret, FEISHU_RECEIVE_OPEN_ID: samples.openId });
  return { db, sent, env, fetchImpl };
}
function seedToken(db, token = 'cpn_feishu_test', kinds = ['agent.stuck', 'approval.pending', 'notify.selftest']) {
  const hash = createHash('sha256').update(token).digest('hex');
  db.sqlite.prepare('INSERT INTO producer_tokens (token_id, token_hash, source, kinds_json, created_at) VALUES (?, ?, ?, ?, ?)').run(`test-${token}`, hash, 'surgeconf.watchdog', JSON.stringify(kinds), new Date().toISOString());
  return token;
}
function clock(t, now = MORNING) {
  t.mock.timers.enable({ apis: ['Date'], now });
  return { set: value => t.mock.timers.setTime(value) };
}
const event = (id, kind, severity, state = 'firing', subject = id, extra = {}) => ({
  schema: 'notify.event/v1', event_id: id, source: 'surgeconf.watchdog', kind, subject, state, severity,
  occurred_at: new Date(MORNING).toISOString(), title: id, ...extra,
});
const critical = (id, extra = {}) => event(id, 'agent.stuck', 'critical', 'firing', id, extra);
const warning = (id, extra = {}) => event(id, 'approval.pending', 'warning', 'firing', id, extra);
const selftest = (id, extra = {}) => event(id, 'notify.selftest', 'info', 'info', id, extra);
function attempts(db, deliveryId) { return db.rows('SELECT channel, status, attempts, next_attempt_at, error_code, message_id, sent_at FROM channel_attempts WHERE delivery_id = ? ORDER BY channel', deliveryId); }
function latestDelivery(db, eventId) { return db.row('SELECT id, status, channel, attempts, quota_omitted FROM deliveries WHERE event_id = ?', eventId); }


test('critical agent.stuck with Feishu configured sends Feishu and email once', async t => {
  clock(t);
  const { db, sent, env, fetchImpl } = setup();
  await ingest(critical('critical-configured'), env);
  await worker.scheduled({}, env);
  const delivery = latestDelivery(db, 'critical-configured');
  assert.deepEqual({ status: delivery.status, channel: delivery.channel }, { status: 'sent', channel: 'feishu,email' });
  assert.deepEqual(attempts(db, delivery.id).map(row => [row.channel, row.status, row.message_id]), [['email', 'sent', 'email-message-1'], ['feishu', 'sent', 'feishu-message-2']]);
  assert.equal(sent.length, 1);
  assert.equal(fetchImpl.calls.filter(call => call.url.includes('/im/v1/messages')).length, 1);
});

test('warning approval.pending sends only Feishu', async t => {
  clock(t);
  const { db, sent, env, fetchImpl } = setup();
  await ingest(warning('warning-feishu-only'), env);
  await worker.scheduled({}, env);
  const delivery = latestDelivery(db, 'warning-feishu-only');
  assert.equal(delivery.status, 'sent');
  assert.equal(sent.length, 0);
  assert.equal(fetchImpl.calls.filter(call => call.url.includes('/im/v1/messages')).length, 1);
  assert.deepEqual(attempts(db, delivery.id).map(row => [row.channel, row.status]), [['feishu', 'sent']]);
});

test('warning Feishu 230013 falls back to email in the same run and consumes one quota', async t => {
  clock(t);
  const fetchImpl = feishuFetch([{ code: 230013, msg: 'private response body must not escape' }]);
  const { db, sent, env } = setup({ fetchImpl });
  await ingest(warning('warning-230013'), env);
  await worker.scheduled({}, env);
  const delivery = latestDelivery(db, 'warning-230013');
  assert.equal(delivery.status, 'sent');
  assert.equal(delivery.channel, 'feishu,email');
  assert.deepEqual(attempts(db, delivery.id).map(row => [row.channel, row.status, row.error_code, row.message_id]), [['email', 'sent', null, 'email-message-1'], ['feishu', 'failed', 'E_FEISHU_230013', null]]);
  assert.equal(db.row("SELECT day_count FROM quota WHERE bucket LIKE 'day:%'").day_count, 1);
  assert.equal(sent.length, 1);
});

test('warning Feishu 230020 retries four times then falls back to email without double quota', async t => {
  const time = clock(t);
  const fetchImpl = feishuFetch([{ code: 230020 }, { code: 230020 }, { code: 230020 }, { code: 230020 }]);
  const { db, sent, env } = setup({ fetchImpl });
  await ingest(warning('warning-230020'), env);
  await worker.scheduled({}, env);
  const deliveryId = latestDelivery(db, 'warning-230020').id;
  assert.equal(db.row('SELECT status FROM channel_attempts WHERE delivery_id = ? AND channel = \'feishu\'', deliveryId).status, 'pending');
  for (const offset of [5, 20, 80]) {
    time.set(MORNING + offset * MINUTE);
    await worker.scheduled({}, env);
  }
  const delivery = latestDelivery(db, 'warning-230020');
  assert.equal(delivery.status, 'sent');
  assert.deepEqual(attempts(db, delivery.id).map(row => [row.channel, row.status, row.attempts]), [['email', 'sent', 1], ['feishu', 'failed', 4]]);
  assert.equal(db.row("SELECT day_count FROM quota WHERE bucket LIKE 'day:%'").day_count, 1);
  assert.equal(sent.length, 1);
});

test('notify.selftest sends both channels', async t => {
  clock(t);
  const { db, sent, env } = setup();
  await ingest(selftest('selftest-both'), env);
  const delivery = latestDelivery(db, 'selftest-both');
  assert.equal(delivery.status, 'sent');
  assert.equal(sent.length, 1);
  assert.deepEqual(attempts(db, delivery.id).map(row => row.status), ['sent', 'sent']);
});

test('each missing Feishu secret skips Feishu without fetch and sends email', async t => {
  clock(t);
  for (const missing of ['FEISHU_APP_ID', 'FEISHU_APP_SECRET', 'FEISHU_RECEIVE_OPEN_ID']) {
    const fetchImpl = feishuFetch();
    const setupResult = setup({ fetchImpl });
    delete setupResult.env[missing];
    await ingest(selftest(`missing-${missing}`), setupResult.env);
    const delivery = latestDelivery(setupResult.db, `missing-${missing}`);
    assert.equal(delivery.status, 'sent');
    assert.equal(setupResult.sent.length, 1);
    assert.equal(fetchImpl.calls.length, 0);
    assert.deepEqual(attempts(setupResult.db, delivery.id).map(row => [row.channel, row.status, row.error_code]), [['email', 'sent', null], ['feishu', 'skipped', 'E_FEISHU_NOT_CONFIGURED']]);
  }
});

test('resolved and repeat follow successful Feishu channel, then fall back if it fails', async t => {
  const time = clock(t);
  const firstFetch = feishuFetch([{ code: 0, data: { message_id: 'first-feishu' } }, { code: 230013 }]);
  const first = setup({ fetchImpl: firstFetch });
  await ingest(event('follow-first', 'agent.stuck', 'warning'), first.env);
  await worker.scheduled({}, first.env);
  await ingest(event('follow-resolved', 'agent.stuck', 'warning', 'resolved', 'follow-first'), first.env);
  await worker.scheduled({}, first.env);
  assert.equal(first.sent.length, 1);
  const resolved = latestDelivery(first.db, 'follow-resolved');
  assert.deepEqual(attempts(first.db, resolved.id).map(row => [row.channel, row.status, row.error_code]), [['email', 'sent', null], ['feishu', 'failed', 'E_FEISHU_230013']]);

  const repeatFetch = feishuFetch();
  const repeat = setup({ fetchImpl: repeatFetch });
  await ingest(event('repeat-first', 'agent.stuck', 'warning', 'firing', 'repeat-subject'), repeat.env);
  await worker.scheduled({}, repeat.env);
  time.set(MORNING + 7 * 60 * MINUTE);
  await ingest(event('repeat-second', 'agent.stuck', 'warning', 'firing', 'repeat-subject'), repeat.env);
  await worker.scheduled({}, repeat.env);
  assert.equal(repeat.sent.length, 0);
  assert.equal(repeatFetch.calls.filter(call => call.url.includes('/im/v1/messages')).length, 2);
});

test('Cron mixed batches use the route union and warning-only batches use Feishu only', async t => {
  clock(t);
  const mixed = setup();
  await ingest(critical('mixed-critical'), mixed.env);
  await ingest(warning('mixed-warning'), mixed.env);
  await worker.scheduled({}, mixed.env);
  assert.equal(mixed.sent.length, 1);
  assert.equal(mixed.fetchImpl.calls.filter(call => call.url.includes('/im/v1/messages')).length, 1);

  const warningOnly = setup();
  await ingest(warning('only-warning'), warningOnly.env);
  await worker.scheduled({}, warningOnly.env);
  assert.equal(warningOnly.sent.length, 0);
  assert.equal(warningOnly.fetchImpl.calls.filter(call => call.url.includes('/im/v1/messages')).length, 1);
});

test('Cron retry-only batches do not reserve quota and quota denial omits only new deliveries', async t => {
  const time = clock(t);
  const fetchImpl = feishuFetch([{ code: 230020 }, { code: 0, data: { message_id: 'retry-sent' } }]);
  const { db, env } = setup({ fetchImpl });
  await ingest(warning('quota-retry'), env);
  await worker.scheduled({}, env);
  assert.equal(db.row("SELECT day_count FROM quota WHERE bucket LIKE 'day:%'").day_count, 1);
  time.set(MORNING + 5 * MINUTE);
  await worker.scheduled({}, env);
  assert.equal(db.row("SELECT day_count FROM quota WHERE bucket LIKE 'day:%'").day_count, 1);

  db.sqlite.prepare("UPDATE quota SET day_count = 20, hour_count = 6 WHERE bucket LIKE 'day:%' OR bucket LIKE 'hour:%'").run();
  await ingest(warning('quota-new'), env);
  await worker.scheduled({}, env);
  assert.equal(latestDelivery(db, 'quota-retry').status, 'sent');
  assert.equal(latestDelivery(db, 'quota-new').quota_omitted, 1);
  assert.equal(db.row("SELECT day_count FROM quota WHERE bucket LIKE 'day:%'").day_count, 20);
});

test('warning retries and fallback defer in quiet hours while critical still sends', async t => {
  const evening = Date.parse('2026-11-10T14:58:00Z');
  const time = clock(t, evening);
  const fetchImpl = feishuFetch(index => index === 1 ? { code: 230020 } : undefined);
  const { db, sent, env } = setup({ fetchImpl });
  await ingest(warning('quiet-retry'), env);
  await worker.scheduled({}, env);
  time.set(Date.parse('2026-11-10T15:03:00Z'));
  await ingest(critical('quiet-critical'), env);
  await worker.scheduled({}, env);
  assert.equal(sent.length, 1);
  const retry = latestDelivery(db, 'quiet-retry');
  assert.equal(db.row("SELECT next_attempt_at FROM channel_attempts WHERE delivery_id = ? AND channel = 'feishu'", retry.id).next_attempt_at, '2026-11-11T00:00:00.000Z');
});

test('resolved and reopen cancel pending channel attempts including retries after a sent delivery', async t => {
  clock(t);
  const firstFetch = feishuFetch();
  const first = setup({ fetchImpl: firstFetch, send: () => { throw Object.assign(new Error('mail down'), { code: 'E_DELIVERY_FAILED' }); } });
  await ingest(critical('cancel-sent'), first.env);
  await worker.scheduled({}, first.env);
  const firstDelivery = latestDelivery(first.db, 'cancel-sent');
  assert.equal(firstDelivery.status, 'sent');
  await ingest(event('cancel-resolved', 'agent.stuck', 'critical', 'resolved', 'cancel-sent'), first.env);
  assert.equal(first.db.row("SELECT status, error_code FROM channel_attempts WHERE delivery_id = ? AND channel = 'email'", firstDelivery.id).error_code, 'E_RESOLVED_BEFORE_SEND');

  const reopenFetch = feishuFetch([{ code: 0, data: { message_id: 'initial' } }, { code: 230020 }]);
  const reopen = setup({ fetchImpl: reopenFetch });
  await ingest(event('reopen-initial', 'agent.stuck', 'warning', 'firing', 'reopen-channel'), reopen.env);
  await worker.scheduled({}, reopen.env);
  await ingest(event('reopen-resolved', 'agent.stuck', 'warning', 'resolved', 'reopen-channel'), reopen.env);
  await worker.scheduled({}, reopen.env);
  const resolvedDelivery = latestDelivery(reopen.db, 'reopen-resolved');
  assert.equal(reopen.db.row("SELECT status FROM channel_attempts WHERE delivery_id = ? AND channel = 'feishu'", resolvedDelivery.id).status, 'pending');
  await ingest(event('reopen-firing', 'agent.stuck', 'warning', 'firing', 'reopen-channel'), reopen.env);
  assert.equal(reopen.db.row("SELECT status, error_code FROM channel_attempts WHERE delivery_id = ? AND channel = 'feishu'", resolvedDelivery.id).error_code, 'E_REOPENED_BEFORE_SEND');
});

test('legacy pending delivery without channel attempts is rebuilt and sent by Cron', async t => {
  clock(t);
  const { db, env } = setup();
  await ingest(warning('legacy-pending'), env);
  const delivery = latestDelivery(db, 'legacy-pending');
  db.sqlite.prepare('DELETE FROM channel_attempts WHERE delivery_id = ?').run(delivery.id);
  await worker.scheduled({}, env);
  assert.equal(latestDelivery(db, 'legacy-pending').status, 'sent');
  assert.deepEqual(attempts(db, delivery.id).map(row => [row.channel, row.status]), [['feishu', 'sent']]);
});

test('GET event read-back includes safe channel fields and no credentials', async t => {
  clock(t);
  const { db, env } = setup();
  const token = seedToken(db, 'readback-token');
  await ingest(selftest('readback-event'), env);
  const responseValue = await worker.fetch(new Request('https://notify-api.codepi.app/v1/events/readback-event', { headers: { authorization: `Bearer ${token}` } }), env);
  const body = await responseValue.text();
  const parsed = JSON.parse(body);
  assert.deepEqual(Object.keys(parsed.deliveries[0].channels[0]).sort(), ['attempts', 'channel', 'error_code', 'message_id', 'next_attempt_at', 'sent_at', 'status']);
  for (const value of [env.NOTIFY_TO, samples.openId, samples.appId, samples.appSecret, samples.tenantToken]) assert.equal(body.includes(value), false);
});

test('Feishu failure logs only sanitized E_FEISHU code', async t => {
  clock(t);
  const fetchImpl = feishuFetch([{ code: 230013, msg: `${samples.tenantToken} ${samples.appSecret} ${samples.openId} response-body` }]);
  const { env } = setup({ fetchImpl });
  const logged = [];
  t.mock.method(console, 'error', (...args) => logged.push(args.join(' ')));
  await ingest(warning('sanitized-error'), env);
  await worker.scheduled({}, env);
  assert.match(logged.join('\n'), /E_FEISHU_230013/);
  for (const value of [samples.tenantToken, samples.appSecret, samples.openId, 'response-body']) assert.equal(logged.join('\n').includes(value), false);
});
