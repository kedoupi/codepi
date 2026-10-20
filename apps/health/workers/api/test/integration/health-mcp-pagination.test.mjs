import assert from 'node:assert/strict';
import { test } from 'node:test';
import { HealthMcp } from './node-worker.mjs';
import { createRuntime, migrate } from './runtime.mjs';

const PAGE_LIMIT = 12 * 1024;
const today = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit',
}).format(new Date());

function bytes(value) {
  return Buffer.byteLength(JSON.stringify(value));
}

async function fixture(t) {
  const runtime = createRuntime({ autoSync: false });
  t.after(() => runtime.dispose());
  await runtime.ready;
  await migrate(runtime);
  const db = await runtime.getD1Database('DB');
  await db.prepare("INSERT INTO users(id) VALUES ('test-user')").run();
  const env = {
    DB: db,
    PERSONAL_OWNER_ID: 'test-user',
    AUTO_SYNC_ENABLED: '0',
    FRONTEND_ORIGIN: 'https://oura.example',
    TOKEN_ENCRYPTION_KEY: 'integration-encryption-secret',
    OURA_CLIENT_ID: 'integration-client',
    OURA_CLIENT_SECRET: 'integration-client-secret',
  };
  return { runtime, db, env, rpc: new HealthMcp({}, env) };
}

async function insertRecord(db, collection, id, day, payload) {
  await db.prepare(`INSERT INTO health_records(user_id,collection,record_id,day,payload,fetched_at)
    VALUES('test-user',?,?,?,?,?)`)
    .bind(collection, id, day, JSON.stringify(payload), new Date().toISOString()).run();
}

async function collectPages(rpc, operation, args, options = {}) {
  const chunks = [];
  let cursor = null;
  let totalBytes = null;
  let chunkBytes = 0;
  let asOf = null;
  let pageCount = 0;
  while (true) {
    pageCount++;
    assert.ok(pageCount <= 100, 'pagination must finish');
    const reply = await rpc.execute({
      subject: 'kdp-owner',
      operation,
      args: cursor ? { ...args, cursor } : args,
    });
    assert.equal(reply.ok, true, reply.ok ? '' : `page ${pageCount}: ${reply.error}:${reply.status}`);
    if (!reply.ok) break;
    if (!cursor && options.afterFirst) await options.afterFirst();
    assert.ok(bytes(reply) <= PAGE_LIMIT, 'the complete RPC reply must fit 12 KiB');
    assert.ok(bytes(reply.data) <= PAGE_LIMIT, 'the page envelope must fit 12 KiB');
    const page = reply.data;
    assert.equal(page.source, 'health');
    assert.equal(page.provider, 'oura');
    assert.equal(page.operation, operation);
    assert.equal(typeof page.as_of, 'string');
    asOf ??= page.as_of;
    assert.equal(page.as_of, asOf);
    assert.equal(page.pagination.format, 'health_data_json_v1');
    assert.equal(page.pagination.encoding, 'utf-8');
    assert.equal(page.pagination.cursor, cursor);
    assert.equal(page.pagination.chunk_bytes, Buffer.byteLength(page.pagination.chunk));
    chunkBytes += page.pagination.chunk_bytes;
    totalBytes ??= page.pagination.total_bytes;
    assert.equal(page.pagination.total_bytes, totalBytes);
    chunks.push(page.pagination.chunk);
    if (page.pagination.complete) {
      assert.equal(page.pagination.next_cursor, null);
      break;
    }
    assert.equal(typeof page.pagination.next_cursor, 'string');
    assert.ok(page.pagination.next_cursor.length <= 2048);
    cursor = page.pagination.next_cursor;
  }
  const canonical = chunks.join('');
  assert.equal(Buffer.byteLength(canonical), totalBytes);
  assert.equal(chunkBytes, totalBytes);
  return { value: JSON.parse(canonical), pages: pageCount, asOf, canonical };
}

async function seedLargeTag(db, comment = '患者自述'.repeat(5000)) {
  await insertRecord(db, 'enhanced_tag', 'tag-large', today, {
    id: 'tag-large', start_day: today, comment, source: 'oura',
  });
  return comment;
}

