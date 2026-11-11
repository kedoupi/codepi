import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';
import test from 'node:test';

const root = path.resolve(new URL('../../..', import.meta.url).pathname);
const migration = `${await readFile(path.join(root, 'services/notify/migrations/0001_notify.sql'), 'utf8')}\n${await readFile(path.join(root, 'services/notify/migrations/0002_channel_attempts.sql'), 'utf8')}`;
const { default: worker, NotifyApi, ingest } = await import('../src/index.ts');
import { RULES } from '../src/rules.ts';

const MINUTE = 60 * 1000;
// 09:00 Beijing time, used as the default test clock.
const MORNING = Date.parse('2026-11-11T01:00:00Z');

class D1 {
  constructor() { this.sqlite = new DatabaseSync(':memory:'); this.sqlite.exec(migration); }
  prepare(sql) {
    const db = this.sqlite;
    return {
      bind(...values) {
        const statement = db.prepare(sql);
        return {
          first: async () => statement.get(...values) ?? null,
          all: async () => ({ results: statement.all(...values) }),
          run: async () => ({ meta: { changes: Number(statement.run(...values).changes ?? 0) } }),
        };
      },
    };
  }
  batch(statements) { return Promise.all(statements.map(statement => statement.run())); }
  count(sql, ...values) { return Number(this.sqlite.prepare(sql).get(...values).count); }
  row(sql, ...values) { return this.sqlite.prepare(sql).get(...values); }
  rows(sql, ...values) { return this.sqlite.prepare(sql).all(...values); }
}

