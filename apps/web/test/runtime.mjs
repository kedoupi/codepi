import { createRequire } from 'node:module';
import { readFile, readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { fixture as authFixture } from '../../../services/auth/test/runtime.mjs';
const require = createRequire(new URL('../../../services/auth/package.json', import.meta.url));
const { build } = require('esbuild');
const { Miniflare, convertV4MiniflareOptions } = createRequire(require.resolve('wrangler'))('miniflare');
const root = fileURLToPath(new URL('../../', import.meta.url));
const bundle = async contents => (await build({
  stdin: { contents, resolveDir: root, loader: 'ts' }, bundle: true, format: 'esm',
  platform: 'neutral', write: false, loader: { '.css': 'text' },
  external: ['cloudflare:workers'],
})).outputFiles[0].text;
const deskScript = await bundle(`export {default, BlogMcp, BlogMediaBackup} from './web/worker/index.ts';`);
const providers = {
  health: 'health/workers/api/src/index.ts',
  gu: 'gu/worker/index.ts',
  wechat: 'gzh/worker/index.ts',
};
export const sourceTokens = Object.fromEntries(Object.keys(providers).map(id => [id, `synthetic-${id}-` + 'x'.repeat(32)]));
export async function sourceFixture(t) {
  const scripts = await Promise.all(Object.entries(providers).map(async ([id, path]) => ({
    name: id, modules: true, script: await bundle(`export {default} from './${path}';`),
    compatibilityDate: '2026-10-15', d1Databases: { DB: `desk-${id}-test` },
    bindings: { DESK_SUMMARY_TOKEN: sourceTokens[id], PERSONAL_OWNER_ID: 'synthetic-owner' },
    outboundService: () => { throw Error('Provider must never call an upstream service'); },
  })));
  const runtime = new Miniflare(convertV4MiniflareOptions({ workers: scripts }));
  t?.after(() => runtime.dispose());
  const dbs = Object.fromEntries(await Promise.all(Object.keys(providers).map(async id => [id, await runtime.getD1Database('DB', id)])));
  const schemas = {
    health: [
      'CREATE TABLE daily_cache(user_id TEXT,day TEXT,payload TEXT,PRIMARY KEY(user_id,day))',
      'CREATE TABLE sync_state(user_id TEXT PRIMARY KEY,synced_at TEXT,last_error TEXT)',
    ],
    gu: [
      'CREATE TABLE dashboard_batches(id TEXT PRIMARY KEY,generated_at TEXT,received_at TEXT,payload TEXT)',
      'CREATE TABLE dashboard_current(singleton INTEGER PRIMARY KEY,batch_id TEXT)',
      'CREATE TABLE gu_workspace_head(singleton INTEGER PRIMARY KEY CHECK(singleton=1),revision INTEGER NOT NULL DEFAULT 0)',
      'INSERT INTO gu_workspace_head VALUES(1,0)',
      'CREATE TABLE gu_workspace_versions(revision INTEGER PRIMARY KEY,request_id TEXT NOT NULL UNIQUE,digest TEXT NOT NULL,created_at TEXT NOT NULL,payload TEXT NOT NULL)',
    ],
    wechat: [
      'CREATE TABLE accounts(id TEXT PRIMARY KEY,role TEXT,active INTEGER)',
      'CREATE TABLE posts(id TEXT PRIMARY KEY,title TEXT,status TEXT,is_demo INTEGER,updated_at TEXT)',
      "INSERT INTO accounts VALUES('acc_owner_kdp','owner',1)",
    ],
  };
  for (const [id, statements] of Object.entries(schemas)) await dbs[id].batch(statements.map(sql => dbs[id].prepare(sql)));
  const request = async (id, range = 'current', token = sourceTokens[id], method = 'GET') => {
    const worker = await runtime.getWorker(id);
    return worker.fetch(`https://${id}.example/api/internal/desk-summary?range=${range}`, { method, headers: { Authorization: `Bearer ${token}` } });
  };
  return { runtime, dbs, request };
}
export async function deskFixture(t, options = {}) {
  const sources = await sourceFixture(t);
  const calls = [];
  const faults = {};
  const hostSources = { 'health.codepi.app': 'health', 'gu.codepi.app': 'gu', 'gzh.codepi.app': 'wechat' };
  let beforeReply;
  const f = await authFixture(t, {}, {
    scripts: { desk: deskScript },
    d1Databases: { desk: { BLOG: 'blog-test' } },
    r2Buckets: { desk: { BLOG_MEDIA: 'blog-media-test' } },
    serviceBindings: { desk: { ASSETS: 'blog-assets' } },
    extraWorkers: [{
      name: 'blog-assets', modules: true, compatibilityDate: '2026-10-15',
      script: `export default { async fetch(req) { globalThis.__assetFetches = (globalThis.__assetFetches || 0) + 1;
        return new Response('<html><head><title>博客 | kedoupi（codepi）</title><meta name="description" content="博客"><link rel="canonical" href="https://codepi.app/blog/"></head><body><header class="blog-header"><h1 class="blog-title">真实想法</h1></header><main><section id="blog-list-mount" class="blog-list" hidden></section><section class="blog-empty-pavilion">正在整理</section></main></body></html>', { headers: { 'Content-Type': 'text/html; charset=utf-8', 'X-Asset-Fetch-Count': String(globalThis.__assetFetches), 'X-Asset-Method': req.method } }) } };`,
    }, {
      name: 'blog-rpc', modules: true, compatibilityDate: '2026-10-15',
      serviceBindings: { BLOG_RPC: { name: 'desk', entrypoint: 'BlogMcp' } },
      script: `export default { async fetch(req, env) { const reply = await env.BLOG_RPC.execute(await req.json()); return Response.json(reply); } };`,
    }],
    bindings: { desk: {
      HEALTH_SUMMARY_TOKEN: sourceTokens.health, GU_SUMMARY_TOKEN: sourceTokens.gu, WECHAT_SUMMARY_TOKEN: sourceTokens.wechat,
      ...options.bindings,
    } },
    outbound: { desk: async request => {
      const id = hostSources[new URL(request.url).hostname];
      calls.push({ source: id, cookie: request.headers.get('Cookie'), origin: request.headers.get('Origin'), url: request.url });
      if (!id) throw Error('Unexpected network destination');
      if (faults[id]) return faults[id](request);
      const worker = await sources.runtime.getWorker(id);
      const response = await worker.fetch(request);
      if (beforeReply) await beforeReply();
      return response;
    } },
  });
  const blog = await f.runtime.getD1Database('BLOG', 'desk');
  const migrations = new URL('../migrations-blog/', import.meta.url);
  for (const name of (await readdir(migrations)).filter(name => name.endsWith('.sql')).sort()) {
    const migration = await readFile(new URL(name, migrations), 'utf8');
    await blog.batch(migration.split(';').filter(sql => sql.trim()).map(sql => blog.prepare(sql)));
  }
  const app = await f.runtime.getWorker('desk');
  const origin = 'http://localhost:8804';
  const call = (path, cookies = '', body, custom = {}) => app.fetch(origin + path, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { Cookie: cookies, Origin: origin, 'Content-Type': 'application/json', ...custom },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }), redirect: 'manual',
  });
  return { ...f, sources, blog, calls, faults, call, rpc: async body => (await (await f.runtime.getWorker('blog-rpc')).fetch('http://localhost:8899/', { method: 'POST', body: JSON.stringify(body) })).json(), beforeReply: fn => { beforeReply = fn; } };
}