test('oversized Unicode and series records page by complete JSON and reassemble losslessly', async t => {
  const { db, rpc } = await fixture(t);
  const originalFetch = globalThis.fetch;
  let fetchCalls = 0;
  globalThis.fetch = (...args) => {
    fetchCalls++;
    return originalFetch(...args);
  };
  t.after(() => { globalThis.fetch = originalFetch; });

  const label = '深睡阶段'.repeat(2000);
  const phase = '深睡'.repeat(4000);
  const hrvItems = Array.from({ length: 300 }, (_, index) => `中文心率${index}`);
  await insertRecord(db, 'sleep', 'sleep-large-unicode', today, {
    id: 'sleep-large-unicode',
    day: today,
    source: 'oura',
    label,
    sleep_phase_5_min: phase,
    hrv: { interval: 300, items: hrvItems },
  });

  const args = {
    collection: 'sleep',
    from: today,
    to: today,
    offset: 0,
    include_series: true,
    refresh: false,
  };
  const assembled = await collectPages(rpc, 'query_records', args);
  assert.equal(assembled.value.collection, 'sleep');
  assert.equal(assembled.value.generated_at, assembled.asOf);
  assert.equal(assembled.value.total, 1);
  assert.equal(assembled.value.next_offset, null);
  assert.equal(assembled.value.records[0].label, label);
  assert.equal(assembled.value.records[0].sleep_phase_5_min, phase);
  assert.deepEqual(assembled.value.records[0].hrv.items, hrvItems);
  assert.ok(assembled.canonical.includes('深睡阶段'), 'chunks preserve UTF-8 text');
  assert.equal(fetchCalls, 0, 'Health MCP assembly must not contact the provider');
});

test('the full catalog pages without changing collection metadata', async t => {
  const { db, rpc } = await fixture(t);
  const statements = [];
  for (let index = 0; index < 130; index++) {
    const day = new Date(Date.parse('2025-01-01') + index * 86_400_000).toISOString().slice(0, 10);
    const attemptedAt = new Date(Date.parse('2025-12-01') + index * 1000).toISOString();
    statements.push(db.prepare(`INSERT INTO health_sync_windows
      (user_id,collection,window_from,window_to,synced_at,attempted_at,last_error)
      VALUES('test-user','sleep',?,?,NULL,?,'upstream_unavailable')`)
      .bind(day, day, attemptedAt));
  }
  await db.batch(statements);

  const assembled = await collectPages(rpc, 'catalog', {});
  assert.equal(assembled.value.source, 'health');
  assert.equal(assembled.value.collections.length, 19);
  assert.equal(assembled.value.aggregate_max_days, 366);
  const sleep = assembled.value.coverage.find(collection => collection.name === 'sleep');
  assert.equal(sleep.failed_windows, 130);
  assert.equal(sleep.failed_ranges.length, 130);
});

test('default refresh metadata is pinned across pages without retriggering refresh', async t => {
  const { db, env, rpc } = await fixture(t);
  env.AUTO_SYNC_ENABLED = '1';
  await db.prepare(`INSERT INTO encrypted_tokens(user_id,ciphertext,iv)
    VALUES('test-user','synthetic-ciphertext','synthetic-iv')`).run();
  const comment = await seedLargeTag(db);
  const originalFetch = globalThis.fetch;
  let fetchCalls = 0;
  globalThis.fetch = (...args) => {
    fetchCalls++;
    return originalFetch(...args);
  };
  t.after(() => { globalThis.fetch = originalFetch; });

  let stateAfterFirst;
  const assembled = await collectPages(rpc, 'query_records', {
    collection: 'enhanced_tag',
    from: today,
    to: today,
    offset: 0,
  }, {
    afterFirst: async () => {
      stateAfterFirst = await db.prepare(`SELECT status,started_at,payload FROM auto_sync_state
        WHERE user_id='test-user'`).first();
      // A repeated refresh attempt would hit this lease and add sync_in_progress.
      await db.prepare("UPDATE auto_sync_state SET lease_until=? WHERE user_id='test-user'")
        .bind(Date.now() + 60_000).run();
    },
  });
  assert.equal(assembled.value.refresh_requested, true);
  assert.equal(assembled.value.refresh_error, null);
  assert.equal(assembled.value.records[0].comment, comment);
  const stateAfter = await db.prepare(`SELECT status,started_at,payload FROM auto_sync_state
    WHERE user_id='test-user'`).first();
  assert.deepEqual(stateAfter, stateAfterFirst);
  assert.equal(JSON.parse(stateAfter.payload).length, 1);
  assert.equal(assembled.value.background.next_batch_at,
    new Date(Date.parse(assembled.asOf) + 120_000).toISOString());
  assert.equal(fetchCalls, 0);
});

