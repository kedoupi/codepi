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
function cancelAfterChannelFailure(env, callback) {
  const originalPrepare = env.DB.prepare.bind(env.DB);
  let armed = true;
  env.DB.prepare = sql => {
    const statement = originalPrepare(sql);
    if (!armed || sql !== "UPDATE channel_attempts SET status = ?1, attempts = attempts + 1, next_attempt_at = ?2, error_code = ?3 WHERE delivery_id = ?4 AND channel = ?5 AND status <> 'cancelled'") return statement;
    return { bind(...values) {
      const bound = statement.bind(...values);
      return {
        first: bound.first,
        all: bound.all,
        run: async () => { const result = await bound.run(); armed = false; await callback(); return result; },
      };
    } };
  };
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
const dailyReview = (id, severity = 'warning', state = 'firing', extra = {}) => event(id, 'daily-review', severity, state, id, extra);
function request(token, body) { return new Request('https://notify-api.codepi.app/v1/events', { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` }, body: JSON.stringify(body) }); }
function attempts(db, deliveryId) { return db.rows('SELECT channel, status, attempts, next_attempt_at, error_code, message_id, sent_at FROM channel_attempts WHERE delivery_id = ? ORDER BY channel', deliveryId); }
function latestDelivery(db, eventId) { return db.row('SELECT id, status, channel, attempts, next_attempt_at, quota_omitted, error_code, message_id FROM deliveries WHERE event_id = ?', eventId); }
function setOmitted(db, count) { db.sqlite.prepare("INSERT INTO quota (bucket, omitted_count) VALUES ('day:2026-11-11', ?) ON CONFLICT(bucket) DO UPDATE SET omitted_count = excluded.omitted_count").run(count); }


test('critical agent.stuck with Feishu configured sends Feishu and email once', async t => {
  clock(t);
  const { db, sent, env, fetchImpl } = setup();
  await ingest(critical('critical-configured'), env);
  await worker.scheduled({}, env);
  const delivery = latestDelivery(db, 'critical-configured');
  assert.deepEqual({ status: delivery.status, channel: delivery.channel }, { status: 'sent', channel: 'feishu,email' });
  assert.deepEqual(attempts(db, delivery.id).map(row => [row.channel, row.status, row.message_id]), [['email', 'sent', 'email-message-1'], ['feishu', 'sent', 'feishu-message-2']]);
  assert.equal(sent.length, 1);
  assert.equal(db.row("SELECT day_count FROM quota WHERE bucket = 'day:2026-11-11'").day_count, 1);
  assert.equal(db.row("SELECT hour_count FROM quota WHERE bucket = 'hour:2026-11-11T09'").hour_count, 1);
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
  const retryAttempt = db.row("SELECT status, next_attempt_at FROM channel_attempts WHERE delivery_id = ? AND channel = 'feishu'", deliveryId);
  assert.equal(retryAttempt.status, 'pending');
  assert.equal(Date.parse(retryAttempt.next_attempt_at) - MORNING, 5 * MINUTE);
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
  assert.equal(mixed.db.row("SELECT day_count FROM quota WHERE bucket = 'day:2026-11-11'").day_count, 1);
  assert.equal(mixed.db.row("SELECT hour_count FROM quota WHERE bucket = 'hour:2026-11-11T09'").hour_count, 1);

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

test('warning retries and fallback send during the night', async t => {
  const evening = Date.parse('2026-11-10T14:58:00Z');
  const time = clock(t, evening);
  const fetchImpl = feishuFetch(index => index === 1 ? { code: 230020 } : { code: 0, data: { message_id: `night-${index}` } });
  const { db, sent, env } = setup({ fetchImpl });
  await ingest(warning('night-retry'), env);
  await worker.scheduled({}, env);
  const retry = latestDelivery(db, 'night-retry');
  db.sqlite.prepare("INSERT INTO channel_attempts (delivery_id, channel, status, attempts) VALUES (?, 'email', 'pending', 0)").run(retry.id);
  time.set(Date.parse('2026-11-10T15:03:00Z'));
  await ingest(critical('night-critical'), env);
  await worker.scheduled({}, env);
  assert.equal(sent.length, 1);
  assert.equal(fetchImpl.calls.filter(call => call.url.includes('/im/v1/messages')).length, 2);
  const criticalDelivery = latestDelivery(db, 'night-critical');
  assert.equal(criticalDelivery.channel, 'feishu,email');
  assert.equal(db.row("SELECT next_attempt_at FROM channel_attempts WHERE delivery_id = ? AND channel = 'feishu'", retry.id).next_attempt_at, null);
  assert.equal(db.row("SELECT next_attempt_at FROM channel_attempts WHERE delivery_id = ? AND channel = 'email'", retry.id).next_attempt_at, null);
});

test('resolved and reopen cancel pending channel attempts including retries after a sent delivery', async t => {
  const time = clock(t);
  const firstFetch = feishuFetch();
  const first = setup({ fetchImpl: firstFetch, send: () => { throw Object.assign(new Error('mail down'), { code: 'E_DELIVERY_FAILED' }); } });
  await ingest(critical('cancel-sent'), first.env);
  await worker.scheduled({}, first.env);
  const firstDelivery = latestDelivery(first.db, 'cancel-sent');
  assert.equal(firstDelivery.status, 'sent');
  await ingest(event('cancel-resolved', 'agent.stuck', 'critical', 'resolved', 'cancel-sent'), first.env);
  assert.deepEqual({ ...first.db.row("SELECT status, error_code FROM channel_attempts WHERE delivery_id = ? AND channel = 'email'", firstDelivery.id) }, { status: 'cancelled', error_code: 'E_RESOLVED_BEFORE_SEND' });

  const retry = setup({ fetchImpl: feishuFetch(), send: () => { throw Object.assign(new Error('mail down'), { code: 'E_DELIVERY_FAILED' }); } });
  await ingest(critical('retry-only-time'), retry.env);
  await worker.scheduled({}, retry.env);
  const sentAtBeforeRetry = retry.db.row("SELECT last_notification_at FROM incidents WHERE incident_key = 'surgeconf.watchdog:agent.stuck:retry-only-time'").last_notification_at;
  retry.env.EMAIL = { async send() { return { id: 'email-retry-success' }; } };
  time.set(MORNING + 5 * MINUTE);
  await worker.scheduled({}, retry.env);
  assert.equal(retry.db.row("SELECT last_notification_at FROM incidents WHERE incident_key = 'surgeconf.watchdog:agent.stuck:retry-only-time'").last_notification_at, sentAtBeforeRetry);
  const retried = latestDelivery(retry.db, 'retry-only-time');
  assert.equal(retried.status, 'sent');
  assert.equal(retried.message_id, 'email-retry-success');
  assert.equal(retry.db.row("SELECT status, message_id FROM channel_attempts WHERE delivery_id = ? AND channel = 'email'", retried.id).status, 'sent');

  const reopenFetch = feishuFetch([{ code: 0, data: { message_id: 'initial' } }, { code: 230020 }]);
  const reopen = setup({ fetchImpl: reopenFetch });
  await ingest(event('reopen-initial', 'agent.stuck', 'warning', 'firing', 'reopen-channel'), reopen.env);
  await worker.scheduled({}, reopen.env);
  await ingest(event('reopen-resolved', 'agent.stuck', 'warning', 'resolved', 'reopen-channel'), reopen.env);
  await worker.scheduled({}, reopen.env);
  const resolvedDelivery = latestDelivery(reopen.db, 'reopen-resolved');
  assert.equal(reopen.db.row("SELECT status FROM channel_attempts WHERE delivery_id = ? AND channel = 'feishu'", resolvedDelivery.id).status, 'pending');
  await ingest(event('reopen-firing', 'agent.stuck', 'warning', 'firing', 'reopen-channel'), reopen.env);
  assert.deepEqual({ ...reopen.db.row("SELECT status, error_code FROM channel_attempts WHERE delivery_id = ? AND channel = 'feishu'", resolvedDelivery.id) }, { status: 'cancelled', error_code: 'E_REOPENED_BEFORE_SEND' });
});

test('cancelled delivery does not rebuild an email fallback channel', async t => {
  clock(t);
  const fetchImpl = feishuFetch([{ code: 230013 }]);
  const { db, sent, env } = setup({ fetchImpl });
  cancelAfterChannelFailure(env, async () => ingest(event('fallback-cancel-resolved', 'approval.pending', 'warning', 'resolved', 'fallback-cancel'), env));
  await ingest(warning('fallback-cancel', { subject: 'fallback-cancel' }), env);
  await worker.scheduled({}, env);
  const delivery = latestDelivery(db, 'fallback-cancel');
  assert.equal(delivery.status, 'cancelled');
  assert.deepEqual(attempts(db, delivery.id).map(row => row.channel), ['feishu']);
  assert.equal(db.count("SELECT COUNT(*) AS count FROM channel_attempts WHERE delivery_id = ? AND channel = 'email'", delivery.id), 0);
  assert.equal(sent.length, 0);
});

test('channel failure does not resurrect an attempt cancelled during send', async t => {
  clock(t);
  let env;
  const fetchImpl = async url => {
    if (String(url).includes('/tenant_access_token/')) return response({ code: 0, tenant_access_token: samples.tenantToken, expire: 7200 });
    await ingest(event('failure-cancel-resolved', 'approval.pending', 'warning', 'resolved', 'failure-cancel'), env);
    throw new Error('network down');
  };
  const setupResult = setup({ fetchImpl });
  ({ env } = setupResult);
  await ingest(warning('failure-cancel', { subject: 'failure-cancel' }), env);
  await worker.scheduled({}, env);
  const delivery = latestDelivery(setupResult.db, 'failure-cancel');
  assert.equal(delivery.status, 'cancelled');
  assert.deepEqual(attempts(setupResult.db, delivery.id).map(row => [row.channel, row.status]), [['feishu', 'cancelled']]);
});

test('legacy pending delivery without channel attempts is rebuilt and sent by Cron', async t => {
  clock(t);
  const { db, env } = setup();
  await ingest(warning('legacy-pending'), env);
  const delivery = latestDelivery(db, 'legacy-pending');
  db.sqlite.prepare('DELETE FROM channel_attempts WHERE delivery_id = ?').run(delivery.id);
  db.sqlite.prepare("UPDATE deliveries SET attempts = 2, channel = 'email', error_code = 'E_LEGACY', message_id = NULL WHERE id = ?").run(delivery.id);
  await worker.scheduled({}, env);
  const sentDelivery = latestDelivery(db, 'legacy-pending');
  assert.deepEqual({ status: sentDelivery.status, attempts: sentDelivery.attempts, channel: sentDelivery.channel, error_code: sentDelivery.error_code }, { status: 'sent', attempts: 3, channel: 'feishu', error_code: null });
  assert.match(sentDelivery.message_id, /^feishu-message-/);
  assert.deepEqual(attempts(db, delivery.id).map(row => [row.channel, row.status, row.attempts]), [['feishu', 'sent', 1]]);
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

test('resolved follows only the latest first delivery in the current episode', async t => {
  const time = clock(t);
  const fetchImpl = feishuFetch([{ code: 230013 }, { code: 0, data: { message_id: 'episode-one-resolved' } }, { code: 0, data: { message_id: 'episode-two-first' } }, { code: 0, data: { message_id: 'episode-two-resolved' } }]);
  const { db, sent, env } = setup({ fetchImpl });
  await ingest(event('episode-one-first', 'agent.stuck', 'warning', 'firing', 'episode-subject'), env);
  await worker.scheduled({}, env);
  time.set(MORNING + 10 * MINUTE);
  await ingest(event('episode-one-resolved', 'agent.stuck', 'warning', 'resolved', 'episode-subject'), env);
  await worker.scheduled({}, env);
  time.set(MORNING + 20 * MINUTE);
  await ingest(event('episode-two-first', 'agent.stuck', 'warning', 'firing', 'episode-subject'), env);
  await worker.scheduled({}, env);
  time.set(MORNING + 30 * MINUTE);
  await ingest(event('episode-two-resolved', 'agent.stuck', 'warning', 'resolved', 'episode-subject'), env);
  await worker.scheduled({}, env);
  const resolved = latestDelivery(db, 'episode-two-resolved');
  assert.equal(resolved.channel, 'feishu');
  assert.equal(sent.length, 2);
});

test('daily-review info is recorded without a delivery or provider call', async t => {
  clock(t);
  const { db, sent, env, fetchImpl } = setup();
  const result = await ingest(dailyReview('daily-info', 'info', 'info'), env);
  assert.equal(result.decision, 'record');
  assert.equal(db.count("SELECT COUNT(*) AS count FROM deliveries WHERE event_id = 'daily-info'"), 0);
  assert.equal(sent.length, 0);
  assert.equal(fetchImpl.calls.length, 0);
});

test('daily-review warning follows the alert Feishu route', async t => {
  clock(t);
  const { db, sent, env, fetchImpl } = setup();
  await ingest(dailyReview('daily-warning'), env);
  await worker.scheduled({}, env);
  const delivery = latestDelivery(db, 'daily-warning');
  assert.equal(delivery.status, 'sent');
  assert.equal(sent.length, 0);
  assert.equal(fetchImpl.calls.filter(call => call.url.includes('/im/v1/messages')).length, 1);
});

test('daily-review warning at night sends on the next Cron run', async t => {
  clock(t, Date.parse('2026-11-10T16:00:00Z'));
  const { db, env, fetchImpl } = setup();
  const result = await ingest(dailyReview('daily-night'), env);
  assert.equal(result.delivery, 'pending');
  assert.equal(result.decision, 'send_alert');
  await worker.scheduled({}, env);
  const delivery = latestDelivery(db, 'daily-night');
  assert.equal(delivery.status, 'sent');
  assert.equal(delivery.next_attempt_at, null);
  assert.equal(fetchImpl.calls.filter(call => call.url.includes('/im/v1/messages')).length, 1);
});

test('HTTP allows daily-review only for tokens that list the kind', async t => {
  clock(t);
  const { db, env } = setup();
  const allowed = seedToken(db, 'daily-review-allowed', ['daily-review']);
  const denied = seedToken(db, 'daily-review-denied', ['agent.stuck']);
  const accepted = await worker.fetch(request(allowed, dailyReview('daily-http-allowed')), env);
  const forbidden = await worker.fetch(request(denied, dailyReview('daily-http-denied')), env);
  assert.equal(accepted.status, 200);
  assert.equal(forbidden.status, 403);
});

test('Feishu-only warning carries and clears omitted notice once', async t => {
  clock(t);
  const { db, env, fetchImpl } = setup();
  setOmitted(db, 2);
  await ingest(warning('omitted-feishu'), env);
  await worker.scheduled({}, env);
  const message = fetchImpl.calls.find(call => call.url.includes('/im/v1/messages'));
  const card = JSON.parse(JSON.parse(message.init.body).content);
  const note = card.body.elements.find(element => element.tag === 'div' && element.text?.text_size === 'notation');
  assert.match(note.text.content, /有 2 条提醒因限额未单独发送/);
  assert.equal(db.row("SELECT omitted_count FROM quota WHERE bucket = 'day:2026-11-11'").omitted_count, 0);
});

test('Feishu fallback email carries omitted notice and next fallback does not repeat it', async t => {
  clock(t);
  const fetchImpl = feishuFetch([{ code: 230013 }, { code: 230013 }]);
  const { db, sent, env } = setup({ fetchImpl });
  setOmitted(db, 2);
  await ingest(warning('omitted-fallback-one'), env);
  await worker.scheduled({}, env);
  assert.match(sent[0].text, /有 2 条提醒因限额未单独发送/);
  assert.equal(db.row("SELECT omitted_count FROM quota WHERE bucket = 'day:2026-11-11'").omitted_count, 0);
  await ingest(warning('omitted-fallback-two'), env);
  await worker.scheduled({}, env);
  assert.equal(sent.length, 2);
  assert.equal(sent[1].text.includes('有 2 条提醒因限额未单独发送'), false);
});

test('partial-success batch updates last_notification only for the delivery sent in this run', async t => {
  const time = clock(t);
  const fetchImpl = feishuFetch([{ code: 230020 }]);
  const { db, env } = setup({ fetchImpl });
  await ingest(critical('partial-a'), env);
  const deliveryA = latestDelivery(db, 'partial-a');
  db.sqlite.prepare("INSERT INTO channel_attempts (delivery_id, channel, status, attempts, message_id, sent_at) VALUES (?, 'feishu', 'sent', 1, 'already-feishu', ?)").run(deliveryA.id, new Date(MORNING).toISOString());
  db.sqlite.prepare("INSERT INTO channel_attempts (delivery_id, channel, status, attempts) VALUES (?, 'email', 'pending', 0)").run(deliveryA.id);
  await ingest(warning('partial-b'), env);
  time.set(MORNING + 5 * MINUTE);
  await worker.scheduled({}, env);
  const deliveryB = latestDelivery(db, 'partial-b');
  assert.equal(latestDelivery(db, 'partial-a').status, 'sent');
  assert.equal(deliveryB.status, 'pending');
  assert.ok(db.row("SELECT last_notification_at FROM incidents WHERE incident_key = 'surgeconf.watchdog:agent.stuck:partial-a'").last_notification_at);
  assert.equal(db.row("SELECT last_notification_at FROM incidents WHERE incident_key = 'surgeconf.watchdog:approval.pending:partial-b'").last_notification_at, null);
});

test('follow channel episode comparison normalizes Z and +08:00 timestamps', async t => {
  const time = clock(t);
  const { db, sent, env } = setup();
  await ingest(event('mixed-zone-first', 'agent.stuck', 'warning', 'firing', 'mixed-zone'), env);
  await worker.scheduled({}, env);
  db.sqlite.prepare("UPDATE incidents SET first_seen = '2026-11-11T09:00:00+08:00' WHERE incident_key = 'surgeconf.watchdog:agent.stuck:mixed-zone'").run();
  time.set(MORNING + 10 * MINUTE);
  await ingest(event('mixed-zone-resolved', 'agent.stuck', 'warning', 'resolved', 'mixed-zone'), env);
  await worker.scheduled({}, env);
  const resolved = latestDelivery(db, 'mixed-zone-resolved');
  assert.equal(resolved.channel, 'feishu');
  assert.equal(sent.length, 0);
});

const healthEvent = (id, kind = 'job.health', severity = 'info', state = 'info', subject = id, extra = {}) => ({
  schema: 'notify.event/v1', event_id: id, source: 'mybrain.job-health', kind, subject, state, severity,
  occurred_at: new Date(MORNING).toISOString(), title: id, ...extra,
});
function seedHealthToken(db, token = 'cpn_health_test') {
  const hash = createHash('sha256').update(token).digest('hex');
  db.sqlite.prepare('INSERT INTO producer_tokens (token_id, token_hash, source, kinds_json, created_at) VALUES (?, ?, ?, ?, ?)').run(`test-${token}`, hash, 'mybrain.job-health', JSON.stringify(['job.health', 'job.unhealthy']), new Date().toISOString());
  return token;
}
function sentCards(fetchImpl) {
  return fetchImpl.calls.filter(call => call.url.includes('/im/v1/messages')).map(call => JSON.parse(JSON.parse(call.init.body).content));
}

test('job.health info alerts send through Feishu and send again for the next daily subject', async t => {
  const time = clock(t);
  const { db, sent, env, fetchImpl } = setup();
  const token = seedHealthToken(db);
  const firstResponse = await worker.fetch(request(token, healthEvent('health-daily-1', 'job.health', 'info', 'info', 'daily')), env);
  assert.equal(firstResponse.status, 200);
  const first = await firstResponse.json();
  assert.equal(first.decision, 'send_alert');
  assert.equal(first.delivery, 'pending');
  assert.equal(sent.length, 0);
  await worker.scheduled({}, env);
  assert.equal(latestDelivery(db, 'health-daily-1').status, 'sent');
  assert.equal(latestDelivery(db, 'health-daily-1').channel, 'feishu');
  assert.equal(sent.length, 0);
  time.set(MORNING + 24 * 60 * MINUTE);
  const secondResponse = await worker.fetch(request(token, healthEvent('health-daily-2', 'job.health', 'info', 'info', 'daily')), env);
  assert.equal(secondResponse.status, 200);
  const second = await secondResponse.json();
  assert.equal(second.decision, 'send_alert');
  await worker.scheduled({}, env);
  assert.equal(db.count("SELECT COUNT(*) AS count FROM deliveries WHERE status = 'sent'"), 2);
  assert.equal(fetchImpl.calls.filter(call => call.url.includes('/im/v1/messages')).length, 2);
});

test('job.unhealthy sends repeated firing and resolved Feishu notifications', async t => {
  const time = clock(t);
  const { db, sent, env, fetchImpl } = setup();
  assert.equal((await ingest(healthEvent('unhealthy-1', 'job.unhealthy', 'warning', 'firing', 'service-x', { title: 'unhealthy-1' }), env)).decision, 'send_alert');
  await worker.scheduled({}, env);
  time.set(MORNING + MINUTE);
  assert.equal((await ingest(healthEvent('unhealthy-2', 'job.unhealthy', 'warning', 'firing', 'service-x', { title: 'unhealthy-2' }), env)).decision, 'send_alert');
  await worker.scheduled({}, env);
  assert.equal(fetchImpl.calls.filter(call => call.url.includes('/im/v1/messages')).length, 2);
  assert.equal(sent.length, 0);
  assert.equal((await ingest(healthEvent('unhealthy-resolved', 'job.unhealthy', 'warning', 'resolved', 'service-x', { title: 'recovered' }), env)).decision, 'send_resolved');
  await worker.scheduled({}, env);
  assert.equal(latestDelivery(db, 'unhealthy-resolved').status, 'sent');
  assert.equal(fetchImpl.calls.filter(call => call.url.includes('/im/v1/messages')).length, 3);
});

test('job.unhealthy firing at night sends on the next Cron run', async t => {
  const time = clock(t, Date.parse('2026-11-10T17:00:00Z'));
  const { db, sent, env } = setup();
  const result = await ingest(healthEvent('unhealthy-night', 'job.unhealthy', 'warning', 'firing', 'night-service'), env);
  assert.equal(result.decision, 'send_alert');
  await worker.scheduled({}, env);
  assert.equal(latestDelivery(db, 'unhealthy-night').status, 'sent');
  assert.equal(latestDelivery(db, 'unhealthy-night').next_attempt_at, null);
  assert.equal(sent.length, 0);
  time.set(Date.parse('2026-11-10T17:01:00Z'));
});

test('job.health remains a standalone card beside a warning batch and preserves twelve facts', async t => {
  clock(t);
  const { env, fetchImpl } = setup();
  await ingest(healthEvent('health-card', 'job.health', 'info', 'info', 'daily-card', {
    title: '🟩 编号 42', summary: 'daily summary',
    facts: Array.from({ length: 12 }, (_, index) => ({ label: `fact-${index}`, value: `value-${index}` })),
  }), env);
  await ingest(warning('other-warning-1', { title: 'warning-title-1' }), env);
  await ingest(warning('other-warning-2', { title: 'warning-title-2' }), env);
  await worker.scheduled({}, env);
  const cards = sentCards(fetchImpl);
  assert.equal(cards.length, 2);
  const healthCard = cards.find(card => card.header.title.content === '[通知] 🟩 编号 42');
  assert.ok(healthCard);
  assert.equal(healthCard.body.elements.filter(element => element.text?.content?.startsWith('- fact-')).length, 12);
  assert.ok(healthCard.body.elements.length <= 200);
  assert.ok(cards.some(card => card.header.title.content === '[注意] 2 条提醒'));
});

test('a pending standalone Feishu failure does not skip the same-run warning group', async t => {
  clock(t);
  const fetchImpl = feishuFetch([{ code: 230020 }, { code: 0, data: { message_id: 'warning-after-health-failure' } }]);
  const { db, env } = setup({ fetchImpl });
  await ingest(healthEvent('health-failure-group', 'job.health', 'info', 'info', 'daily-failure'), env);
  await ingest(warning('warning-after-health-failure'), env);
  await worker.scheduled({}, env);
  assert.equal(latestDelivery(db, 'health-failure-group').status, 'pending');
  assert.equal(latestDelivery(db, 'warning-after-health-failure').status, 'sent');
  assert.equal(fetchImpl.calls.filter(call => call.url.includes('/im/v1/messages')).length, 2);
});

test('standalone and merged groups each reserve one quota when only one remains', async t => {
  clock(t);
  const { db, env, fetchImpl } = setup();
  db.sqlite.prepare("INSERT INTO quota (bucket, day_count) VALUES ('day:2026-11-11', 19)").run();
  db.sqlite.prepare("INSERT INTO quota (bucket, hour_count) VALUES ('hour:2026-11-11T09', 5)").run();
  await ingest(healthEvent('health-quota-one', 'job.health', 'info', 'info', 'quota-health'), env);
  await ingest(warning('warning-quota-two'), env);
  await worker.scheduled({}, env);
  assert.equal(latestDelivery(db, 'health-quota-one').status, 'sent');
  assert.equal(latestDelivery(db, 'warning-quota-two').status, 'pending');
  assert.equal(latestDelivery(db, 'warning-quota-two').quota_omitted, 1);
  assert.equal(db.row("SELECT day_count FROM quota WHERE bucket = 'day:2026-11-11'").day_count, 20);
  assert.equal(db.row("SELECT hour_count FROM quota WHERE bucket = 'hour:2026-11-11T09'").hour_count, 6);
  assert.equal(fetchImpl.calls.filter(call => call.url.includes('/im/v1/messages')).length, 1);
});

test('a quota denial keeps the retry rows of the same batch and omits only the new one', async t => {
  const time = clock(t);
  const fetchImpl = feishuFetch(index => index === 1 ? { code: 230020 } : { code: 0, data: { message_id: `retry-after-denial-${index}` } });
  const { db, env } = setup({ fetchImpl });
  await ingest(warning('denied-retry'), env);
  await worker.scheduled({}, env);
  assert.equal(latestDelivery(db, 'denied-retry').status, 'pending');
  await ingest(warning('denied-new'), env);
  db.sqlite.prepare("UPDATE quota SET day_count = 20, hour_count = 6 WHERE bucket LIKE 'day:%' OR bucket LIKE 'hour:%'").run();
  time.set(MORNING + 5 * MINUTE);
  await worker.scheduled({}, env);
  assert.equal(latestDelivery(db, 'denied-retry').status, 'sent');
  assert.equal(latestDelivery(db, 'denied-new').status, 'pending');
  assert.equal(latestDelivery(db, 'denied-new').quota_omitted, 1);
  assert.equal(db.row("SELECT day_count FROM quota WHERE bucket LIKE 'day:%'").day_count, 20);
  assert.equal(db.row("SELECT hour_count FROM quota WHERE bucket LIKE 'hour:%'").hour_count, 6);
});

function seedLedgerToken(db, token = 'cpn_ledger_test') {
  const hash = createHash('sha256').update(token).digest('hex');
  db.sqlite.prepare('INSERT INTO producer_tokens (token_id, token_hash, source, kinds_json, created_at) VALUES (?, ?, ?, ?, ?)').run(`test-${token}`, hash, 'mybrain.ledger', JSON.stringify(['ledger.digest']), new Date().toISOString());
  return token;
}
function ledgerEvent(id, subject, title, occurredAt = MORNING) {
  return {
    schema: 'notify.event/v1', event_id: id, source: 'mybrain.ledger', kind: 'ledger.digest', subject,
    state: 'info', severity: 'info', occurred_at: new Date(occurredAt).toISOString(), title,
    summary: `${subject} summary`, facts: Array.from({ length: 12 }, (_, index) => ({ label: `${subject}-fact-${index}`, value: `${subject}-value-${index}` })),
  };
}

test('ledger.digest sends noon evening and close as separate cards and repeats the subject next day', async t => {
  const time = clock(t);
  const { db, env, fetchImpl } = setup();
  const token = seedLedgerToken(db);
  const digests = [
    ['ledger-noon', 'noon', '🟩 编号 101'],
    ['ledger-evening', 'evening', '🟦 编号 102'],
    ['ledger-close', 'close', '🟨 编号 103'],
  ];
  for (const [id, subject, title] of digests) {
    const response = await worker.fetch(request(token, ledgerEvent(id, subject, title)), env);
    assert.equal(response.status, 200);
    assert.equal((await response.json()).decision, 'send_alert');
  }
  await ingest(warning('ledger-warning', { title: 'warning beside ledger' }), env);
  await worker.scheduled({}, env);
  const firstCards = sentCards(fetchImpl);
  assert.equal(firstCards.length, 4);
  for (const [, subject, title] of digests) {
    const card = firstCards.find(candidate => candidate.header.title.content === `[通知] ${title}`);
    assert.ok(card);
    const facts = card.body.elements.filter(element => element.text?.content?.startsWith(`- ${subject}-fact-`));
    assert.equal(facts.length, 12);
    for (let index = 0; index < 12; index += 1) assert.ok(facts.some(element => element.text.content === `- ${subject}-fact-${index}：${subject}-value-${index}`));
  }
  assert.ok(firstCards.some(card => card.header.title.content === '[注意] warning beside ledger'));

  time.set(MORNING + 24 * 60 * MINUTE);
  const next = await worker.fetch(request(token, ledgerEvent('ledger-noon-next', 'noon', '🟩 编号 104', MORNING + 24 * 60 * MINUTE)), env);
  assert.equal(next.status, 200);
  await worker.scheduled({}, env);
  const cards = sentCards(fetchImpl);
  assert.equal(cards.length, 5);
  assert.ok(cards.some(card => card.header.title.content === '[通知] 🟩 编号 104'));
  assert.equal(db.count("SELECT COUNT(*) AS count FROM events WHERE kind = 'ledger.digest'"), 4);
});

test('ledger.digest creates a new standalone delivery when yesterday is still pending', async t => {
  const time = clock(t);
  const { db, env, fetchImpl } = setup();
  await ingest(ledgerEvent('ledger-pending-old', 'noon', '🟩 编号 201'), env);
  db.sqlite.prepare("INSERT INTO quota (bucket, day_count, hour_count) VALUES ('day:2026-11-11', 20, 6)").run();
  await worker.scheduled({}, env);
  assert.equal(latestDelivery(db, 'ledger-pending-old').status, 'pending');

  time.set(MORNING + 24 * 60 * MINUTE);
  const next = await ingest(ledgerEvent('ledger-pending-new', 'noon', '🟩 编号 202', MORNING + 24 * 60 * MINUTE), env);
  assert.equal(next.delivery, 'pending');
  assert.equal(db.count("SELECT COUNT(*) AS count FROM deliveries WHERE incident_key = 'mybrain.ledger:ledger.digest:noon'"), 2);
  await worker.scheduled({}, env);
  assert.ok(fetchImpl.calls.some(call => call.url.includes('/im/v1/messages')));
  assert.equal(latestDelivery(db, 'ledger-pending-new').status, 'sent');
  assert.ok(sentCards(fetchImpl).some(card => card.header.title.content === '[通知] 🟩 编号 202'));
});
