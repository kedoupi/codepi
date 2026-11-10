import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Database } from 'bun:sqlite';

const root = path.resolve(import.meta.dirname, '../../..');
const sharedLink = path.join(root, 'services/notify/node_modules/@kedoupi/shared');
let createdSharedLink = false;
try { await mkdir(path.dirname(sharedLink), { recursive: true }); await symlink(path.join(root, 'packages/shared'), sharedLink, 'dir'); createdSharedLink = true; } catch (error) { if (error.code !== 'EEXIST') throw error; }
const source = path.join(root, 'services/notify/src/index.ts');
const work = await mkdtemp(path.join(tmpdir(), 'notify-worker-'));
const shim = path.join(work, 'cloudflare-workers-shim.ts');
await writeFile(shim, 'export class WorkerEntrypoint {}\n');
const built = await Bun.build({
  entrypoints: [source], format: 'esm', target: 'bun', outdir: work,
  plugins: [{ name: 'cloudflare-shim', setup(build) {
    build.onResolve({ filter: /^cloudflare:workers$/ }, () => ({ path: shim }));
  } }],
});
if (!built.success) throw new Error(built.logs.map(log => log.message).join('\n'));
const worker = await import(built.outputs[0].path);
const schema = await readFile(path.join(root, 'services/notify/migrations/0001_notify.sql'), 'utf8');