test('time-derived background scheduling stays stable across pages without DB changes', async t => {
  const { db, env, rpc } = await fixture(t);
  env.AUTO_SYNC_ENABLED = '1';
  await db.prepare(`INSERT INTO encrypted_tokens(user_id,ciphertext,iv)
    VALUES('test-user','synthetic-ciphertext','synthetic-iv')`).run();
  await seedLargeTag(db);

  // Cross a two-minute Cron boundary after the first page. The scheduler row
  // does not change, so the cursor must still match.
  t.mock.timers.enable({ apis: ['Date'], now: Date.parse(`${today}T02:00:00.000Z`) });
  t.after(() => t.mock.timers.reset());
  const args = {
    collection: 'enhanced_tag',
    from: today,
    to: today,
    offset: 0,
  };
  const first = await rpc.execute({ subject: 'kdp-owner', operation: 'query_records', args });
  assert.equal(first.ok, true);
  if (!first.ok) return;
  t.mock.timers.tick(120_001);
  const next = await rpc.execute({
    subject: 'kdp-owner',
    operation: 'query_records',
    args: { ...args, cursor: first.data.pagination.next_cursor },
  });
  assert.equal(next.ok, true, next.ok ? '' : next.error);
});

test('default dates and freshness keep the first-page clock across Shanghai midnight', async t => {
  const { db, rpc } = await fixture(t);
  const firstAt = Date.parse('2026-10-20T15:59:59.000Z');
  const day = '2026-10-20';
  t.mock.timers.enable({ apis: ['Date'], now: firstAt });
  t.after(() => t.mock.timers.reset());
  const comment = '跨午夜'.repeat(5000);
  await insertRecord(db, 'enhanced_tag', 'tag-midnight', day, {
    id: 'tag-midnight', start_day: day, comment, source: 'oura',
  });

  const assembled = await collectPages(rpc, 'query_records', {
    collection: 'enhanced_tag',
    offset: 0,
    refresh: false,
  }, {
    afterFirst: () => t.mock.timers.tick(2_000),
  });

  assert.equal(assembled.asOf, new Date(firstAt).toISOString());
  assert.equal(assembled.value.generated_at, assembled.asOf);
  assert.equal(assembled.value.from, '2026-10-14');
  assert.equal(assembled.value.to, day);
  assert.equal(assembled.value.records[0].comment, comment);
});

test('recent freshness stays frozen when a later page crosses 599 to 601 seconds', async t => {
  const { db, rpc } = await fixture(t);
  const firstAt = Date.parse('2026-10-20T02:00:00.000Z');
  const day = '2026-10-20';
  const syncedAt = new Date(firstAt - 599_000).toISOString();
  t.mock.timers.enable({ apis: ['Date'], now: firstAt });
  t.after(() => t.mock.timers.reset());
  const comment = '新鲜度边界'.repeat(5000);
  await insertRecord(db, 'enhanced_tag', 'tag-freshness', day, {
    id: 'tag-freshness', start_day: day, comment, source: 'oura',
  });
  await db.prepare(`INSERT INTO health_sync_windows
    (user_id,collection,window_from,window_to,synced_at,attempted_at,last_error)
    VALUES('test-user','enhanced_tag',?,?,?,?,NULL)`)
    .bind(day, day, syncedAt, syncedAt).run();

  const assembled = await collectPages(rpc, 'query_records', {
    collection: 'enhanced_tag',
    from: day,
    to: day,
    offset: 0,
    refresh: false,
  }, {
    afterFirst: () => t.mock.timers.tick(2_000),
  });

  assert.equal(assembled.asOf, new Date(firstAt).toISOString());
  assert.deepEqual(assembled.value.coverage[0].days_stale, []);
  assert.equal(assembled.value.sync.stale, false);
  assert.equal(assembled.value.sync.synced_at, syncedAt);
  assert.equal(assembled.value.records[0].comment, comment);
});

test('a rejected default refresh keeps its first-page warnings while later pages load', async t => {
  const { db, rpc } = await fixture(t);
  const comment = await seedLargeTag(db);
  t.mock.timers.enable({ apis: ['Date'], now: Date.parse(`${today}T02:00:00.000Z`) });
  t.after(() => t.mock.timers.reset());
  const assembled = await collectPages(rpc, 'query_records', {
    collection: 'enhanced_tag',
    from: today,
    to: today,
    offset: 0,
  }, {
    afterFirst: () => t.mock.timers.tick(120_001),
  });
  assert.equal(assembled.value.refresh_requested, false);
  assert.equal(assembled.value.refresh_error, 'auto_sync_disabled');
  assert.deepEqual(assembled.value.warnings, ['auto_sync_disabled']);
  assert.equal(assembled.value.records[0].comment, comment);
});

