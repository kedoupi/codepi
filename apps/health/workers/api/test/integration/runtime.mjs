import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { readFile, readdir } from 'node:fs/promises';
import { readFileSync } from 'node:fs';

// Use Wrangler's locked runtime; no second emulator or new dependency.
const require = createRequire(import.meta.url);
const wranglerRequire = createRequire(require.resolve('wrangler'));
const { Miniflare, Response } = wranglerRequire('miniflare');
const config = readFileSync(new URL('../../wrangler.toml', import.meta.url), 'utf8');
const compatibilityDate = config.match(/^compatibility_date = "(\d{4}-\d{2}-\d{2})"$/m)?.[1];
if (!compatibilityDate) throw new Error('Health API compatibility_date is missing');

// Miniflare v5（wrangler 4.151+）：模块在 config.manifest 里声明，绑定在
// config.env 里以带 type 的对象声明；fetch stub 经 dev.outboundService 接管。
const dist = fileURLToPath(new URL('../../dist/', import.meta.url));
const modules = {
  'index.js': { type: 'esm', contents: readFileSync(`${dist}index.js`, 'utf8') },
};

export function createRuntime(options = {}) {
  const { providerResponse, variedDailyData, autoSync = false, sso = false, bindings = {}, serviceBindings = {}, ...runtimeOptions } = options;
  const env = { DB: { type: 'd1', name: 'DB' } };
  for (const [key, value] of Object.entries({
    ALLOW_DEV_LOGIN: '0',
    FRONTEND_ORIGIN: 'https://oura.example',
    OURA_REDIRECT_URI: 'https://oura.example/api/auth/oura/callback',
    OURA_CLIENT_ID: 'integration-client',
    OURA_CLIENT_SECRET: 'integration-client-secret',
    SESSION_SECRET: 'integration-session-secret',
    TOKEN_ENCRYPTION_KEY: 'integration-encryption-secret',
    PERSONAL_OWNER_ID: 'test-user',
    AUTO_SYNC_ENABLED: autoSync ? '1' : '0',
    ...(sso ? {
      SSO_ENABLED: '1', AUTH_CLIENT_ID: 'oura', AUTH_CLIENT_SECRET: 'test-sso-secret',
      AUTH_ORIGIN: 'https://auth.example',
    } : {}),
    ...bindings,
  })) env[key] = { type: 'json', value };
  for (const [key, handler] of Object.entries(serviceBindings)) {
    env[key] = { type: 'fetcher', handler };
  }
  return new Miniflare({
    workers: [{
      config: {
        name: 'health-api-test',
        compatibilityDate,
        manifest: { mainModule: 'index.js', modules },
        env,
        ...runtimeOptions,
      },
      dev: {
        // Only the upstream provider is stubbed. Routing, crypto, sessions, D1,
        // token storage, daily mapping and reports execute the built Worker.
        outboundService: {
          type: 'fetcher',
          handler(request) {
              const url = new URL(request.url);
              if (url.origin !== 'https://api.ouraring.com') {
                throw new Error(`Unexpected outbound host: ${url.hostname}`);
              }
              const custom = providerResponse?.(url, request);
              if (custom !== undefined) return custom;
              if (url.pathname === '/oauth/token') {
                return Response.json({
                  access_token: 'test-access',
                  refresh_token: 'test-refresh',
                  expires_in: 86400,
                });
              }
              if (url.pathname === '/v2/usercollection/personal_info') {
                return Response.json({ id: 'test-user', email: 'test@example.invalid' });
              }
              if (/^\/v2\/usercollection\/daily_(sleep|readiness|activity)$/.test(url.pathname)) {
                const data = [];
                const end = url.searchParams.get('end_date');
                for (let day = url.searchParams.get('start_date'); day <= end;) {
                  const varied = typeof variedDailyData === 'function'
                    ? variedDailyData(day)
                    : null;
                  data.push({
                    id: `${url.pathname.split('/').at(-1)}-${day}`,
                    day,
                    score: varied?.score ?? 80,
                    steps: varied?.steps ?? 8000,
                    active_calories: 400,
                    contributors: { deep_sleep: 80, hrv_balance: 80 },
                  });
                  day = new Date(Date.parse(day) + 86400000).toISOString().slice(0, 10);
                }
                return Response.json({ data, next_token: null });
              }
              if (url.pathname === '/v2/usercollection/sleep') {
                return Response.json({ data: [{
                  id: 'sleep-main', day: url.searchParams.get('start_date'),
                  total_sleep_duration: 28800, average_hrv: 42, average_heart_rate: 55,
                  hrv: { interval: 300, items: [40, 44], timestamp: '2026-01-01T00:00:00Z' },
                }], next_token: null });
              }
              if (/^\/v2\/usercollection\/(heartrate|daily_spo2|daily_stress|daily_resilience|daily_cardiovascular_age|vO2_max|workout|enhanced_tag|session|sleep_time|rest_mode_period|ring_configuration|ring_battery_level)$/.test(url.pathname)) {
                return Response.json({ data: [], next_token: null });
              }
              throw new Error(`Unexpected outbound path: ${url.pathname}`);
          },
        },
      },
    }],
  });
}

