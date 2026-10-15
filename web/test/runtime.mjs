import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { fixture as authFixture } from '../../auth/test/runtime.mjs';
const require = createRequire(new URL('../../auth/package.json', import.meta.url));
const { build } = require('esbuild');
const { Miniflare, convertV4MiniflareOptions } = createRequire(require.resolve('wrangler'))('miniflare');
const root = fileURLToPath(new URL('../../', import.meta.url));
const bundle = async contents => (await build({
  stdin: { contents, resolveDir: root, loader: 'ts' }, bundle: true, format: 'esm',
  platform: 'neutral', write: false, loader: { '.css': 'text' },
})).outputFiles[0].text;
const deskScript = await bundle(`import {handleDeskRequest} from './web/server/desk.ts'; export default {fetch(request,env){return handleDeskRequest(request,env)}};`);
const providers = {
  health: 'oura/workers/api/src/index.ts',
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
  const app = await f.runtime.getWorker('desk');
  const origin = 'http://localhost:8804';
  const call = (path, cookies = '', body, custom = {}) => app.fetch(origin + path, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { Cookie: cookies, Origin: origin, 'Content-Type': 'application/json', ...custom },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }), redirect: 'manual',
  });
  return { ...f, sources, calls, faults, call, beforeReply: fn => { beforeReply = fn; } };
}