test('a 366-day aggregate pages only output and keeps every full-input bucket', async t => {
  const { db, rpc } = await fixture(t);
  const start = new Date(Date.parse(today) - 365 * 86_400_000).toISOString().slice(0, 10);
  const scores = [];
  const statements = [];
  for (let index = 0; index < 366; index++) {
    const day = new Date(Date.parse(start) + index * 86_400_000).toISOString().slice(0, 10);
    const score = index % 101;
    scores.push(score);
    statements.push(db.prepare(`INSERT INTO health_records(user_id,collection,record_id,day,payload,fetched_at)
      VALUES('test-user','daily_readiness',?,?,?,?)`)
      .bind(`readiness-${index}`, day, JSON.stringify({
        id: `readiness-${index}`, day, score, temperature_deviation: index / 10,
      }), new Date().toISOString()));
  }
  await db.batch(statements);
  await db.prepare(`INSERT INTO health_sync_windows
    (user_id,collection,window_from,window_to,synced_at,attempted_at,last_error)
    VALUES('test-user','daily_readiness',?,?,'2025-01-01T00:00:00.000Z','2025-01-01T00:00:00.000Z',NULL)`)
    .bind(start, today).run();

  const args = {
    collection: 'daily_readiness',
    from: start,
    to: today,
    metrics: ['score'],
    operations: ['count', 'mean', 'min', 'max'],
  };
  const raw = await rpc.execute({
    subject: 'kdp-owner',
    operation: 'aggregate',
    args: { ...args, interval: 'period', refresh: false },
  });
  assert.equal(raw.ok, true);
  if (!raw.ok) return;
  assert.equal('pagination' in raw.data, false, 'the compact full-input result keeps its normal shape');
  const rawBucket = raw.data.periods[0].metrics[0].buckets[0];

  const assembled = await collectPages(rpc, 'aggregate', { ...args, interval: 'day' });
  const metric = assembled.value.periods[0].metrics[0];
  assert.equal(metric.metric, 'score');
  assert.equal(assembled.value.generated_at, assembled.asOf);
  assert.equal(assembled.value.refresh_requested, false);
  assert.equal(assembled.value.refresh_error, 'auto_sync_disabled');
  assert.ok(assembled.value.warnings.includes('auto_sync_disabled'));
  assert.equal(metric.unit, 'score_0_100');
  assert.equal(metric.buckets.length, 366);
  assert.equal(metric.buckets.reduce((sum, bucket) => sum + bucket.valid_days, 0), 366);
  assert.ok(metric.buckets.every(bucket => bucket.valid_days === 1 && bucket.valid_records === 1));
  const expectedMean = scores.reduce((sum, value) => sum + value, 0) / scores.length;
  const computed = metric.buckets.reduce((sum, bucket) => sum + bucket.mean, 0) / metric.buckets.length;
  assert.ok(Math.abs(computed - expectedMean) < 1e-9);
  assert.equal(Math.min(...metric.buckets.map(bucket => bucket.min)), Math.min(...scores));
  assert.equal(Math.max(...metric.buckets.map(bucket => bucket.max)), Math.max(...scores));
  assert.equal(rawBucket.count, 366);
  assert.ok(Math.abs(rawBucket.mean - expectedMean) < 1e-9);
  assert.equal(rawBucket.min, Math.min(...scores));
  assert.equal(rawBucket.max, Math.max(...scores));
  assert.equal(rawBucket.count, metric.buckets.reduce((sum, bucket) => sum + bucket.valid_days, 0));
  assert.ok(Math.abs(rawBucket.mean - computed) < 1e-9);
});

test('cursors bind operation, original arguments and the source snapshot', async t => {
  const { db, rpc } = await fixture(t);
  const comment = '患者自述'.repeat(5000);
  await insertRecord(db, 'enhanced_tag', 'tag-source', today, {
    id: 'tag-source', start_day: today, comment, source: 'oura',
  });
  const args = {
    collection: 'enhanced_tag',
    from: today,
    to: today,
    offset: 0,
    refresh: false,
  };
  const first = await rpc.execute({ subject: 'kdp-owner', operation: 'query_records', args });
  assert.equal(first.ok, true);
  if (!first.ok) return;
  assert.equal(first.data.pagination.format, 'health_data_json_v1');
  assert.equal(first.data.pagination.complete, false);
  const cursor = first.data.pagination.next_cursor;

  const changed = await rpc.execute({
    subject: 'kdp-owner', operation: 'query_records',
    args: { ...args, offset: 1, cursor },
  });
  assert.deepEqual(changed, { ok: false, error: 'cursor_stale', status: 409 });
  assert.deepEqual(await rpc.execute({
    subject: 'kdp-owner', operation: 'query_records',
    args: { ...args, refresh: true, cursor },
  }), { ok: false, error: 'cursor_stale', status: 409 });
  assert.deepEqual(await rpc.execute({
    subject: 'kdp-owner', operation: 'aggregate',
    args: { ...args, cursor },
  }), { ok: false, error: 'cursor_stale', status: 409 });

  const reordered = await rpc.execute({
    subject: 'kdp-owner', operation: 'query_records',
    args: { refresh: false, to: today, offset: 0, from: today, collection: 'enhanced_tag', cursor },
  });
  assert.equal(reordered.ok, true, reordered.ok ? '' : reordered.error);

  await db.prepare(`UPDATE health_records SET payload=?
    WHERE user_id='test-user' AND collection='enhanced_tag' AND record_id='tag-source'`)
    .bind(JSON.stringify({
      id: 'tag-source', start_day: today, comment, source: 'synthetic-source-change',
    })).run();
  const stale = await rpc.execute({
    subject: 'kdp-owner', operation: 'query_records',
    args: { ...args, cursor },
  });
  assert.deepEqual(stale, { ok: false, error: 'cursor_stale', status: 409 });
});

