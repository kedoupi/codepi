import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { deskFixture, sourceFixture, sourceTokens } from './runtime.mjs';
import { calendarDay, shiftDay } from '../../../packages/shared/desk/contract.ts';

test('private endpoints require a real owner session; login returns to desk; requests never forward cookies', async t => {
  const f = await deskFixture(t);
  const worker = await f.runtime.getWorker('desk');
  const canonical = await worker.fetch('https://www.codepi.app/api/auth/login', { redirect: 'manual' });
  assert.equal(canonical.status, 302);
  assert.equal(canonical.headers.get('Location'), 'https://codepi.app/api/auth/login');
  assert.equal((await worker.fetch('https://www.codepi.app/api/desk/summary', { method: 'POST' })).status, 403);
  const denied = await f.call('/api/desk/overview');
  assert.equal(denied.status, 401);
  assert.equal(denied.headers.get('Cache-Control'), 'no-store');
  assert.equal(f.calls.length, 0);
  const login = await f.otpLogin('desk');
  assert.equal(login.finished.status, 303);
  assert.equal(login.finished.headers.get('Location'), '/desk/');
  const result = await f.call('/api/desk/overview', login.localCookie);
  assert.equal(result.status, 200);
  assert.equal(result.headers.get('X-Robots-Tag'), 'noindex, nofollow');
  assert.equal((await result.json()).sources.length, 3);
  assert.equal(f.calls.length, 3);
  assert.ok(f.calls.every(call => call.cookie === null && call.origin === null));
  const out = await f.call('/api/auth/logout', login.localCookie, {});
  assert.equal(out.status, 200);
  assert.equal((await f.call('/api/desk/overview', login.localCookie)).status, 401);
});

test('summary validates origin, range and nonempty unique sources; selected sources alone are queried', async t => {
  const f = await deskFixture(t);
  const login = await f.otpLogin('desk');
  const path = '/api/desk/summary';
  const valid = { range: 'week', sources: ['health'] };
  assert.equal((await f.call(path, login.localCookie, valid, { Origin: 'https://evil.test' })).status, 403);
  for (const body of [{ range: 'year', sources: ['health'] }, { range: 'week', sources: [] }, { range: 'week', sources: ['health', 'health'] }, { range: 'week', sources: ['evil'] }]) {
    assert.equal((await f.call(path, login.localCookie, body)).status, 400);
  }
  assert.equal(f.calls.length, 0);
  const response = await f.call(path, login.localCookie, valid);
  assert.equal(response.status, 200);
  assert.deepEqual((await response.json()).sources.map(source => source.source), ['health']);
  assert.equal(f.calls.length, 1);
  assert.ok(f.calls[0].url.endsWith('range=week'));
});

test('partial errors, invalid links, missing config and oversized source data fail independently', async t => {
  const f = await deskFixture(t, { bindings: { WECHAT_SUMMARY_TOKEN: '' } });
  const login = await f.otpLogin('desk');
  f.faults.gu = () => Response.json({ arbitrary: 'not-a-summary' });
  let data = await (await f.call('/api/desk/overview', login.localCookie)).json();
  assert.equal(data.partial, true);
  assert.deepEqual(data.sources.map(source => source.status), ['empty', 'unavailable', 'unavailable']);
  assert.ok(!f.calls.some(call => call.source === 'wechat'));
  f.faults.gu = () => Response.json({
    source: 'gu', status: 'ok', asOf: null, updatedAt: null, stale: false,
    metrics: [], facts: [], notes: [], attention: [{ label: 'malicious', href: 'https://evil.test/' }],
  });
  data = await (await f.call('/api/desk/overview', login.localCookie)).json();
  assert.equal(data.sources[1].status, 'unavailable');
  assert.ok(!JSON.stringify(data).includes('evil.test'));
  f.faults.gu = () => new Response('x'.repeat(40000));
  assert.equal((await (await f.call('/api/desk/overview', login.localCookie)).json()).sources[1].status, 'unavailable');
  f.faults.gu = () => new Response(null, { status: 302, headers: { Location: 'https://evil.test/' } });
  const before = f.calls.length;
  assert.equal((await (await f.call('/api/desk/overview', login.localCookie)).json()).sources[1].status, 'unavailable');
  assert.equal(f.calls.length - before, 2, 'redirect is not followed with the service credential');
});

test('a slow source times out without losing the other sources', async t => {
  const f = await deskFixture(t);
  const login = await f.otpLogin('desk');
  f.faults.health = async () => {
    await new Promise(resolve => setTimeout(resolve, 10000));
    return Response.json({ source: 'health', status: 'empty', asOf: null, updatedAt: null, stale: false,
      metrics: [], facts: [], notes: [], attention: [] });
  };
  const response = await f.call('/api/desk/overview', login.localCookie);
  const data = await response.json();
  assert.equal(response.status, 200);
  assert.equal(data.partial, true);
  assert.deepEqual(data.sources.map(source => source.status), ['unavailable', 'empty', 'empty']);
});

test('revocation while source requests are in flight suppresses their result', async t => {
  const f = await deskFixture(t);
  const login = await f.otpLogin('desk');
  f.beforeReply(async () => { await f.db.prepare('UPDATE auth_sessions SET revoked_at=?').bind(Date.now()).run(); });
  assert.equal((await f.call('/api/desk/overview', login.localCookie)).status, 401);
});