function setup(send) {
  const db = new D1();
  const sent = [];
  const env = {
    DB: db, NOTIFY_TO: 'owner@example.invalid',
    EMAIL: { async send(message) { sent.push(message); if (send) return send(message, sent.length); return { id: `msg-${sent.length}` }; } },
  };
  return { db, sent, env };
}
function seedToken(db, token = 'cpn_test_secret') {
  const hash = createHash('sha256').update(token).digest('hex');
  db.sqlite.prepare('INSERT INTO producer_tokens (token_id, token_hash, source, kinds_json, created_at) VALUES (?, ?, ?, ?, ?)').run('test', hash, 'surgeconf.watchdog', JSON.stringify(['notify.selftest', 'agent.stuck']), new Date().toISOString());
  return token;
}
function request(token, body, init = {}) {
  return new Request('https://notify-api.codepi.app/v1/events', {
    method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${token}`, ...init.headers },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}
const base = {
  schema: 'notify.event/v1', event_id: 'event-1', source: 'surgeconf.watchdog', kind: 'notify.selftest', subject: 'test',
  state: 'info', severity: 'info', occurred_at: '2026-11-10T00:00:00Z', title: 'selftest',
};
const alert = (id, subject, extra = {}) => ({ ...base, event_id: id, kind: 'agent.stuck', state: 'firing', severity: 'critical', subject, title: id, ...extra });
function dayBucket(now) {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date(now));
  const values = Object.fromEntries(parts.filter(part => part.type !== 'literal').map(part => [part.type, part.value]));
  return `day:${values.year}-${values.month}-${values.day}`;
}
function clock(t, now = MORNING) {
  t.mock.timers.enable({ apis: ['Date'], now });
  return { set: value => t.mock.timers.setTime(value) };
}
function cancelBeforeClaim(env, callback) {
  const originalPrepare = env.DB.prepare.bind(env.DB);
  let armed = true;
  env.DB.prepare = sql => {
    const statement = originalPrepare(sql);
    if (!armed || sql !== "UPDATE deliveries SET status = CASE WHEN status = 'sent' THEN 'sent' ELSE 'pending' END WHERE id = ?1 AND status <> 'cancelled'") return statement;
    return { bind(...values) {
      const bound = statement.bind(...values);
      return {
        first: bound.first,
        all: bound.all,
        run: async () => { armed = false; await callback(Number(values[0])); return bound.run(); },
      };
    } };
  };
}

test('HTTP entry enforces token, source, kind, payload and size boundaries', async t => {
  clock(t);
  const { db, sent, env } = setup();
  const token = seedToken(db);
  assert.equal((await worker.fetch(new Request('https://notify-api.codepi.app/v1/events', { method: 'POST', body: '{}' }), env)).status, 401);
  assert.equal((await worker.fetch(new Request('https://notify-api.codepi.app/v1/events', { method: 'POST', headers: { authorization: 'Bearer bad', 'content-type': 'application/json' }, body: '{}' }), env)).status, 401);
  assert.equal((await worker.fetch(request(token, { ...base, source: 'other' }), env)).status, 403);
  assert.equal((await worker.fetch(request(token, { ...base, kind: 'plans.orphan_digest' }), env)).status, 403);
  assert.equal((await worker.fetch(request(token, { ...base, to: 'leak@example.invalid' }), env)).status, 400);
  assert.equal((await worker.fetch(new Request('https://notify-api.codepi.app/v1/events', { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'text/plain' }, body: '{bad' }), env)).status, 400);
  assert.equal((await worker.fetch(request(token, '{bad'), env)).status, 400);
  const tooLarge = new ReadableStream({ start(controller) { controller.enqueue(new TextEncoder().encode('x'.repeat(16 * 1024 + 1))); controller.close(); } });
  assert.equal((await worker.fetch(new Request('https://notify-api.codepi.app/v1/events', { method: 'POST', duplex: 'half', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: tooLarge }), env)).status, 413);
  assert.equal((await worker.fetch(new Request('https://notify-api.codepi.app/v1/events/%', { headers: { authorization: `Bearer ${token}` } }), env)).status, 400);
  assert.equal((await worker.fetch(new Request('https://notify-api.codepi.app/other', { headers: { authorization: `Bearer ${token}` } }), env)).status, 404);
  assert.equal((await worker.fetch(new Request('https://other.codepi.app/v1/events', { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify(base) }), env)).status, 404);
  assert.equal(db.count('SELECT COUNT(*) AS count FROM events'), 0);
  assert.equal(sent.length, 0);
});

test('immediate selftest sends once at night, reads back without the recipient and stays idempotent', async t => {
  clock(t, Date.parse('2026-11-10T16:00:00Z'));
  const { db, sent, env } = setup();
  const token = seedToken(db);
  const response = await worker.fetch(request(token, base), env);
  assert.equal(response.status, 200);
  const result = await response.json();
  assert.equal(result.delivery, 'sent');
  assert.equal(result.message_id, 'msg-1');
  assert.equal(sent[0].to, env.NOTIFY_TO);
  const events = db.count('SELECT COUNT(*) AS count FROM events');
  const deliveries = db.count('SELECT COUNT(*) AS count FROM deliveries');
  assert.deepEqual([events, deliveries, sent.length], [1, 1, 1]);
  for (let index = 0; index < 3; index += 1) {
    const duplicate = await (await worker.fetch(request(token, { ...base, title: 'changed' }), env)).json();
    assert.equal(duplicate.duplicate, true);
    assert.equal(duplicate.decision, 'send_immediate');
  }
  assert.equal((await ingest(base, env)).duplicate, true);
  await worker.scheduled({}, env);
  assert.equal(db.count('SELECT COUNT(*) AS count FROM events'), events);
  assert.equal(db.count('SELECT COUNT(*) AS count FROM deliveries'), deliveries);
  assert.equal(sent.length, 1);
  const readBack = await (await worker.fetch(new Request('https://notify-api.codepi.app/v1/events/event-1', { headers: { authorization: `Bearer ${token}` } }), env)).json();
  assert.equal(readBack.event.event_id, 'event-1');
  assert.equal(readBack.event.title, 'selftest');
  assert.equal(readBack.deliveries.length, 1);
  assert.equal(readBack.deliveries[0].status, 'sent');
  assert.equal(readBack.deliveries[0].message_id, 'msg-1');
  assert.equal(JSON.stringify(readBack).includes(env.NOTIFY_TO), false);
});

test('RPC entrypoint fixes the source and shares the HTTP rules', async t => {
  clock(t);
  const { env } = setup();
  const rpc = Object.create(NotifyApi.prototype);
  rpc.env = { ...env, EMAIL: { async send() { return { messageId: 'rpc-msg' }; } } };
  await assert.rejects(rpc.emit({ ...base, event_id: 'rpc-wrong', source: 'surgeconf.watchdog' }), /source_not_allowed/);
  await assert.rejects(rpc.emit({ ...base, event_id: 'rpc-kind', source: 'rpc', kind: 'agent.stuck' }), /kind_not_allowed/);
  await assert.rejects(rpc.emit({ ...base, event_id: 'rpc-to', source: 'rpc', to: 'x@example.invalid' }), /unknown field/);
  const rpcResult = await rpc.emit({ ...base, event_id: 'rpc-ok', source: 'rpc' });
  assert.equal(rpcResult.delivery, 'sent');
  assert.equal(rpcResult.message_id, 'rpc-msg');
});

test('alert events wait for Cron, which merges due deliveries into one email', async t => {
  clock(t);
  const { db, sent, env } = setup();
  assert.equal((await ingest(alert('cron-1', 'subject-a', { title: 'a' }), env)).delivery, 'pending');
  assert.equal((await ingest(alert('cron-2', 'subject-b', { severity: 'warning', title: 'b' }), env)).delivery, 'pending');
  assert.equal(sent.length, 0);
  await worker.scheduled({}, env);
  assert.equal(sent.length, 1);
  assert.match(sent[0].subject, /^\[严重\] 2 条提醒/);
  assert.equal(db.count("SELECT COUNT(*) AS count FROM deliveries WHERE status = 'sent' AND message_id = 'msg-1'"), 2);
  await worker.scheduled({}, env);
  assert.equal(sent.length, 1);
});

test('alert forMs waits for a later firing before Cron sends once', async t => {
  const time = clock(t);
  const { db, sent, env } = setup();
  RULES.push({ kind: 'test.for', sources: ['surgeconf.watchdog'], mode: 'alert', for: 5 * MINUTE, forMs: 5 * MINUTE, cooldown: 0, cooldownMs: 0, notifyResolved: true });
  t.after(() => RULES.pop());
  const first = alert('for-first', 'for-subject', { kind: 'test.for', occurred_at: new Date(MORNING).toISOString() });
  assert.equal((await ingest(first, env)).decision, 'deferred_for');
  assert.equal(db.row("SELECT pending_until FROM incidents WHERE incident_key = 'surgeconf.watchdog:test.for:for-subject'").pending_until, new Date(MORNING + 5 * MINUTE).toISOString());
  assert.equal(db.count('SELECT COUNT(*) AS count FROM deliveries'), 0);
  await worker.scheduled({}, env);
  assert.equal(sent.length, 0);
  time.set(MORNING + 5 * MINUTE + 1);
  assert.equal((await ingest(alert('for-second', 'for-subject', { kind: 'test.for', occurred_at: new Date(MORNING + 5 * MINUTE + 1).toISOString() }), env)).decision, 'send_alert');
  assert.equal(db.count("SELECT COUNT(*) AS count FROM deliveries WHERE status = 'pending'"), 1);
  await worker.scheduled({}, env);
  assert.equal(sent.length, 1);
  assert.equal(db.count("SELECT COUNT(*) AS count FROM deliveries WHERE status = 'sent'"), 1);
});

test('duplicate resolved events keep one pending recovery delivery', async t => {
  const time = clock(t);
  const { db, sent, env } = setup();
  await ingest(alert('resolved-first-firing', 'duplicate-resolved'), env);
  await worker.scheduled({}, env);
  time.set(MORNING + MINUTE);
  await ingest(alert('resolved-first', 'duplicate-resolved', { state: 'resolved' }), env);
  const second = await ingest(alert('resolved-second', 'duplicate-resolved', { state: 'resolved' }), env);
  assert.equal(second.decision, 'resolved');
  assert.equal(db.count("SELECT COUNT(*) AS count FROM deliveries WHERE notification_type = 'resolved'"), 1);
  assert.equal(db.count("SELECT COUNT(*) AS count FROM deliveries WHERE notification_type = 'resolved' AND status = 'pending'"), 1);
  await worker.scheduled({}, env);
  assert.equal(sent.length, 2);
  assert.equal(db.count("SELECT COUNT(*) AS count FROM deliveries WHERE notification_type = 'resolved' AND status = 'sent'"), 1);
  time.set(MORNING + 2 * MINUTE);
  await worker.scheduled({}, env);
  assert.equal(sent.length, 2);
});

test('Cron skips a delivery cancelled after it was read', async t => {
  const time = clock(t);
  const { db, sent, env } = setup();
  await ingest(alert('race-firing-1', 'race-subject'), env);
  await worker.scheduled({}, env);
  time.set(MORNING + 7 * 60 * MINUTE);
  await ingest(alert('race-firing-2', 'race-subject', { occurred_at: new Date(MORNING + 7 * 60 * MINUTE).toISOString() }), env);
  cancelBeforeClaim(env, async () => ingest(alert('race-resolved', 'race-subject', { state: 'resolved' }), env));
  await worker.scheduled({}, env);
  assert.equal(sent.length, 1);
  assert.equal(db.row("SELECT status FROM deliveries WHERE event_id = 'race-firing-2'").status, 'cancelled');
  assert.equal(db.count("SELECT COUNT(*) AS count FROM channel_attempts WHERE delivery_id = (SELECT id FROM deliveries WHERE event_id = 'race-firing-2') AND status = 'pending'"), 0);
  assert.equal(db.row("SELECT status FROM deliveries WHERE event_id = 'race-resolved'").status, 'pending');
  await worker.scheduled({}, env);
  assert.equal(sent.length, 2);
  assert.equal(db.row("SELECT status FROM deliveries WHERE event_id = 'race-resolved'").status, 'sent');
});

test('Cron keeps all-cancelled channels cancelled and does not rebuild them', async t => {
  clock(t);
  const { db, sent, env } = setup();
  await ingest(alert('cancelled-channels', 'cancelled-subject', { severity: 'warning' }), env);
  const delivery = db.row("SELECT id FROM deliveries WHERE event_id = 'cancelled-channels'");
  db.sqlite.prepare("INSERT INTO channel_attempts (delivery_id, channel, status, attempts, error_code) VALUES (?, 'feishu', 'cancelled', 1, 'E_REOPENED_BEFORE_SEND')").run(delivery.id);
  await worker.scheduled({}, env);
  assert.equal(sent.length, 0);
  assert.deepEqual({ ...db.row('SELECT status FROM deliveries WHERE id = ?', delivery.id) }, { status: 'cancelled' });
  assert.equal(db.count('SELECT COUNT(*) AS count FROM channel_attempts WHERE delivery_id = ?', delivery.id), 1);
  assert.equal(db.count("SELECT COUNT(*) AS count FROM channel_attempts WHERE delivery_id = ? AND status = 'pending'", delivery.id), 0);
});

test('cooldown suppresses repeats, then sends 仍未恢复 and a recovery email', async t => {
  const time = clock(t);
  const { db, sent, env } = setup();
  await ingest(alert('first', 'subject-a'), env);
  await worker.scheduled({}, env);
  assert.equal(sent.length, 1);
  time.set(MORNING + 60 * MINUTE);
  assert.equal((await ingest(alert('cooling', 'subject-a'), env)).decision, 'cooled_down');
  await worker.scheduled({}, env);
  assert.equal(sent.length, 1);
  time.set(MORNING + 6 * 60 * MINUTE + MINUTE);
  await ingest(alert('repeat', 'subject-a'), env);
  await worker.scheduled({}, env);
  assert.equal(sent.length, 2);
  assert.match(sent[1].subject, /仍未恢复/);
  await ingest(alert('resolved', 'subject-a', { state: 'resolved' }), env);
  await worker.scheduled({}, env);
  assert.equal(sent.length, 3);
  assert.match(sent[2].subject, /^\[恢复\]/);
  assert.deepEqual(db.rows("SELECT notification_no FROM deliveries WHERE incident_key = 'surgeconf.watchdog:agent.stuck:subject-a' ORDER BY id").map(row => row.notification_no), [1, 2, 3]);
  assert.equal(db.row("SELECT notification_count FROM incidents WHERE incident_key = 'surgeconf.watchdog:agent.stuck:subject-a'").notification_count, 3);
});

test('resolved cancels every pending delivery of a notified incident and sends recovery', async t => {
  const time = clock(t);
  const { db, sent, env } = setup();
  await ingest(alert('notified-firing', 'pending-subject', { severity: 'warning' }), env);
  await worker.scheduled({}, env);
  assert.equal(sent.length, 1);
  const key = 'surgeconf.watchdog:agent.stuck:pending-subject';
  for (const no of [2, 3]) {
    db.sqlite.prepare("UPDATE incidents SET notification_count = notification_count + 1 WHERE incident_key = ?").run(key);
    db.sqlite.prepare("INSERT INTO deliveries (event_id, incident_key, notification_no, notification_type, status) VALUES ('notified-firing', ?, ?, 'repeat', 'pending')").run(key, no);
  }
  time.set(MORNING + 10 * MINUTE);
  await ingest(alert('pending-resolved', 'pending-subject', { state: 'resolved', severity: 'warning' }), env);
  assert.equal(db.count("SELECT COUNT(*) AS count FROM deliveries WHERE incident_key = ? AND status = 'cancelled' AND error_code = 'E_RESOLVED_BEFORE_SEND'", key), 2);
  await worker.scheduled({}, env);
  assert.equal(sent.length, 2);
  assert.match(sent[1].subject, /^\[恢复\]/);
});

test('resolved before any email was sent cancels the firing and sends no recovery', async t => {
  clock(t);
  const { db, sent, env } = setup();
  await ingest(alert('never-firing', 'never-subject', { severity: 'warning' }), env);
  const resolved = await ingest(alert('never-resolved', 'never-subject', { state: 'resolved', severity: 'warning' }), env);
  assert.equal(resolved.decision, 'resolved');
  assert.equal(db.row("SELECT status FROM deliveries WHERE event_id = 'never-firing'").status, 'cancelled');
  assert.equal(db.count("SELECT COUNT(*) AS count FROM deliveries WHERE event_id = 'never-resolved'"), 0);
  await worker.scheduled({}, env);
  assert.equal(sent.length, 0);
});

test('a firing after recovery reopens the incident and sends a fresh first email', async t => {
  const time = clock(t);
  const { db, sent, env } = setup();
  await ingest(alert('episode-1', 'flap'), env);
  await worker.scheduled({}, env);
  time.set(MORNING + 10 * MINUTE);
  await ingest(alert('episode-1-resolved', 'flap', { state: 'resolved' }), env);
  await worker.scheduled({}, env);
  assert.equal(sent.length, 2);
  assert.match(sent[1].subject, /^\[恢复\]/);
  time.set(MORNING + 70 * MINUTE);
  const reopened = await ingest(alert('episode-2', 'flap', { occurred_at: new Date(MORNING + 70 * MINUTE).toISOString() }), env);
  assert.equal(reopened.decision, 'send_alert');
  await worker.scheduled({}, env);
  assert.equal(sent.length, 3);
  assert.equal(sent[2].subject.includes('仍未恢复'), false);
  assert.match(sent[2].subject, /^\[严重\] episode-2/);
  const incident = db.row("SELECT status, first_seen, event_count, last_notification_at FROM incidents WHERE incident_key = 'surgeconf.watchdog:agent.stuck:flap'");
  assert.equal(incident.status, 'open');
  assert.equal(incident.first_seen, new Date(MORNING + 70 * MINUTE).toISOString());
  assert.equal(incident.event_count, 1);
  assert.equal(incident.last_notification_at, new Date(MORNING + 70 * MINUTE).toISOString());
  assert.equal(db.row("SELECT notification_type FROM deliveries WHERE event_id = 'episode-2'").notification_type, 'first');
});

test('a firing before the recovery email goes out cancels it and sends only a first email', async t => {
  const time = clock(t);
  const { db, sent, env } = setup();
  await ingest(alert('reopen-1', 'reopen'), env);
  await worker.scheduled({}, env);
  assert.equal(sent.length, 1);
  time.set(MORNING + 10 * MINUTE);
  await ingest(alert('reopen-resolved', 'reopen', { state: 'resolved' }), env);
  assert.equal(db.row("SELECT status FROM deliveries WHERE event_id = 'reopen-resolved'").status, 'pending');
  time.set(MORNING + 12 * MINUTE);
  const reopened = await ingest(alert('reopen-2', 'reopen', { occurred_at: new Date(MORNING + 12 * MINUTE).toISOString() }), env);
  assert.equal(reopened.decision, 'send_alert');
  await worker.scheduled({}, env);
  assert.equal(sent.length, 2);
  assert.equal(sent[1].subject.startsWith('[恢复]'), false);
  assert.match(sent[1].subject, /^\[严重\] reopen-2$/);
  assert.deepEqual({ ...db.row("SELECT status, error_code FROM deliveries WHERE event_id = 'reopen-resolved'") }, { status: 'cancelled', error_code: 'E_REOPENED_BEFORE_SEND' });
  assert.deepEqual({ ...db.row("SELECT status, notification_type FROM deliveries WHERE event_id = 'reopen-2'") }, { status: 'sent', notification_type: 'first' });
});

test('warning at 23:30 sends on the next Cron run', async t => {
  const time = clock(t, Date.parse('2026-11-10T15:30:00Z'));
  const { db, sent, env } = setup();
  const result = await ingest(alert('night-warning', 'night-warning', { severity: 'warning' }), env);
  assert.equal(result.decision, 'send_alert');
  assert.equal(db.row("SELECT next_attempt_at FROM deliveries WHERE event_id = 'night-warning'").next_attempt_at, null);
  await worker.scheduled({}, env);
  assert.equal(sent.length, 1);
  assert.match(sent[0].subject, /^\[注意\] night-warning$/);
  assert.equal(db.row("SELECT status FROM deliveries WHERE event_id = 'night-warning'").status, 'sent');
  time.set(Date.parse('2026-11-10T15:31:00Z'));
});

test('a legacy 08:00 delivery sends after its scheduled time', async t => {
  const time = clock(t, Date.parse('2026-11-10T19:00:00Z'));
  const { db, sent, env } = setup();
  await ingest(alert('legacy-night', 'legacy-night', { severity: 'warning' }), env);
  db.sqlite.prepare("UPDATE deliveries SET next_attempt_at = '2026-11-11T00:00:00.000Z' WHERE event_id = 'legacy-night'").run();
  time.set(Date.parse('2026-11-10T23:59:00Z'));
  await worker.scheduled({}, env);
  assert.equal(sent.length, 0);
  time.set(Date.parse('2026-11-11T00:00:00Z'));
  await worker.scheduled({}, env);
  assert.equal(sent.length, 1);
  assert.equal(db.row("SELECT status FROM deliveries WHERE event_id = 'legacy-night'").status, 'sent');
});

test('a merged batch takes its metadata from the firing rows, never 「[恢复]」 when firing is present', async t => {
  const time = clock(t);
  const { sent, env } = setup();
  await ingest(alert('mixed-a', 'mixed-a'), env);
  await worker.scheduled({}, env);
  time.set(MORNING + 10 * MINUTE);
  await ingest(alert('mixed-a-resolved', 'mixed-a', { state: 'resolved' }), env);
  await ingest(alert('mixed-b', 'mixed-b', { severity: 'warning' }), env);
  await ingest(alert('mixed-c', 'mixed-c', { severity: 'warning' }), env);
  await worker.scheduled({}, env);
  assert.equal(sent.length, 2);
  assert.equal(sent[1].subject.startsWith('[恢复]'), false);
  assert.match(sent[1].subject, /^\[注意\] 3 条提醒/);
  assert.match(sent[1].text, /事故编号：surgeconf\.watchdog:agent\.stuck:mixed-b/);

  time.set(MORNING + 20 * MINUTE);
  await ingest(alert('mixed-b-resolved', 'mixed-b', { state: 'resolved', severity: 'warning' }), env);
  await ingest(alert('mixed-c-resolved', 'mixed-c', { state: 'resolved', severity: 'warning' }), env);
  await worker.scheduled({}, env);
  assert.match(sent[2].subject, /^\[恢复\] 2 条提醒/);
});

test('Cron sends warnings due at night with critical alerts', async t => {
  // 22:58 Beijing on 2026-11-10.
  const evening = Date.parse('2026-11-10T14:58:00Z');
  const time = clock(t, evening);
  const { db, sent, env } = setup();
  assert.equal((await ingest(alert('late-warning', 'late-warning', { severity: 'warning' }), env)).delivery, 'pending');
  time.set(Date.parse('2026-11-10T15:00:00Z'));
  await ingest(alert('late-critical', 'late-critical'), env);
  await worker.scheduled({}, env);
  assert.equal(sent.length, 1);
  assert.match(sent[0].subject, /^\[严重\] 2 条提醒/);
  assert.equal(db.row("SELECT status FROM deliveries WHERE event_id = 'late-warning'").status, 'sent');
  assert.equal(db.row("SELECT status FROM deliveries WHERE event_id = 'late-critical'").status, 'sent');
});

test('an ignored outbox insert fails explicitly instead of silently dropping the delivery', async t => {
  clock(t);
  const { db, sent, env } = setup();
  await ingest(alert('seed', 'conflict'), env);
  await worker.scheduled({}, env);
  const key = 'surgeconf.watchdog:agent.stuck:conflict';
  db.sqlite.prepare("INSERT INTO deliveries (event_id, incident_key, notification_no, notification_type, status) VALUES ('seed', ?, 2, 'first', 'sent')").run(key);
  db.sqlite.prepare("UPDATE incidents SET last_notification_at = NULL WHERE incident_key = ?").run(key);
  await assert.rejects(ingest(alert('conflict-2', 'conflict'), env), error => error.code === 'E_DELIVERY_CONFLICT');
  assert.equal(sent.length, 1);
});

test('alert quota allows 6 per hour and 20 per day, counting each omitted delivery once', async t => {
  const time = clock(t);
  const { db, sent, env } = setup();
  const day = dayBucket(MORNING);
  let index = 0;
  const alertAndCron = async () => { await ingest(alert(`quota-${index}`, `quota-${index}`), env); index += 1; await worker.scheduled({}, env); };
  for (let count = 0; count < 6; count += 1) await alertAndCron();
  assert.equal(sent.length, 6);
  await alertAndCron();
  assert.equal(sent.length, 6);
  for (let run = 0; run < 4; run += 1) { time.set(MORNING + (run + 1) * 5 * MINUTE); await worker.scheduled({}, env); }
  assert.equal(sent.length, 6);
  assert.equal(db.row('SELECT omitted_count FROM quota WHERE bucket = ?', day).omitted_count, 1);
  assert.equal(db.row("SELECT status, quota_omitted FROM deliveries WHERE event_id = 'quota-6'").status, 'pending');
  assert.equal(db.row("SELECT quota_omitted FROM deliveries WHERE event_id = 'quota-6'").quota_omitted, 1);

  time.set(MORNING + 60 * MINUTE);
  await worker.scheduled({}, env);
  assert.equal(sent.length, 7);
  assert.match(sent[6].text, /有 1 条提醒因限额未单独发送/);
  assert.equal(db.row('SELECT omitted_count FROM quota WHERE bucket = ?', day).omitted_count, 0);
  for (let count = 0; count < 5; count += 1) await alertAndCron();
  time.set(MORNING + 120 * MINUTE);
  for (let count = 0; count < 6; count += 1) await alertAndCron();
  time.set(MORNING + 180 * MINUTE);
  for (let count = 0; count < 2; count += 1) await alertAndCron();
  assert.equal(sent.length, 20);
  assert.equal(db.row('SELECT day_count FROM quota WHERE bucket = ?', day).day_count, 20);

  await alertAndCron();
  await alertAndCron();
  assert.equal(sent.length, 20);
  for (let run = 0; run < 5; run += 1) { time.set(MORNING + (185 + run * 5) * MINUTE); await worker.scheduled({}, env); }
  assert.equal(sent.length, 20);
  assert.equal(db.row('SELECT omitted_count FROM quota WHERE bucket = ?', day).omitted_count, 2);
  assert.equal(db.count("SELECT COUNT(*) AS count FROM deliveries WHERE status = 'pending' AND quota_omitted = 1"), 2);
  assert.equal(db.row('SELECT day_count FROM quota WHERE bucket = ?', day).day_count, 20);
});

test('immediate quota denial only records the event and the next email reports it', async t => {
  const time = clock(t);
  const { db, sent, env } = setup();
  for (let index = 0; index < 8; index += 1) await ingest({ ...base, event_id: `immediate-${index}` }, env);
  assert.equal(sent.length, 6);
  assert.equal(db.count('SELECT COUNT(*) AS count FROM events'), 8);
  assert.equal(db.count('SELECT COUNT(*) AS count FROM deliveries'), 6);
  assert.equal(db.row('SELECT omitted_count FROM quota WHERE bucket = ?', dayBucket(MORNING)).omitted_count, 2);
  time.set(MORNING + 60 * MINUTE);
  await ingest({ ...base, event_id: 'immediate-next' }, env);
  assert.equal(sent.length, 7);
  assert.match(sent[6].text, /有 2 条提醒因限额未单独发送/);
});

test('retryable failures back off 5/15/60 minutes and the 4th failure is final', async t => {
  const time = clock(t);
  const { db, sent, env } = setup(() => { throw Object.assign(new Error('provider down'), { code: 'E_DELIVERY_FAILED' }); });
  const first = await ingest(base, env);
  assert.equal(first.delivery, 'pending');
  const row = () => db.row("SELECT status, attempts, next_attempt_at, error_code FROM deliveries WHERE event_id = 'event-1'");
  assert.equal(Date.parse(row().next_attempt_at) - MORNING, 5 * MINUTE);
  time.set(MORNING + 4 * MINUTE);
  await worker.scheduled({}, env);
  assert.equal(sent.length, 1);
  time.set(MORNING + 5 * MINUTE);
  await worker.scheduled({}, env);
  assert.equal(sent.length, 2);
  assert.equal(Date.parse(row().next_attempt_at) - (MORNING + 5 * MINUTE), 15 * MINUTE);
  time.set(MORNING + 20 * MINUTE);
  await worker.scheduled({}, env);
  assert.equal(sent.length, 3);
  assert.equal(row().attempts, 3);
  assert.equal(Date.parse(row().next_attempt_at) - (MORNING + 20 * MINUTE), 60 * MINUTE);
  time.set(MORNING + 80 * MINUTE);
  await assert.rejects(worker.scheduled({}, env), error => error.code === 'E_DELIVERY_FAILED' && !String(error.message).includes('provider down'));
  assert.equal(sent.length, 4);
  assert.equal(row().status, 'failed');
  assert.equal(row().attempts, 4);
  assert.equal(row().error_code, 'E_DELIVERY_FAILED');
  time.set(MORNING + 300 * MINUTE);
  await worker.scheduled({}, env);
  assert.equal(sent.length, 4);
});

test('validation failures are not retried and are thrown after marking failed', async t => {
  clock(t);
  const { db, sent, env } = setup(() => { throw Object.assign(new Error('sender'), { code: 'E_SENDER_NOT_VERIFIED' }); });
  await assert.rejects(ingest(base, env), error => error.code === 'E_SENDER_NOT_VERIFIED' && error.message === 'E_SENDER_NOT_VERIFIED');
  assert.equal(sent.length, 1);
  assert.equal(db.row("SELECT status FROM deliveries WHERE event_id = 'event-1'").status, 'failed');
});

test('a failed merged send updates attempts and next_attempt_at on every row of the batch', async t => {
  clock(t);
  const { db, sent, env } = setup(() => { throw Object.assign(new Error('rate'), { code: 'E_RATE_LIMIT_EXCEEDED' }); });
  await ingest(alert('batch-1', 'batch-a'), env);
  await ingest(alert('batch-2', 'batch-b'), env);
  await ingest(alert('batch-3', 'batch-c'), env);
  await worker.scheduled({}, env);
  assert.equal(sent.length, 1);
  const rows = db.rows('SELECT status, attempts, next_attempt_at, error_code FROM deliveries ORDER BY id');
  assert.equal(rows.length, 3);
  for (const row of rows) assert.deepEqual({ ...row }, { status: 'pending', attempts: 1, next_attempt_at: new Date(MORNING + 5 * MINUTE).toISOString(), error_code: 'E_RATE_LIMIT_EXCEEDED' });
});

test('a merged failure backs off each row from its own attempts and fails only exhausted rows', async t => {
  clock(t);
  const { db, sent, env } = setup(() => { throw Object.assign(new Error('provider down'), { code: 'E_DELIVERY_FAILED' }); });
  for (const id of ['fresh', 'second', 'third', 'last']) await ingest(alert(id, id), env);
  db.sqlite.prepare("UPDATE deliveries SET attempts = CASE event_id WHEN 'second' THEN 1 WHEN 'third' THEN 2 WHEN 'last' THEN 3 ELSE 0 END").run();
  await assert.rejects(worker.scheduled({}, env), error => error.code === 'E_DELIVERY_FAILED');
  assert.equal(sent.length, 1);
  const rows = Object.fromEntries(db.rows('SELECT d.event_id, d.status, d.attempts, d.next_attempt_at FROM deliveries d').map(row => [row.event_id, { ...row }]));
  assert.deepEqual(rows.fresh, { event_id: 'fresh', status: 'pending', attempts: 1, next_attempt_at: new Date(MORNING + 5 * MINUTE).toISOString() });
  assert.deepEqual(rows.second, { event_id: 'second', status: 'pending', attempts: 2, next_attempt_at: new Date(MORNING + 15 * MINUTE).toISOString() });
  assert.deepEqual(rows.third, { event_id: 'third', status: 'pending', attempts: 3, next_attempt_at: new Date(MORNING + 60 * MINUTE).toISOString() });
  assert.equal(rows.last.status, 'failed');
  assert.equal(rows.last.attempts, 4);
});

test('HTTP returns only the error code when an immediate send fails', async t => {
  clock(t);
  const { db, env } = setup(() => { throw Object.assign(new Error('provider rejected owner@example.invalid'), { code: 'E_SENDER_NOT_VERIFIED' }); });
  const token = seedToken(db);
  const logged = [];
  t.mock.method(console, 'error', (...args) => { logged.push(args.join(' ')); });
  const response = await worker.fetch(request(token, base), env);
  assert.equal(response.status, 500);
  const body = await response.text();
  assert.deepEqual(JSON.parse(body), { error: 'E_SENDER_NOT_VERIFIED' });
  assert.equal(body.includes('provider rejected'), false);
  assert.equal(logged.join('\n').includes('provider rejected'), false);
  assert.equal(logged.join('\n').includes('example.invalid'), false);
  assert.match(logged.join('\n'), /E_SENDER_NOT_VERIFIED/);
});

test('night warnings send on the next Cron run and merge normally', async t => {
  const night = Date.parse('2026-11-10T16:00:00Z');
  const time = clock(t, night);
  const { db, sent, env } = setup();
  assert.equal((await ingest(alert('night-a', 'night-a', { severity: 'warning' }), env)).decision, 'send_alert');
  time.set(night + 3 * 60 * MINUTE);
  assert.equal((await ingest(alert('night-b', 'night-b', { severity: 'warning' }), env)).decision, 'send_alert');
  assert.deepEqual(db.rows("SELECT next_attempt_at FROM deliveries WHERE event_id LIKE 'night-%' ORDER BY id").map(row => row.next_attempt_at), [null, null]);
  await worker.scheduled({}, env);
  assert.equal(sent.length, 1);
  assert.match(sent[0].subject, /^\[注意\] 2 条提醒/);
  assert.equal(db.count("SELECT COUNT(*) AS count FROM deliveries WHERE event_id LIKE 'night-%' AND status = 'sent'"), 2);
});

test('missing NOTIFY_TO fails closed without calling EMAIL', async t => {
  clock(t);
  const { db } = setup();
  const missing = { DB: db, EMAIL: { async send() { throw new Error('EMAIL must not be called'); } } };
  const rpc = Object.create(NotifyApi.prototype);
  rpc.env = missing;
  await assert.rejects(rpc.emit({ ...base, event_id: 'missing-to', source: 'rpc' }), /E_RECIPIENT_NOT_ALLOWED/);
  const failed = db.row("SELECT status, error_code FROM deliveries WHERE event_id = 'missing-to'");
  assert.deepEqual({ ...failed }, { status: 'failed', error_code: 'E_RECIPIENT_NOT_ALLOWED' });
  await ingest(alert('missing-alert', 'missing-alert'), missing);
  await assert.rejects(worker.scheduled({}, missing), /E_RECIPIENT_NOT_ALLOWED/);
  assert.equal(db.row("SELECT status FROM deliveries WHERE event_id = 'missing-alert'").status, 'failed');
});

test('HTTP rejects a watchdog token when it submits a mybrain health event', async t => {
  clock(t);
  const { db, env } = setup();
  const token = seedToken(db);
  const response = await worker.fetch(request(token, {
    ...base,
    event_id: 'wrong-health-source',
    source: 'mybrain.job-health',
    kind: 'job.health',
    state: 'info',
    severity: 'info',
  }), env);
  assert.equal(response.status, 403);
  assert.deepEqual(await response.json(), { error: 'forbidden' });
});

test('HTTP rejects a watchdog token when it submits a mybrain ledger digest', async t => {
  clock(t);
  const { db, env } = setup();
  const token = seedToken(db);
  const response = await worker.fetch(request(token, {
    ...base,
    event_id: 'wrong-ledger-source',
    source: 'mybrain.ledger',
    kind: 'ledger.digest',
    state: 'info',
    severity: 'info',
    title: 'ledger digest',
  }), env);
  assert.equal(response.status, 403);
  assert.deepEqual(await response.json(), { error: 'forbidden' });
});