test('real coverage and background changes remain stale despite pinned refresh metadata', async t => {
  const coverage = await fixture(t);
  await seedLargeTag(coverage.db);
  const coverageFirst = await coverage.rpc.execute({
    subject: 'kdp-owner',
    operation: 'query_records',
    args: { collection: 'enhanced_tag', from: today, to: today, offset: 0, refresh: false },
  });
  assert.equal(coverageFirst.ok, true);
  if (!coverageFirst.ok) return;
  await coverage.db.prepare(`INSERT INTO health_sync_windows
    (user_id,collection,window_from,window_to,synced_at,attempted_at,last_error)
    VALUES('test-user','enhanced_tag',?,?,'2026-01-01T00:00:00.000Z','2026-01-01T00:00:00.000Z',NULL)`)
    .bind(today, today).run();
  assert.deepEqual(await coverage.rpc.execute({
    subject: 'kdp-owner',
    operation: 'query_records',
    args: {
      collection: 'enhanced_tag', from: today, to: today, offset: 0, refresh: false,
      cursor: coverageFirst.data.pagination.next_cursor,
    },
  }), { ok: false, error: 'cursor_stale', status: 409 });

  const background = await fixture(t);
  await seedLargeTag(background.db);
  await background.db.prepare(`INSERT INTO auto_sync_state(user_id,status,payload,lease_until)
    VALUES('test-user','idle','[]',0)`).run();
  const backgroundFirst = await background.rpc.execute({
    subject: 'kdp-owner',
    operation: 'query_records',
    args: { collection: 'enhanced_tag', from: today, to: today, offset: 0, refresh: false },
  });
  assert.equal(backgroundFirst.ok, true);
  if (!backgroundFirst.ok) return;
  await background.db.prepare(`UPDATE auto_sync_state SET status='running'
    WHERE user_id='test-user'`).run();
  assert.deepEqual(await background.rpc.execute({
    subject: 'kdp-owner',
    operation: 'query_records',
    args: {
      collection: 'enhanced_tag', from: today, to: today, offset: 0, refresh: false,
      cursor: backgroundFirst.data.pagination.next_cursor,
    },
  }), { ok: false, error: 'cursor_stale', status: 409 });
});

test('normal-size data keeps its original shape and malformed cursors are rejected', async t => {
  const { rpc } = await fixture(t);
  const normal = await rpc.execute({
    subject: 'kdp-owner',
    operation: 'query_records',
    args: { collection: 'workout', from: today, to: today, refresh: false },
  });
  assert.equal(normal.ok, true);
  if (!normal.ok) return;
  assert.deepEqual(normal.data.records, []);
  assert.equal(normal.data.collection, 'workout');
  assert.equal('pagination' in normal.data, false);

  for (const cursor of ['!', 'a'.repeat(2049)]) {
    assert.deepEqual(await rpc.execute({
      subject: 'kdp-owner', operation: 'query_records',
      args: { collection: 'workout', cursor },
    }), { ok: false, error: 'invalid_cursor', status: 400 });
  }
  const extraField = Buffer.from(JSON.stringify({
    v: 1,
    format: 'health_data_json_v1',
    operation: 'query_records',
    args_sha256: '0'.repeat(64),
    sha256: '0'.repeat(64),
    index: 1,
    generated_at: '2026-01-01T00:00:00.000Z',
    extra: true,
  })).toString('base64url');
  assert.deepEqual(await rpc.execute({
    subject: 'kdp-owner', operation: 'query_records',
    args: { collection: 'workout', cursor: extraField },
  }), { ok: false, error: 'invalid_cursor', status: 400 });
});
