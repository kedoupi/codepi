import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';
import test from 'node:test';

const root = path.resolve(new URL('../../..', import.meta.url).pathname);
const migration = await readFile(path.join(root, 'services/notify/migrations/0001_notify.sql'), 'utf8');
const { default: worker, NotifyApi, ingest } = await import('../src/index.ts');

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

test('HTTP, RPC, scheduled merge, token auth and delivery fail-closed behavior', async () => {
  const db = new D1();
  const token = seedToken(db);
  const sent = [];
  const env = { DB: db, NOTIFY_TO: 'owner@example.invalid', EMAIL: { async send(message) { sent.push(message); return { id: `msg-${sent.length}` }; } } };
  assert.equal((await worker.fetch(new Request('https://notify-api.codepi.app/v1/events', { method: 'POST', body: '{}' }), env)).status, 401);
  assert.equal((await worker.fetch(new Request('https://notify-api.codepi.app/v1/events', { method: 'POST', headers: { authorization: 'Bearer bad', 'content-type': 'application/json' }, body: '{}' }), env)).status, 401);
  assert.equal((await worker.fetch(request(token, { ...base, source: 'other' }), env)).status, 403);
  assert.equal((await worker.fetch(request(token, { ...base, kind: 'plans.orphan_digest' }), env)).status, 403);
  assert.equal((await worker.fetch(request(token, { ...base, to: 'leak@example.invalid' }), env)).status, 400);
  assert.equal((await worker.fetch(new Request('https://notify-api.codepi.app/v1/events', { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'text/plain' }, body: '{bad' }), env)).status, 400);
  const tooLarge = new ReadableStream({ start(controller) { controller.enqueue(new TextEncoder().encode('x'.repeat(16 * 1024 + 1))); controller.close(); } });
  assert.equal((await worker.fetch(new Request('https://notify-api.codepi.app/v1/events', { method: 'POST', duplex: 'half', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: tooLarge }), env)).status, 413);
  const response = await worker.fetch(request(token, base), env);
  assert.equal(response.status, 200);
  const result = await response.json();
  assert.equal(result.delivery, 'sent');
  assert.equal(result.message_id, 'msg-1');
  assert.equal(sent[0].to, env.NOTIFY_TO);
  const duplicate = await (await worker.fetch(request(token, base), env)).json();
  assert.equal(duplicate.duplicate, true);
  assert.equal(db.sqlite.prepare('SELECT COUNT(*) AS count FROM events').get().count, 1);
  assert.equal(sent.length, 1);
  const readBack = await (await worker.fetch(new Request('https://notify-api.codepi.app/v1/events/event-1', { headers: { authorization: `Bearer ${token}` } }), env)).json();
  assert.equal(readBack.event.event_id, 'event-1');
  assert.equal(readBack.deliveries.length, 1);
  assert.equal(readBack.deliveries[0].status, 'sent');
  assert.equal(JSON.stringify(readBack).includes(env.NOTIFY_TO), false);
  assert.equal((await worker.fetch(new Request('https://notify-api.codepi.app/v1/events/%', { headers: { authorization: `Bearer ${token}` } }), env)).status, 400);
  assert.equal((await worker.fetch(new Request('https://notify-api.codepi.app/other', { headers: { authorization: `Bearer ${token}` } }), env)).status, 404);

  const rpc = Object.create(NotifyApi.prototype);
  rpc.env = { ...env, EMAIL: { async send() { return { messageId: 'rpc-msg' }; } } };
  await assert.rejects(rpc.emit({ ...base, event_id: 'rpc-wrong', source: 'surgeconf.watchdog' }), /source_not_allowed/);
  const rpcResult = await rpc.emit({ ...base, event_id: 'rpc-ok', source: 'rpc' });
  assert.equal(rpcResult.delivery, 'sent');

  const beforeCron = sent.length;
  await ingest({ ...base, event_id: 'cron-1', kind: 'agent.stuck', severity: 'critical', subject: 'subject-a', title: 'a' }, env);
  await ingest({ ...base, event_id: 'cron-2', kind: 'agent.stuck', severity: 'warning', subject: 'subject-b', title: 'b' }, env);
  await worker.scheduled({}, env);
  assert.equal(sent.length, beforeCron + 1);
  assert.match(sent.at(-1).subject, /严重/);
  assert.match(sent.at(-1).subject, /2 条/);
  assert.equal(db.sqlite.prepare("SELECT COUNT(*) AS count FROM deliveries WHERE status = 'sent'").get().count, 4);
  await ingest({ ...base, event_id: 'pending-firing', kind: 'agent.stuck', severity: 'warning', subject: 'pending-subject', title: 'pending' }, env);
  await ingest({ ...base, event_id: 'pending-resolved', kind: 'agent.stuck', state: 'resolved', severity: 'warning', subject: 'pending-subject', title: 'pending' }, env);
  await worker.scheduled({}, env);
  assert.equal(db.sqlite.prepare("SELECT COUNT(*) AS count FROM deliveries WHERE event_id = 'pending-firing' AND status = 'cancelled'").get().count, 1);
  assert.match(sent.at(-1).subject, /^\[恢复\]/);
  db.sqlite.exec('DELETE FROM quota');
  db.sqlite.prepare("UPDATE incidents SET last_notification_at = '2026-11-09T00:00:00Z' WHERE incident_key = 'surgeconf.watchdog:agent.stuck:subject-a'").run();
  await ingest({ ...base, event_id: 'repeat-1', kind: 'agent.stuck', severity: 'critical', subject: 'subject-a', title: 'a' }, env);
  await worker.scheduled({}, env);
  assert.match(sent.at(-1).subject, /仍未恢复/);
  await ingest({ ...base, event_id: 'resolved-1', kind: 'agent.stuck', state: 'resolved', severity: 'critical', subject: 'subject-a', title: 'a' }, env);
  await worker.scheduled({}, env);
  assert.match(sent.at(-1).subject, /^\[恢复\]/);
  db.sqlite.exec('DELETE FROM quota');
  const quotaStart = sent.length;
  for (let index = 0; index < 8; index += 1) await ingest({ ...base, event_id: `quota-${index}` }, env);
  assert.equal(sent.length, quotaStart + 6);
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date());
  const values = Object.fromEntries(parts.filter(part => part.type !== 'literal').map(part => [part.type, part.value]));
  const day = `day:${values.year}-${values.month}-${values.day}`;
  db.sqlite.prepare('INSERT INTO quota (bucket, day_count, omitted_count) VALUES (?, 20, 2) ON CONFLICT(bucket) DO UPDATE SET day_count = 20, omitted_count = 2').run(day);
  await ingest({ ...base, event_id: 'quota-over' }, env);
  db.sqlite.prepare('UPDATE quota SET day_count = 19 WHERE bucket = ?').run(day);
  db.sqlite.prepare("DELETE FROM quota WHERE bucket LIKE 'hour:%'").run();
  await ingest({ ...base, event_id: 'quota-next' }, env);
  assert.match(sent.at(-1).text, /3 条提醒因限额未单独发送/);

  db.sqlite.exec('DELETE FROM quota');
  const missing = { DB: db, EMAIL: { async send() { throw new Error('EMAIL must not be called'); } } };
  const missingRpc = Object.create(NotifyApi.prototype);
  missingRpc.env = missing;
  await assert.rejects(missingRpc.emit({ ...base, event_id: 'missing-to', source: 'rpc' }), /E_RECIPIENT_NOT_ALLOWED/);
  const failed = db.sqlite.prepare("SELECT status, error_code FROM deliveries WHERE event_id = 'missing-to'").get();
  assert.equal(failed.status, 'failed');
  assert.equal(failed.error_code, 'E_RECIPIENT_NOT_ALLOWED');
});
