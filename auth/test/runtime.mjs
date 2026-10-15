import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
const require = createRequire(import.meta.url);
const { Miniflare, Response, convertV4MiniflareOptions } = createRequire(require.resolve('wrangler'))('miniflare');
export const authOrigin = 'http://localhost:8795';
export const clients = Object.fromEntries(['oura', 'gu', 'gzh', 'desk'].map((id, i) => [id, {
  name: id, secret: `integration-only-${id}-` + 'x'.repeat(32),
  redirectUris: [`http://localhost:${8801 + i}/api/auth/callback`],
}]));
export const cookie = (res, name) => res.headers.getSetCookie().find(v => v.split('=')[0].endsWith(name))?.split(';')[0] || '';
const bundle = await build({
  stdin: {
    contents: `import {beginLogin,finishLogin,readSsoSession,logoutSso,ssoErrorResponse} from '../shared/auth/client.ts';
    export default { async fetch(req,env) { try {
      const p=new URL(req.url).pathname;
      if(p==='/api/auth/login')return await beginLogin(req,env);
      if(p==='/api/auth/callback')return await finishLogin(req,env,{userId:env.AUTH_CLIENT_ID+'-owner',ttlSeconds:env.AUTH_CLIENT_ID==='oura'?2592000:604800});
      if(p==='/api/auth/logout')return await logoutSso(req,env);
      const session=await readSsoSession(req,env);
      return Response.json({authenticated:!!session,userId:session?.userId},{status:session?200:401});
    }catch(e){return ssoErrorResponse(e)}}};`,
    resolveDir: fileURLToPath(new URL('..', import.meta.url)), loader: 'ts',
  },
  bundle: true, format: 'esm', platform: 'neutral', write: false,
});
export async function fixture(t, overrides = {}, options = {}) {
  const sent = [];
  const runtime = new Miniflare(convertV4MiniflareOptions({
    workers: [{
      name: 'auth', modules: true, script: await readFile(new URL('../dist/index.js', import.meta.url), 'utf8'),
      compatibilityDate: '2026-10-15', d1Databases: { DB: 'auth-test' },
      bindings: {
        OWNER_EMAIL: 'owner@example.test', OTP_FROM: 'KDP <login@example.test>',
        OTP_PEPPER: 'integration-otp-' + 'x'.repeat(32), SESSION_SECRET: 'integration-session-' + 'x'.repeat(32),
        AUTH_ORIGIN: authOrigin, ENVIRONMENT: 'test', SSO_CLIENTS: JSON.stringify(clients), ...overrides,
      },
      outboundService: async request => {
        if (new URL(request.url).href !== 'https://api.resend.com/emails') throw Error('Unexpected outbound');
        sent.push(await request.json());
        return Response.json({ id: 'test-mail' });
      },
    }, ...Object.entries(clients).map(([id]) => ({
      name: id, modules: true, script: options.scripts?.[id] ?? bundle.outputFiles[0].text,
      compatibilityDate: '2026-10-15', d1Databases: { DB: id + '-test' },
      serviceBindings: { AUTH: 'auth' },
      bindings: { AUTH_CLIENT_ID: id, AUTH_CLIENT_SECRET: clients[id].secret, AUTH_ORIGIN: overrides.AUTH_ORIGIN || authOrigin, SSO_ENABLED: '1', ...options.bindings?.[id] },
      ...(options.outbound?.[id] ? { outboundService: options.outbound[id] } : {}),
    }))],
  }));
  t?.after(() => runtime.dispose());
  const db = await runtime.getD1Database('DB', 'auth');
  const sql = await readFile(new URL('../migrations/0001_auth.sql', import.meta.url), 'utf8');
  await db.batch(sql.split(';').filter(s => s.trim()).map(s => db.prepare(s)));
  for (const id of Object.keys(clients)) {
    const appDb = await runtime.getD1Database('DB', id);
    const schema = await readFile(new URL('../../shared/auth/schema.sql', import.meta.url), 'utf8');
    await appDb.batch(schema.split(';').filter(s => s.trim()).map(s => appDb.prepare(s)));
  }
  const auth = await runtime.getWorker('auth');
  const call = (path, cookies = '', data, origin = overrides.AUTH_ORIGIN || authOrigin) => auth.fetch(origin + path, {
    method: data === undefined ? 'GET' : 'POST', headers: { Cookie: cookies, Origin: origin, 'Content-Type': 'application/json' },
    ...(data === undefined ? {} : { body: JSON.stringify(data) }), redirect: 'manual',
  });
  async function begin(id = 'oura', centralCookie = '') {
    const app = await runtime.getWorker(id);
    const origin = new URL(clients[id].redirectUris[0]).origin;
    const start = await app.fetch(origin + '/api/auth/login?return=%2Fprivate', { redirect: 'manual' });
    const appCookie = cookie(start, '_transaction');
    const response = await auth.fetch(start.headers.get('Location'), { headers: { Cookie: centralCookie }, redirect: 'manual' });
    return { app, origin, appCookie, response, txCookie: cookie(response, '_transaction') };
  }
  async function otpLogin(id = 'oura') {
    const tx = await begin(id);
    const sent = await call('/api/auth/request-otp', tx.txCookie, {});
    const data = await sent.json();
    if (!data.dev_otp) throw Error('Test OTP unavailable');
    const verified = await call('/api/auth/verify-otp', tx.txCookie, { code: data.dev_otp });
    const { redirect } = await verified.json();
    const centralCookie = cookie(verified, '_session');
    const finished = await tx.app.fetch(redirect, { headers: { Cookie: tx.appCookie }, redirect: 'manual' });
    return { ...tx, centralCookie, localCookie: cookie(finished, '_session'), finished, redirect, code: data.dev_otp };
  }
  async function internal(id, path, data, secret = clients[id].secret) {
    return auth.fetch('https://auth.internal/internal/' + path, {
      method: 'POST', headers: { Authorization: `Basic ${btoa(id + ':' + secret)}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
  }
  return { runtime, db, auth, call, begin, otpLogin, internal, sent };
}
