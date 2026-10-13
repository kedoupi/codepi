import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { readFile, readdir } from 'node:fs/promises';

// Use Wrangler's locked runtime; no second emulator or new dependency.
const require = createRequire(import.meta.url);
const wranglerRequire = createRequire(require.resolve('wrangler'));
const { Miniflare, Response } = wranglerRequire('miniflare');

export function createRuntime(options = {}) {
  return new Miniflare({
    modules: true,
    scriptPath: fileURLToPath(new URL('../../dist/index.js', import.meta.url)),
    compatibilityDate: '2025-01-01',
    d1Databases: ['DB'],
    bindings: {
      ALLOW_DEV_LOGIN: '0',
      FRONTEND_ORIGIN: 'https://oura.example',
      OURA_REDIRECT_URI: 'https://oura.example/api/auth/oura/callback',
      OURA_CLIENT_ID: 'integration-client',
      OURA_CLIENT_SECRET: 'integration-client-secret',
      SESSION_SECRET: 'integration-session-secret',
      TOKEN_ENCRYPTION_KEY: 'integration-encryption-secret',
      PERSONAL_OWNER_ID: 'test-user',
    },
    // Only the upstream provider is stubbed. Routing, crypto, sessions, D1,
    // token storage, daily mapping and reports execute the built Worker.
    outboundService(request) {
      const url = new URL(request.url);
      if (url.origin !== 'https://api.ouraring.com') {
        throw new Error(`Unexpected outbound host: ${url.hostname}`);
      }
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
          const varied = typeof options.variedDailyData === 'function'
            ? options.variedDailyData(day)
            : null;
          data.push({
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
      throw new Error(`Unexpected outbound path: ${url.pathname}`);
    },
    ...options,
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
