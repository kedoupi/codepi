import { createRequire } from 'node:module';
import { readFileSync, readdirSync } from 'node:fs';
import { readFile, readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
const require = createRequire(import.meta.url);
const { Miniflare, Response } = createRequire(require.resolve('wrangler'))('miniflare');
const { build } = createRequire(new URL('../../auth/package.json', import.meta.url))('esbuild');
export const ORIGIN = 'https://mcp.example';
export const REDIRECT = 'http://127.0.0.1:9999/callback';
const secret = 'synthetic-mcp-sso-' + 'x'.repeat(32);

function manifest(directory) {
  const dir = fileURLToPath(directory);
  const modules = { 'index.js': { type: 'esm', contents: readFileSync(dir + 'index.js', 'utf8') } };
  for (const name of readdirSync(dir).filter(n => n.endsWith('.css'))) {
    modules[name] = { type: 'text', contents: readFileSync(dir + name, 'utf8') };
  }
  return { mainModule: 'index.js', modules };
}
let domainManifests;
async function domains() {
  domainManifests ??= Promise.all(['project', 'me', 'gu'].map(async name => {
    const result = await build({
      entryPoints: [fileURLToPath(new URL(`../../../apps/${name}/worker/index.ts`, import.meta.url))],
      bundle: true, format: 'esm', platform: 'neutral', write: false,
      external: ['cloudflare:workers'], loader: { '.css': 'text' },
    });
    return { name, manifest: { mainModule: 'index.js', modules: {
      'index.js': { type: 'esm', contents: result.outputFiles[0].text },
    } } };
  }));
  return domainManifests;
}

export async function fixture(t, options = {}) {
  const { mcpBindings = {}, healthBindings = {}, origin = ORIGIN } = options;
  const refs = new Map();
  const state = { subject: 'kdp-owner', providerCalls: 0, authUnavailable: false };
  const values = object => Object.fromEntries(Object.entries(object).map(([k, value]) => [k, { type: 'json', value }]));
  const runtime = new Miniflare({
    workers: [{
      config: {
        name: 'mcp', compatibilityDate: '2026-10-18', compatibilityFlags: ['nodejs_compat'],
        triggers: [{ type: 'fetch', pattern: 'mcp.example/*' }],
        manifest: manifest(new URL('../dist/', import.meta.url)),
        env: {
          DB: { type: 'd1', name: 'mcp-db' },
          HEALTH: { type: 'worker', worker: 'health', exportName: 'HealthMcp' },
          PROJECT: { type: 'worker', worker: 'project', exportName: 'ProjectMcp' },
          ME: { type: 'worker', worker: 'me', exportName: 'MeMcp' },
          GU: { type: 'worker', worker: 'gu', exportName: 'GuMcp' },
          BLOG: { type: 'worker', worker: 'blog', exportName: 'BlogMcp' },
          ...values({ MCP_ORIGIN: origin, AUTH_CLIENT_ID: 'mcp', AUTH_CLIENT_SECRET: secret,
            AUTH_ORIGIN: 'https://auth.example', SSO_ENABLED: '1', BUILD_SHA: 'synthetic', ...mcpBindings }),
          AUTH: { type: 'fetcher', async handler(request) {
            if (state.authUnavailable) return new Response('', { status: 503 });
            if (request.headers.get('Authorization') !== `Basic ${btoa('mcp:' + secret)}`) return new Response('', { status: 401 });
            const path = new URL(request.url).pathname, body = await request.json();
            if (path === '/internal/exchange') {
              const id = crypto.randomUUID(), ref = { active: true, subject: state.subject, expires_at: Date.now() + 30 * 86400000 };
              refs.set(id, ref);
              return Response.json({ ...ref, session_ref: id });
            }
            if (path === '/internal/session') return Response.json(refs.get(body.session_ref) ?? { active: false });
            if (path === '/internal/logout') {
              if (refs.has(body.session_ref)) refs.get(body.session_ref).active = false;
              return Response.json({ ok: true });
            }
            return new Response('', { status: 404 });
          } },
        },
      },
    }, {
      config: {
        name: 'health', compatibilityDate: '2025-01-01',
        triggers: [{ type: 'fetch', pattern: 'health.example/*' }],
        manifest: manifest(new URL('../../../apps/health/workers/api/dist/', import.meta.url)),
        exports: { HealthMcp: { type: 'worker' } },
        env: {
          DB: { type: 'd1', name: 'health-db' },
          ...values({
            PERSONAL_OWNER_ID: 'health-owner', FRONTEND_ORIGIN: 'https://health.example',
            ALLOW_DEV_LOGIN: '0', AUTO_SYNC_ENABLED: '1', TOKEN_ENCRYPTION_KEY: 'synthetic',
            OURA_CLIENT_ID: 'synthetic', OURA_CLIENT_SECRET: 'synthetic',
            ...healthBindings,
          }),
        },
      },
      dev: { outboundService: { type: 'fetcher', handler() {
        state.providerCalls++;
        throw new Error('Queries may enqueue but must not contact the provider inline');
      } } },
    }, ...(await domains()).map(({ name, manifest }) => ({
      config: {
        name, compatibilityDate: '2026-10-18', compatibilityFlags: ['nodejs_compat'],
        manifest, exports: { [{ project: 'ProjectMcp', me: 'MeMcp', gu: 'GuMcp' }[name]]: { type: 'worker' } },
        env: {
          DB: { type: 'd1', name: `${name}-db` },
          ...(name === 'me' ? { IMPORTS: { type: 'r2', name: 'synthetic-me-imports' } } : {}),
          ...values({ SSO_ENABLED: '1', AUTH_CLIENT_ID: name, PROJECT_REPOS: 'synthetic/repo',
            PROJECT_ORIGIN: 'https://project.example', ME_ORIGIN: 'https://me.example', ENVIRONMENT: 'test' }),
        },
      },
      dev: { outboundService: { type: 'fetcher', handler() { throw Error('Domain RPC must not contact external services'); } } },
    })), {
      config: {
        name: 'blog', compatibilityDate: '2026-10-18', compatibilityFlags: ['nodejs_compat'],
        exports: { BlogMcp: { type: 'worker' } },
        manifest: { mainModule: 'index.js', modules: { 'index.js': { type: 'esm', contents: `
          export const BlogMcp = {
            async execute(request) {
              return { ok: true, data: { echoed: request } };
            },
            async summary(subject) {
              return { source: 'blog', status: 'empty', asOf: null, updatedAt: null, stale: false,
                metrics: [], facts: [], notes: [], attention: [] };
            },
          };
        ` } } },
      },
    }],
  });
  t.after(() => runtime.dispose());
  await runtime.ready;
  const db = await runtime.getD1Database('DB', 'mcp');
  const healthDb = await runtime.getD1Database('DB', 'health');
  const projectDb = await runtime.getD1Database('DB', 'project');
  const meDb = await runtime.getD1Database('DB', 'me');
  const guDb = await runtime.getD1Database('DB', 'gu');
  for (const [target, directory] of [
    [db, new URL('../migrations/', import.meta.url)],
    [healthDb, new URL('../../../apps/health/migrations/', import.meta.url)],
    [projectDb, new URL('../../../apps/project/migrations/', import.meta.url)],
    [meDb, new URL('../../../apps/me/migrations/', import.meta.url)],
    [guDb, new URL('../../../apps/gu/migrations/', import.meta.url)],
  ]) {
    for (const name of (await readdir(directory)).filter(n => n.endsWith('.sql')).sort()) {
      const sql = (await readFile(new URL(name, directory), 'utf8')).replace(/--[^\n]*/g, '');
      await target.batch(sql.split(';').filter(s => s.trim()).map(s => target.prepare(s)));
    }
  }
  const worker = await runtime.getWorker('mcp');
  const health = await runtime.getWorker('health');
  const at = (path, options = {}) => worker.fetch(origin + path, { redirect: 'manual', ...options });
  async function login() {
    const start = await at('/api/auth/login?return=%2Fconnections');
    const transaction = start.headers.getSetCookie()[0].split(';')[0];
    const state = new URL(start.headers.get('Location')).searchParams.get('state');
    const callback = await at('/api/auth/callback?' + new URLSearchParams({ code: crypto.randomUUID(), state }), {
      headers: { Cookie: transaction },
    });
    if (callback.status !== 303) throw new Error('SSO callback failed: ' + callback.status);
    return callback.headers.getSetCookie().find(c => c.includes('kdp_mcp_session=')).split(';')[0];
  }
  const post = (path, data, headers = {}) => at(path, { method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', ...headers },
    body: new URLSearchParams(data).toString() });
  const allScopes = 'context.read projects.read projects.write health.read health.sync me.read me.write invest.read blog.read blog.write';
  async function grant({ exchange = true, scope = 'health.read health.sync', client: existingClient,
    registeredRedirect = REDIRECT, redirectUri = REDIRECT, consentOnly = false } = {}) {
    const cookie = await login();
    const client = existingClient ?? await (await at('/oauth/register', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ client_name: 'Synthetic client', redirect_uris: [registeredRedirect] }) })).json();
    const verifier = Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString('base64url');
    const challenge = await hash(verifier);
    const params = { client_id: client.client_id, redirect_uri: redirectUri, response_type: 'code',
      code_challenge: challenge, code_challenge_method: 'S256', state: 'synthetic-state', resource: origin + '/mcp', scope };
    const screen = await at('/oauth/authorize?' + new URLSearchParams(params), { headers: { Cookie: cookie } });
    const html = await screen.text();
    if (screen.status !== 200) throw new Error('Consent screen failed: ' + screen.status);
    const approval = {
      consent_id: html.match(/name="consent_id" value="([^"]+)"/)[1],
      csrf_token: html.match(/name="csrf_token" value="([^"]+)"/)[1],
      client_id: client.client_id, decision: 'approve', state: params.state,
    };
    if (consentOnly) return { client, cookie, approval, html };
    const approved = await post('/oauth/authorize', approval, { Origin: origin, Cookie: cookie });
    if (approved.status !== 302) throw new Error('Consent approval failed: ' + approved.status + ' ' + await approved.text());
    const code = new URL(approved.headers.get('Location')).searchParams.get('code');
    // Most tests need isolated legacy grants to prove per-tool enforcement.
    // Real consent now grants all scopes; keep that path in scopes/browser tests.
    await db.prepare('UPDATE oauth_auth_codes SET scope=? WHERE code_hash=?')
      .bind(scope, await hash(code)).run();
    const tokenForm = { grant_type: 'authorization_code', code, client_id: client.client_id,
      redirect_uri: redirectUri, code_verifier: verifier, resource: origin + '/mcp' };
    if (!exchange) return { client, cookie, approval, tokenForm };
    const exchanged = await post('/oauth/token', tokenForm);
    if (exchanged.status !== 200) throw new Error('Token exchange failed: ' + await exchanged.text());
    return { client, cookie, approval, tokenForm, ...(await exchanged.json()) };
  }
  async function rpc(token, method, params = {}) {
    const response = await at('/mcp', { method: 'POST', headers: {
      Authorization: 'Bearer ' + token, 'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream', 'MCP-Protocol-Version': '2025-11-25',
    }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) });
    return { status: response.status, body: await response.json(), headers: response.headers };
  }
  async function tool(token, name, args = {}) {
    const reply = await rpc(token, 'tools/call', { name, arguments: args });
    if (reply.status !== 200 || !reply.body.result) throw new Error('Tool request failed: ' + JSON.stringify(reply.body));
    return reply.body.result;
  }
  async function record(collection, day, id, data, user = 'health-owner') {
    await healthDb.prepare('INSERT OR IGNORE INTO users(id) VALUES (?)').bind(user).run();
    await healthDb.prepare(`INSERT INTO health_records (user_id,collection,record_id,day,payload,fetched_at) VALUES (?,?,?,?,?,?)`)
      .bind(user, collection, id, day, JSON.stringify({ id, day, ...data }), new Date().toISOString()).run();
  }
  async function cover(collection, from, to, synced = new Date().toISOString(), error = null) {
    await healthDb.prepare(`INSERT INTO health_sync_windows (user_id,collection,window_from,window_to,synced_at,attempted_at,last_error)
      VALUES (?,?,?,?,?,?,?) ON CONFLICT(user_id,collection,window_from,window_to)
      DO UPDATE SET synced_at=excluded.synced_at,attempted_at=excluded.attempted_at,last_error=excluded.last_error`)
      .bind('health-owner', collection, from, to, synced, new Date().toISOString(), error).run();
  }
  return { runtime, db, healthDb, projectDb, meDb, guDb, health, state, at, post, login, grant, rpc, tool, record, cover, allScopes,
    fetch: (input, init) => worker.fetch(input, init) };
}

export async function hash(text) {
  return Buffer.from(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))).toString('base64url');
}