class D1 {
  constructor() { this.sqlite = new Database(':memory:'); this.sqlite.exec(schema); }
  prepare(sql) {
    const db = this.sqlite;
    return {
      bind(...values) {
        return {
          first: async () => db.query(sql).get(...values) ?? null,
          all: async () => ({ results: db.query(sql).all(...values) }),
          run: async () => ({ meta: { changes: Number(db.query(sql).run(...values).changes ?? 0) } }),
        };
      },
    };
  }
  batch(statements) { return Promise.all(statements.map(statement => statement.run())); }
}
const token = 'cpn_test_secret';
const hash = createHash('sha256').update(token).digest('hex');
const db = new D1();
db.sqlite.query('INSERT INTO producer_tokens (token_id, token_hash, source, kinds_json, created_at) VALUES (?, ?, ?, ?, ?)').run('test', hash, 'surgeconf.watchdog', JSON.stringify(['notify.selftest', 'agent.stuck']), new Date().toISOString());
const sent = [];
const env = { DB: db, NOTIFY_TO: 'owner@example.invalid', EMAIL: { async send(message) { sent.push(message); return { id: `msg-${sent.length}` }; } } };
const base = {
  schema: 'notify.event/v1', event_id: 'event-1', source: 'surgeconf.watchdog', kind: 'notify.selftest', subject: 'test',
  state: 'info', severity: 'info', occurred_at: '2026-11-10T00:00:00Z', title: 'selftest',
};
const fetch = worker.default.fetch;
const request = (body, init = {}) => new Request('https://notify-api.codepi.app/v1/events', { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${token}`, ...init.headers }, body: typeof body === 'string' ? body : JSON.stringify(body) });

assert.equal((await fetch(new Request('https://notify-api.codepi.app/v1/events', { method: 'POST', body: '{}' }), env)).status, 401);
assert.equal((await fetch(new Request('https://notify-api.codepi.app/v1/events', { method: 'POST', headers: { authorization: 'Bearer bad', 'content-type': 'application/json' }, body: '{}' }), env)).status, 401);
assert.equal((await fetch(request({ ...base, source: 'other' }), env)).status, 403);
assert.equal((await fetch(request({ ...base, to: 'leak@example.invalid' }), env)).status, 400);
assert.equal((await fetch(new Request('https://notify-api.codepi.app/v1/events', { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'text/plain' }, body: '{}' }), env)).status, 400);
const tooLarge = new ReadableStream({ start(controller) { controller.enqueue(new TextEncoder().encode('x'.repeat(16 * 1024 + 1))); controller.close(); } });
assert.equal((await fetch(new Request('https://notify-api.codepi.app/v1/events', { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: tooLarge }), env)).status, 413);
const response = await fetch(request(base), env);
assert.equal(response.status, 200);
const result = await response.json();
assert.equal(result.delivery, 'sent');
assert.equal(result.message_id, 'msg-1');
assert.equal(sent[0].to, env.NOTIFY_TO);
const duplicate = await (await fetch(request(base), env)).json();
assert.equal(duplicate.duplicate, true);
const readBack = await (await fetch(new Request('https://notify-api.codepi.app/v1/events/event-1', { headers: { authorization: `Bearer ${token}` } }), env)).json();
assert.equal(readBack.event.event_id, 'event-1');
assert.equal(JSON.stringify(readBack).includes(env.NOTIFY_TO), false);
assert.equal((await fetch(new Request('https://other.example/v1/events/event-1', { headers: { authorization: `Bearer ${token}` } }), env)).status, 404);
assert.equal((await fetch(new Request('https://notify-api.codepi.app/other', { headers: { authorization: `Bearer ${token}` } }), env)).status, 404);

const rpc = Object.create(worker.NotifyApi.prototype);
rpc.env = { ...env, EMAIL: { async send() { return { messageId: 'rpc-msg' }; } } };
await assert.rejects(rpc.emit({ ...base, event_id: 'rpc-wrong', source: 'surgeconf.watchdog' }), /source_not_allowed/);
const rpcResult = await rpc.emit({ ...base, event_id: 'rpc-ok', source: 'rpc' });
const beforeCron = sent.length;
for (const id of ['cron-1', 'cron-2']) await worker.ingest({ ...base, event_id: id, kind: 'agent.stuck', severity: 'critical', title: id }, env);
await worker.default.scheduled({}, env);
assert.equal(sent.length, beforeCron + 1);
assert.equal(rpcResult.delivery, 'sent');
db.sqlite.exec('DELETE FROM quota');
const quotaStart = sent.length;
for (let index = 0; index < 8; index += 1) await worker.ingest({ ...base, event_id: `quota-${index}` }, env);
assert.equal(sent.length, quotaStart + 6);
const quotaParts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date());
const quotaValues = Object.fromEntries(quotaParts.filter(part => part.type !== 'literal').map(part => [part.type, part.value]));
const quotaDay = `day:${quotaValues.year}-${quotaValues.month}-${quotaValues.day}`;
db.sqlite.query('INSERT INTO quota (bucket, day_count, omitted_count) VALUES (?, 20, 2) ON CONFLICT(bucket) DO UPDATE SET day_count = 20, omitted_count = 2').run(quotaDay);
await worker.ingest({ ...base, event_id: 'quota-over' }, env);
db.sqlite.query('UPDATE quota SET day_count = 19 WHERE bucket = ?').run(quotaDay);
db.sqlite.query("DELETE FROM quota WHERE bucket LIKE 'hour:%'").run();
await worker.ingest({ ...base, event_id: 'quota-next' }, env);
assert.match(sent.at(-1).text, /3 条提醒因限额未单独发送/);
db.sqlite.exec('DELETE FROM quota');

const missing = { DB: db, EMAIL: env.EMAIL };
const missingRpc = Object.create(worker.NotifyApi.prototype);
missingRpc.env = missing;
await assert.rejects(missingRpc.emit({ ...base, event_id: 'missing-to', source: 'rpc' }), /E_RECIPIENT_NOT_ALLOWED/);
const failed = db.sqlite.query("SELECT status, error_code FROM deliveries WHERE event_id = 'missing-to'").get();
assert.deepEqual(failed, { status: 'failed', error_code: 'E_RECIPIENT_NOT_ALLOWED' });

if (createdSharedLink) await rm(sharedLink, { force: true });
console.log('notify runtime HTTP/RPC/scheduled contract passed');
