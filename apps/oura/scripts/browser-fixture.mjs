import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { centralFixture, connectOura, createRuntime, login, loginSso, migrate } from '../workers/api/test/integration/runtime.mjs';
import worker from '../workers/api/test/integration/node-worker.mjs';
import { failingDb } from '../workers/api/test/integration/failing-db.mjs';
import { calendarDay, calendarWindow, shiftDay, DISPLAY_TIME_ZONE } from '../shared/dates.ts';
import { shortAutomaticQueue } from './browser-sync-fixture.mjs';

const origin = `http://127.0.0.1:${process.env.OURA_BROWSER_PORT || '4178'}`;
const root = fileURLToPath(new URL('../apps/web/dist/', import.meta.url));
const sso = process.env.OURA_BROWSER_SSO === '1';
const central = centralFixture();
const workerOrigin = sso ? origin : 'https://oura.example';
// Owner runtime: test-user == PERSONAL_OWNER_ID (full reports).
let syncScenario = 'normal';
let providerCalls = [];
let syncRequests = [];
let releaseScores;
let scoreGate;
const ownerRuntime = createRuntime({
  sso,
  ...(sso ? { serviceBindings: { AUTH: central.fetch } } : {}),
  ...(sso ? { bindings: {
    FRONTEND_ORIGIN: origin,
    OURA_REDIRECT_URI: `${origin}/api/auth/oura/callback`,
  } } : {}),
  autoSync: true,
  providerResponse(url) {
    providerCalls.push(url.pathname);
    if (syncScenario === 'normal') return undefined;
    if (/\/daily_(sleep|readiness|activity)$/.test(url.pathname)) {
      if (syncScenario === 'score-failure') return new Response('', { status: 503 });
      const respond = () => {
        const data = [];
        for (let day = url.searchParams.get('start_date'); day <= url.searchParams.get('end_date'); day = shiftDay(day, 1)) {
          data.push({ id: `${url.pathname.split('/').at(-1)}-${day}`, day, score: 91, steps: 9100 });
        }
        return Response.json({ data, next_token: null });
      };
      return scoreGate ? scoreGate.then(respond) : respond();
    }
    if (syncScenario === 'permission' && url.pathname.endsWith('/daily_spo2')) return new Response('', { status: 403 });
    if (syncScenario === 'access-denied' && /\/(daily_resilience|ring_configuration|ring_battery_level)$/.test(url.pathname)) {
      return Response.json({ detail: 'Access denied' }, { status: 401 });
    }
    if (syncScenario === 'rate-limit' && url.pathname.endsWith('/heartrate')) return new Response('', { status: 429 });
    if (syncScenario === 'oversized' && url.pathname.endsWith('/sleep')) {
      const from = url.searchParams.get('start_date');
      const to = url.searchParams.get('end_date');
      return Response.json({ data: Date.parse(to) - Date.parse(from) > 86400000
        ? Array.from({ length: 5001 }, () => ({})) : [], next_token: null });
    }
    if (url.pathname.endsWith('/heartrate')) {
      return Response.json({ data: [{ timestamp: url.searchParams.get('start_datetime'), bpm: 60, source: 'rest' }], next_token: null });
    }
    return undefined;
  },
});
await ownerRuntime.ready;
await migrate(ownerRuntime);
if (sso) {
  const db = await ownerRuntime.getD1Database('DB');
  await db.prepare("INSERT INTO users(id,oura_user_id) VALUES ('test-user','test-user')").run();
  await db.prepare("INSERT INTO user_prefs(user_id,locale) VALUES ('test-user','zh')").run();
}
// Non-owner runtime: summaries are available; full reports require owner access.
const freeRuntime = createRuntime({ bindings: {
  ALLOW_DEV_LOGIN: '0',
  FRONTEND_ORIGIN: 'https://oura.example',
  OURA_REDIRECT_URI: 'https://oura.example/api/auth/oura/callback',
  OURA_CLIENT_ID: 'integration-client',
  OURA_CLIENT_SECRET: 'integration-client-secret',
  SESSION_SECRET: 'integration-session-secret',
  TOKEN_ENCRYPTION_KEY: 'integration-encryption-secret',
  PERSONAL_OWNER_ID: '',
} });
await freeRuntime.ready;
await migrate(freeRuntime);
const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2' };
let sleepFailure = false;
let storageQuota = false;
let quotaSyncAttempts = 0;