export async function migrate(runtime) {
  const db = await runtime.getD1Database('DB');
  const directory = new URL('../../../../migrations/', import.meta.url);
  for (const name of (await readdir(directory)).filter(n => n.endsWith('.sql')).sort()) {
    const sql = (await readFile(new URL(name, directory), 'utf8')).replace(/--[^\n]*/g, '');
    await db.batch(sql.split(';').filter(s => s.trim()).map(s => db.prepare(s)));
  }
}

export async function login(runtime, origin = 'https://oura.example') {
  const start = await runtime.dispatchFetch(`${origin}/api/auth/oura/start`, { redirect: 'manual' });
  const state = new URL(start.headers.get('location')).searchParams.get('state');
  const cookie = start.headers.get('set-cookie').split(';')[0];
  const callback = await runtime.dispatchFetch(
    `${origin}/api/auth/oura/callback?code=test-code&state=${encodeURIComponent(state)}`,
    { headers: { Cookie: cookie }, redirect: 'manual' },
  );
  if (callback.status !== 302 || new URL(callback.headers.get('location')).searchParams.get('login') !== 'ok') {
    throw new Error('Test OAuth callback failed');
  }
  return callback.headers.get('set-cookie').split(';')[0];
}

/** Stub only the central service; shared client, cookies, crypto and D1 are real. */
export function centralFixture() {
  const refs = new Map();
  const codes = new Set();
  const state = { unavailable: false, subject: 'kdp-owner', calls: [] };
  return {
    state, refs,
    async fetch(request) {
      const path = new URL(request.url).pathname;
      state.calls.push(path);
      if (state.unavailable) return new Response('', { status: 503 });
      if (request.headers.get('Authorization') !== `Basic ${btoa('oura:test-sso-secret')}`) {
        return new Response('', { status: 401 });
      }
      const body = await request.json();
      if (path === '/internal/exchange') {
        if (codes.has(body.code)) return new Response('', { status: 400 });
        codes.add(body.code);
        const ref = `ref-${crypto.randomUUID()}`;
        const entry = { active: true, subject: state.subject, expires_at: Date.now() + 60 * 86400000 };
        refs.set(ref, entry);
        return Response.json({ ...entry, session_ref: ref });
      }
      if (path === '/internal/session') return Response.json(refs.get(body.session_ref) ?? { active: false });
      if (path === '/internal/logout') {
        const ref = refs.get(body.session_ref);
        if (ref) ref.active = false;
        return Response.json({ ok: true });
      }
      return new Response('', { status: 404 });
    },
  };
}

export async function loginSso(runtime, origin = 'https://oura.example', returnTo = '/') {
  const start = await runtime.dispatchFetch(`${origin}/api/auth/login?return=${encodeURIComponent(returnTo)}`, { redirect: 'manual' });
  assertResponse(start, 302, 'SSO start');
  const state = new URL(start.headers.get('location')).searchParams.get('state');
  const cookie = start.headers.get('set-cookie').split(';')[0];
  const callback = await runtime.dispatchFetch(`${origin}/api/auth/callback?code=${crypto.randomUUID()}&state=${state}`, {
    headers: { Cookie: cookie }, redirect: 'manual',
  });
  assertResponse(callback, 303, 'SSO callback');
  return callback.headers.getSetCookie().find(c => /kdp_oura_session=/.test(c)).split(';')[0];
}

function assertResponse(response, expected, context) {
  if (response.status !== expected) throw new Error(`${context}: HTTP ${response.status}`);
}

export async function connectOura(runtime, cookie, origin = 'https://oura.example') {
  const start = await runtime.dispatchFetch(`${origin}/api/auth/oura/start`, {
    headers: { Cookie: cookie }, redirect: 'manual',
  });
  assertResponse(start, 302, 'Provider start');
  const state = new URL(start.headers.get('location')).searchParams.get('state');
  const stateCookie = start.headers.get('set-cookie').split(';')[0];
  return runtime.dispatchFetch(`${origin}/api/auth/oura/callback?code=test-code&state=${state}`, {
    headers: { Cookie: `${cookie}; ${stateCookie}` }, redirect: 'manual',
  });
}