test('every provider rejects missing/wrong/cross-service credentials and writes', async t => {
  const f = await sourceFixture(t);
  for (const id of ['health', 'gu', 'wechat']) {
    assert.equal((await f.request(id, 'current', '')).status, 401);
    assert.equal((await f.request(id, 'current', sourceTokens[id === 'gu' ? 'health' : 'gu'])).status, 401);
    assert.equal((await f.request(id, 'current', sourceTokens[id], 'POST')).status, 405);
    assert.equal((await f.request(id, 'year')).status, 400);
  }
});

test('health reads stored rows only, preserves zero and metric-specific coverage, ignores other users and future days', async t => {
  const f = await sourceFixture(t);
  const db = f.dbs.health;
  const today = calendarDay();
  const insert = (owner, day, sleep, readiness, steps) => db.prepare('INSERT INTO daily_cache VALUES(?,?,?)')
    .bind(owner, day, JSON.stringify({ date: day, sleep: { score: sleep }, readiness: { score: readiness }, activity: { steps } })).run();
  await insert('synthetic-owner', shiftDay(today, -1), 80, null, 0);
  await insert('synthetic-owner', today, null, 90, 10);
  await insert('synthetic-owner', shiftDay(today, 1), 99, 99, 999);
  await insert('someone-else', today, 100, 100, 10000);
  await db.prepare('INSERT INTO sync_state VALUES(?,?,?)').bind('synthetic-owner', new Date().toISOString(), null).run();
  const current = await (await f.request('health')).json();
  assert.equal(current.asOf, today);
  assert.deepEqual(current.metrics.map(metric => metric.value), ['暂无数据', '90 分', '10 步']);
  const week = await (await f.request('health', 'week')).json();
  assert.deepEqual(week.metrics.map(metric => metric.value), ['80 分', '90 分', '5 步']);
  assert.match(week.facts[0], /1\/7/);
  assert.match(week.facts[2], /2\/7/);
  assert.equal((await db.prepare('SELECT COUNT(*) n FROM daily_cache').first()).n, 4, 'summary does not populate cache');
  await db.prepare("UPDATE sync_state SET last_error='upstream_unavailable'").run();
  assert.equal((await (await f.request('health')).json()).stale, true);
});

test('GU retains current-batch meaning and suppresses superseded rules, demo records and missing amounts', async t => {
  const f = await sourceFixture(t);
  const db = f.dbs.gu;
  const data = { account: [{ total_usd: 0 }], risk: [
    { rule_id: 'GOOGL_force', triggered: true, item: 'Synthetic force' },
    { rule_id: 'GOOGL_trim', triggered: true, item: 'Synthetic trim' },
    { rule_id: 'other', triggered: false, proximity: 'near', item: 'Synthetic near' },
  ] };
  await db.prepare('INSERT INTO dashboard_batches VALUES(?,?,?,?)').bind('batch', '2020-01-01T00:00:00Z', new Date().toISOString(), JSON.stringify(data)).run();
  await db.prepare("INSERT INTO dashboard_current VALUES(1,'batch')").run();
  const result = await (await f.request('gu', 'week')).json();
  assert.deepEqual(result.metrics.map(metric => metric.value), ['1', '1']);
  assert.equal(result.privateMetric.value, '0');
  assert.equal(result.stale, true);
  assert.match(result.notes.join(' '), /无法.*7 天/);
  assert.ok(!JSON.stringify(result.attention).includes('Synthetic trim'));
  delete data.account[0].total_usd;
  await db.prepare('UPDATE dashboard_batches SET payload=?').bind(JSON.stringify(data)).run();
  assert.equal((await (await f.request('gu')).json()).privateMetric, undefined);
  data.account[0].data_mode = 'demo';
  await db.prepare('UPDATE dashboard_batches SET payload=?').bind(JSON.stringify(data)).run();
  assert.equal((await (await f.request('gu')).json()).status, 'empty');
});

test('WeChat excludes demos and distinguishes boxed from published, with valid article links', async t => {
  const f = await sourceFixture(t);
  const db = f.dbs.wechat;
  for (const [id, status, demo] of [['real-post', '待审', 0], ['boxed-post', '已进箱', 0], ['demo-post', '需改', 1]]) {
    await db.prepare('INSERT INTO posts VALUES(?,?,?,?,?)').bind(id, 'Synthetic <script> title', status, demo, new Date().toISOString()).run();
  }
  const result = await (await f.request('wechat', 'week')).json();
  assert.deepEqual(result.metrics.map(metric => metric.value), ['1', '0', '0']);
  assert.equal(result.attention[0].href, 'https://gzh.codepi.app/p/real-post');
  assert.match(result.notes.join(' '), /已进箱不等于已发布/);
  await db.prepare('UPDATE accounts SET active=0').run();
  assert.equal((await f.request('wechat')).status, 503);
});

test('desk migration matches the shared SSO schema', async () => {
  assert.equal(await readFile(new URL('../migrations/0001_desk_sso.sql', import.meta.url), 'utf8'),
    await readFile(new URL('../../../packages/shared/auth/schema.sql', import.meta.url), 'utf8'));
});