// Test-only server: ephemeral D1, mock Oura, loopback binding, no real secrets.
const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, origin);
    if (url.pathname === '/__test/calendar') {
      res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({
        today: calendarDay(), week: calendarWindow(7), timezone: DISPLAY_TIME_ZONE,
      }));
      return;
    }
    if (url.pathname === '/__test/sync-scenario') {
      const db = await ownerRuntime.getD1Database('DB');
      if (req.method === 'POST') {
        releaseScores?.();
        releaseScores = undefined;
        scoreGate = undefined;
        syncScenario = url.searchParams.get('mode') || 'success';
        if (!['normal', 'success', 'permission', 'access-denied', 'rate-limit', 'oversized', 'score-failure'].includes(syncScenario)) {
          res.writeHead(400).end('Unknown sync scenario');
          return;
        }
        await db.batch([
          db.prepare("DELETE FROM auto_sync_state WHERE user_id='test-user'"),
          db.prepare("DELETE FROM auto_sync_budget WHERE user_id='test-user'"),
          db.prepare("DELETE FROM health_sync_windows WHERE user_id='test-user'"),
          // Keep the last good score snapshot readable while letting the real
          // POST bypass the 30-second success cooldown and reach mock Oura.
          db.prepare("UPDATE sync_state SET synced_at=? WHERE user_id='test-user'")
            .bind(new Date(Date.now() - 60_000).toISOString()),
        ]);
        if (url.searchParams.get('hold_scores') === '1') {
          scoreGate = new Promise(resolve => { releaseScores = resolve; });
        }
        providerCalls = [];
        syncRequests = [];
      }
      const row = await db.prepare("SELECT payload,started_at,status,lease_until FROM auto_sync_state WHERE user_id='test-user'").first();
      const records = await db.prepare("SELECT COUNT(*) AS count FROM health_records WHERE user_id='test-user'").first();
      res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({
        tasks: JSON.parse(row?.payload || '[]'), started_at: row?.started_at ?? null,
        status: row?.status ?? 'idle', leaseUntil: row?.lease_until ?? 0,
        records: records.count, providerCalls, requests: syncRequests,
      }));
      return;
    }
    if (url.pathname === '/__test/release-scores' && req.method === 'POST') {
      releaseScores?.();
      releaseScores = undefined;
      scoreGate = undefined;
      res.writeHead(200, { 'Content-Type': 'application/json' }).end('{"ok":true}');
      return;
    }
    if (url.pathname === '/__test/short-queue' && req.method === 'POST') {
      const db = await ownerRuntime.getD1Database('DB');
      const row = await db.prepare("SELECT * FROM auto_sync_state WHERE user_id='test-user'").first();
      if (!row?.started_at || row.lease_until > Date.now()) throw new Error('Real automatic POST must settle before trimming');
      const collections = url.searchParams.get('collections')?.split(',') || ['sleep', 'heartrate'];
      const tasks = shortAutomaticQueue(JSON.parse(row.payload), collections);
      await db.prepare("UPDATE auto_sync_state SET payload=? WHERE user_id='test-user'")
        .bind(JSON.stringify(tasks)).run();
      res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({ total: tasks.length }));
      return;
    }
    if (url.pathname === '/__test/sync-budget' && req.method === 'POST') {
      const db = await ownerRuntime.getD1Database('DB');
      await db.prepare(`INSERT OR REPLACE INTO auto_sync_budget(user_id,utc_day,reserved_rows)
        VALUES ('test-user',?,400000)`).bind(new Date().toISOString().slice(0, 10)).run();
      res.writeHead(200, { 'Content-Type': 'application/json' }).end('{"ok":true}');
      return;
    }
    if (url.pathname === '/__test/retry-due' && req.method === 'POST') {
      // Simulate expiry of one persisted retry delay, without waiting 15/30
      // minutes. Attempts, errors, task order and the executor remain real.
      const db = await ownerRuntime.getD1Database('DB');
      const row = await db.prepare("SELECT payload,lease_until FROM auto_sync_state WHERE user_id='test-user'").first();
      if (!row || row.lease_until > Date.now()) throw new Error('Retry must be persisted before expiring its delay');
      const tasks = JSON.parse(row.payload);
      const collection = url.searchParams.get('collection');
      const item = tasks.find(task => task.collection === collection && task.state === 'pending' && task.error);
      if (!item || item.after <= Date.now()) throw new Error('Expected a pending task with an actual retry delay');
      item.after = 0;
      await db.prepare("UPDATE auto_sync_state SET payload=? WHERE user_id='test-user'").bind(JSON.stringify(tasks)).run();
      res.writeHead(200, { 'Content-Type': 'application/json' }).end('{"ok":true}');
      return;
    }
    if (url.pathname === '/__test/report-scenario' && req.method === 'POST') {
      const db = await ownerRuntime.getD1Database('DB');
      const today = calendarDay();
      await db.prepare("DELETE FROM daily_cache WHERE user_id='test-user'").run();
      for (let back = 0; back < 30; back++) {
        const day = shiftDay(today, -back);
        const payload = {
          date: day,
          sleep: { score: back === 0 ? 0 : back === 2 ? 80 : back === 7 ? 70 : null },
          readiness: { score: back === 7 ? 70 : null },
          activity: { score: back < 3 ? 80 : null, steps: back === 0 ? 0 : null },
        };
        await db.prepare('INSERT INTO daily_cache (user_id,day,payload) VALUES (?,?,?)')
          .bind('test-user', day, JSON.stringify(payload)).run();
      }
      await db.prepare("INSERT INTO sync_state (user_id,synced_at,window_to) VALUES (?,?,?) ON CONFLICT(user_id) DO UPDATE SET synced_at=excluded.synced_at,window_to=excluded.window_to,last_error=NULL")
        .bind('test-user', new Date().toISOString(), today).run();
      res.writeHead(200, { 'Content-Type': 'application/json' }).end('{"ok":true}');
      return;
    }
    if (sso && url.pathname === '/__test/central' && req.method === 'POST') {
      central.state.unavailable = url.searchParams.get('unavailable') === '1';
      if (url.searchParams.get('revoke') === '1') for (const ref of central.refs.values()) ref.active = false;
      res.writeHead(200, { 'Content-Type': 'application/json' }).end('{"ok":true}');
      return;
    }
    if (sso && url.pathname === '/__test/connect' && req.method === 'POST') {
      const callback = await connectOura(ownerRuntime, req.headers.cookie || '', workerOrigin);
      res.writeHead(callback.status === 302 ? 200 : 500, { 'Content-Type': 'application/json' }).end('{"ok":true}');
      return;
    }
    if (url.pathname === '/__test/storage-quota') {
      if (req.method === 'POST') {
        storageQuota = url.searchParams.get('enabled') === '1';
        quotaSyncAttempts = 0;
        if (storageQuota) {
          // Keep archived records, but expire the 30-second success cooldown
          // so the next sync reaches an actual D1 mutation.
          const db = await ownerRuntime.getD1Database('DB');
          await db.prepare("UPDATE health_sync_windows SET synced_at='2000-01-01T00:00:00Z' WHERE synced_at IS NOT NULL").run();
        }
      }
      res.writeHead(200, { 'Content-Type': 'application/json' })
        .end(JSON.stringify({ enabled: storageQuota, attempts: quotaSyncAttempts }));
      return;
    }
    if (url.pathname === '/__test/automatic-sync' && req.method === 'POST') {
      const worker = await ownerRuntime.getWorker();
      // Manual admission uses wall time too; do not cross the 09:00 daily gate
      // just because this endpoint is advancing an accepted job.
      const result = await worker.scheduled({ scheduledTime: Date.now(), cron: '*/2 * * * *' });
      res.writeHead(result.outcome === 'ok' ? 200 : 500, { 'Content-Type': 'application/json' }).end(JSON.stringify(result));
      return;
    }
    if (url.pathname === '/__test/sleep-scenario' && req.method === 'POST') {
      const db = await ownerRuntime.getD1Database('DB');
      const scenario = url.searchParams.get('mode');
      sleepFailure = scenario === 'failure';
      await db.prepare("DELETE FROM health_records WHERE collection='sleep'").run();
      await db.prepare("DELETE FROM health_sync_windows WHERE collection='sleep'").run();
      const today = calendarDay();
      const date = back => shiftDay(today, -back);
      if (scenario === 'records' || scenario === 'journal') {
        const journal = scenario === 'journal';
        for (let back = 0; back < 30; back++) {
          if (back === 1) continue; // A missing day must not appear as zero hours.
          const day = date(back);
          for (const [type, seconds, hour] of [['long_sleep', 28800, '00'], ['sleep', 1800, '14']]) {
            const id = `${day}-${type}`;
            const sampleHours = [7.4, 6.8, 7.6, 7.2, 8.1, 6.9, 7.5][back % 7];
            const payload = {
              id, day, type, total_sleep_duration: seconds, time_in_bed: seconds + 1800,
              bedtime_start: `${day}T${hour}:00:00+08:00`, bedtime_end: `${day}T${type === 'sleep' ? '15' : '08'}:30:00+08:00`,
              deep_sleep_duration: seconds / 4, rem_sleep_duration: seconds / 4, light_sleep_duration: seconds / 2,
              awake_time: 1800, efficiency: 92, average_hrv: type === 'sleep' ? null : 42,
              average_heart_rate: 55, lowest_heart_rate: 48, average_breath: 14.2,
            };
            if (journal && type === 'long_sleep') {
              payload.total_sleep_duration = Math.round(sampleHours * 3600);
              payload.time_in_bed = payload.total_sleep_duration + 1800;
              payload.average_hrv = [42, 39, 44, 48, 52, 46, 38][back % 7];
            }
            await db.prepare('INSERT INTO health_records (user_id, collection, record_id, day, payload, fetched_at) VALUES (?, ?, ?, ?, ?, ?)')
              .bind('test-user', 'sleep', id, day, JSON.stringify(payload), new Date().toISOString()).run();
          }
        }
        if (journal) {
          await db.prepare("DELETE FROM daily_cache WHERE user_id='test-user'").run();
          for (let back = 0; back < 90; back++) {
            const day = date(back);
            const payload = { date: day,
              sleep: { score: [82, 76, 79, 84, 78, 81, 73][back % 7] },
              readiness: { score: [76, 78, 74, 80, 72, 77, 83][back % 7] },
              activity: { score: [88, 84, 79, 86, 82, 77, 85][back % 7], steps: [8240, 5900, 6300, 11200, 8700, 10400, 7800, 6100, 8900, 12300, 9600, 7100, 5200][back % 13] },
            };
            await db.prepare('INSERT INTO daily_cache (user_id,day,payload) VALUES (?,?,?)').bind('test-user', day, JSON.stringify(payload)).run();
          }
          await db.prepare("INSERT INTO sync_state (user_id,synced_at,window_to) VALUES (?,?,?) ON CONFLICT(user_id) DO UPDATE SET synced_at=excluded.synced_at,window_to=excluded.window_to,last_error=NULL")
            .bind('test-user', new Date().toISOString(), today).run();
        }
      }
      if (scenario === 'empty' || scenario === 'records' || scenario === 'journal') {
        for (const count of [7, 30]) {
          await db.prepare('INSERT INTO health_sync_windows (user_id, collection, window_from, window_to, synced_at, attempted_at) VALUES (?, ?, ?, ?, ?, ?)')
            .bind('test-user', 'sleep', date(count - 1), today, new Date().toISOString(), new Date().toISOString()).run();
        }
      }
      res.writeHead(200, { 'Content-Type': 'application/json' }).end('{"ok":true}');
      return;
    }
    if (url.pathname === '/__test/login') {
      const runtime = url.searchParams.get('free') === '1' ? freeRuntime : ownerRuntime;
      const cookie = sso ? await loginSso(runtime, workerOrigin) : await login(runtime);
      const jar = url.searchParams.get('free') === '1' ? 'free' : 'owner';
      res.writeHead(302, {
        'Set-Cookie': [
          `${cookie}; Path=/; HttpOnly; SameSite=Lax`,
          `oura_fixture_jar=${jar}; Path=/; SameSite=Lax`,
        ],
        Location: '/',
      });
      res.end();
      return;
    }
    // Connector + auth paths ride the same Worker as the dashboard APIs.
    const isWorkerPath = url.pathname.startsWith('/api/')
      || url.pathname === '/mcp'
      || url.pathname.startsWith('/oauth/')
      || url.pathname.startsWith('/.well-known/');
    if (isWorkerPath) {
      if (sleepFailure && url.pathname === '/api/me/health-records' && url.searchParams.get('collection') === 'sleep') {
        res.writeHead(503, { 'Content-Type': 'application/json' }).end('{"error":"upstream_unavailable"}');
        return;
      }
      const jar = /oura_fixture_jar=free/.test(req.headers.cookie || '') ? freeRuntime : ownerRuntime;
      const chunks = [];
      for await (const chunk of req) chunks.push(chunk);
      const syncRequest = req.method === 'POST'
        && ['/api/me/sync', '/api/me/health-records', '/api/me/health-records/automatic'].includes(url.pathname)
        ? { path: url.pathname, search: url.search, bodyBytes: Buffer.concat(chunks).length, status: null } : null;
      if (syncRequest) syncRequests.push(syncRequest);
      // The Worker whitelists its own origin + FRONTEND_ORIGIN. The fixture
      // impersonates the trusted frontend origin for browser requests.
      const requestHeaders = { ...req.headers, origin: workerOrigin, referer: `${workerOrigin}/` };
      if (storageQuota) {
        if (syncRequest) quotaSyncAttempts++;
        const bindings = await jar.getBindings();
        const response = await worker.fetch(new Request(`${workerOrigin}${url.pathname}${url.search}`, {
          method: req.method, headers: requestHeaders,
          body: chunks.length ? Buffer.concat(chunks) : undefined,
        }), { ...bindings, DB: failingDb(bindings.DB) });
        if (syncRequest) syncRequest.status = response.status;
        res.writeHead(response.status, Object.fromEntries(response.headers))
          .end(Buffer.from(await response.arrayBuffer()));
        return;
      }
      // Public hostname exercises production auth gates, while data stays local.
      const response = await jar.dispatchFetch(`${workerOrigin}${url.pathname}${url.search}`, {
        method: req.method, headers: requestHeaders, redirect: 'manual',
        body: chunks.length ? Buffer.concat(chunks) : undefined,
      });
      if (syncRequest) syncRequest.status = response.status;
      const headers = Object.fromEntries(response.headers);
      if (headers.location?.startsWith('https://oura.example')) {
        headers.location = headers.location.replace('https://oura.example', origin);
      }
      if (response.headers.getSetCookie().length) headers['set-cookie'] = response.headers.getSetCookie();
      res.writeHead(response.status, headers);
      res.end(Buffer.from(await response.arrayBuffer()));
      return;
    }
    const path = resolve(root, `.${decodeURIComponent(url.pathname)}`);
    if (path !== resolve(root) && !path.startsWith(root.endsWith(sep) ? root : root + sep)) {
      res.writeHead(403).end();
      return;
    }
    let file;
    try { file = await readFile(path); }
    catch {
      if (extname(path)) { res.writeHead(404).end(); return; }
      file = await readFile(resolve(root, 'index.html'));
    }
    res.writeHead(200, { 'Content-Type': mime[extname(path)] || 'text/html', 'Cache-Control': 'no-store' });
    res.end(file);
  } catch (error) {
    console.error(error.message);
    res.writeHead(500).end('Fixture server failed');
  }
});
server.listen(Number(new URL(origin).port), '127.0.0.1', () => console.log(`Browser fixture ready: ${origin}`));
async function stop() {
  releaseScores?.();
  server.close();
  await ownerRuntime.dispose();
  await freeRuntime.dispose();
  process.exit(0);
}
process.on('SIGTERM', stop);
process.on('SIGINT', stop);
