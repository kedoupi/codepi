import assert from 'node:assert/strict';
import { test, after } from 'node:test';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createServer } from 'node:http';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { validateConfig, deploymentOrigin, checkHealth, checkAuth } from './check-deploy.mjs';
const execute = promisify(execFile);
const script = new URL('./check-deploy.mjs', import.meta.url).pathname;
const dir = await mkdtemp(path.join(tmpdir(), 'gu-check-deploy-'));
after(() => rm(dir, { recursive: true, force: true }));
await mkdir(path.join(dir, 'assets'));
const index = '<html><head><link href="/assets/index-fixture.css" rel="stylesheet"></head><body><script src="/assets/index-fixture.js"></script></body></html>';
const js = 'console.log("public build fixture")';
const css = 'body { color: #0f172a; }';
await Promise.all([writeFile(path.join(dir, 'index.html'), index), writeFile(path.join(dir, 'assets/index-fixture.js'), js), writeFile(path.join(dir, 'assets/index-fixture.css'), css)]);
const prod = { binding: 'DB', database_name: 'production-fixture', database_id: '11111111-1111-4111-8111-111111111111' };
const prev = { binding: 'DB', database_name: 'preview-fixture', database_id: '22222222-2222-4222-8222-222222222222' };
const config = () => ({ name: 'kdp-gu', pages_build_output_dir: './dist', vars: { ENVIRONMENT: 'production' }, d1_databases: [{ ...prod }], env: { preview: { vars: { ENVIRONMENT: 'preview' }, d1_databases: [{ ...prev }] } } });
const json = (body, status = 200, cache = 'no-store') => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': cache } });
const routes = () => ({ '/api/health': () => json({ ok: true }), '/login': () => new Response(index, { headers: { 'Content-Type': 'text/html' } }), '/assets/index-fixture.js': () => new Response(js, { headers: { 'Content-Type': 'text/javascript' } }), '/assets/index-fixture.css': () => new Response(css, { headers: { 'Content-Type': 'text/css' } }), '/api/me': () => json({ error: 'Login required' }, 401), '/api/dashboard': () => json({ error: 'Login required' }, 401) });
function fetcher(overrides = {}) {
  const handlers = { ...routes(), ...overrides };
  return async (url, options) => {
    assert.equal(options.method, 'GET');
    assert.equal(options.redirect, 'manual');
    assert.equal(options.credentials, 'omit');
    assert.ok(!options.headers.Cookie && !options.headers.Authorization);
    const pathname = new URL(url).pathname;
    assert.ok(handlers[pathname], `Unexpected endpoint: ${pathname}`);
    return handlers[pathname]();
  };
}
const health = (overrides = {}) => checkHealth('https://gu.example', { distDir: dir, fetcher: fetcher(overrides) });
const auth = (overrides = {}) => checkAuth('https://gu.example', { fetcher: fetcher(overrides) });
test('configuration accepts isolated real-shaped IDs', () => validateConfig(config()));
for (const [name, mutate] of [
  ['production placeholder', c => { c.d1_databases[0].database_id = '00000000-0000-0000-0000-000000000001'; }],
  ['preview placeholder', c => { c.env.preview.d1_databases[0].database_id = '00000000-0000-0000-0000-000000000002'; }],
  ['shared database ID', c => { c.env.preview.d1_databases[0].database_id = prod.database_id; }],
  ['shared database name', c => { c.env.preview.d1_databases[0].database_name = prod.database_name; }],
  ['missing preview binding', c => { delete c.env.preview.d1_databases; }],
  ['missing production binding', c => { delete c.d1_databases; }],
  ['missing environment marker', c => { delete c.env.preview.vars; }],
  ['malformed ID', c => { c.d1_databases[0].database_id = 'invalid'; }],
]) test(`configuration rejects ${name}`, () => { const c = config(); mutate(c); assert.throws(() => validateConfig(c)); });
test('origin accepts HTTPS and loopback HTTP', () => { assert.equal(deploymentOrigin('https://gu.example/'), 'https://gu.example'); assert.equal(deploymentOrigin('http://127.0.0.1:8787'), 'http://127.0.0.1:8787'); });
for (const url of ['http://gu.example', 'https://user:value@gu.example', 'https://:value@gu.example', 'https://gu.example/path', 'https://gu.example/?query=value', 'https://gu.example/#fragment', undefined]) test(`origin rejects unsafe shape ${String(url).replace(/\/\/.*@/, '//[credentials]@')}`, () => assert.throws(() => deploymentOrigin(url)));
test('health validates public login and exact compiled bytes', async () => assert.match(await health(), /2 deployed assets match local build, index_sha256=[a-f0-9]{64}/));
for (const status of [302, 403, 502]) test(`health rejects HTTP ${status} without following redirects`, async () => assert.rejects(health({ '/api/health': () => new Response('private provider body', { status }) }), new RegExp(`received ${status}`)));
for (const [name, override, expected] of [
  ['false health value', { '/api/health': () => json({ ok: false }) }, /ok=true/],
  ['HTML at health endpoint', { '/api/health': () => new Response('<html>', { headers: { 'Content-Type': 'text/html' } }) }, /expected JSON/],
  ['invalid JSON', { '/api/health': () => new Response('{bad', { headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } }) }, /invalid JSON/],
  ['cacheable health', { '/api/health': () => json({ ok: true }, 200, 'public') }, /missing no-store/],
  ['login unavailable', { '/login': () => new Response('', { status: 503 }) }, /received 503/],
  ['stale asset references', { '/login': () => new Response(index.replaceAll('fixture', 'stale'), { headers: { 'Content-Type': 'text/html' } }) }, /references differ/],
  ['modified asset bytes', { '/assets/index-fixture.js': () => new Response('old build', { headers: { 'Content-Type': 'text/javascript' } }) }, /bytes differ/],
  ['asset missing', { '/assets/index-fixture.js': () => new Response('', { status: 404 }) }, /received 404/],
  ['HTML instead of asset', { '/assets/index-fixture.js': () => new Response(index, { headers: { 'Content-Type': 'text/html' } }) }, /content type/],
  ['oversized declared body', { '/api/health': () => new Response('{}', { headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'Content-Length': '6000000' } }) }, /too large/],
  ['oversized streamed body', { '/api/health': () => new Response('x'.repeat(6 * 1024 * 1024), { headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } }) }, /too large/],
]) test(`health rejects ${name}`, async () => assert.rejects(health(override), expected));
test('health requires an existing local build', async () => assert.rejects(checkHealth('https://gu.example', { distDir: path.join(dir, 'missing'), fetcher: fetcher() }), /Local dist\/index.html is missing/));
test('network error is sanitized', async () => assert.rejects(checkHealth('https://gu.example', { distDir: dir, fetcher: async () => { throw new Error('private provider body'); } }), error => /network\/TLS/.test(error.message) && !error.message.includes('private provider')));
test('auth requires error-only JSON 401 from both private endpoints', async () => assert.match(await auth(), /error-only 401/));
for (const endpoint of ['/api/me', '/api/dashboard']) {
  for (const status of [200, 302, 403, 503]) test(`auth rejects ${endpoint} status ${status}`, async () => assert.rejects(auth({ [endpoint]: () => json({ data: 'private fixture' }, status) }), new RegExp(`received ${status}`)));
  test(`auth rejects leaked fields at ${endpoint}`, async () => assert.rejects(auth({ [endpoint]: () => json({ error: 'Login required', data: 'private fixture' }, 401) }), /without private data/));
}
async function startServer(overrides = {}) {
  const handlers = { ...routes(), ...overrides };
  const server = createServer(async (req, res) => {
    assert.equal(req.method, 'GET');
    assert.equal(req.headers.cookie, undefined);
    assert.equal(req.headers.authorization, undefined);
    const response = handlers[req.url]?.() || new Response('', { status: 404 });
    res.writeHead(response.status, Object.fromEntries(response.headers));
    res.end(Buffer.from(await response.arrayBuffer()));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  return { server, origin: `http://127.0.0.1:${server.address().port}` };
}
test('CLI full acceptance records URL/build/commit and passes against isolated HTTP fixture', async () => {
  const { server, origin } = await startServer();
  try {
    const { stdout } = await execute(process.execPath, [script, '--url', origin, '--dist', dir, '--commit', '123456789abc']);
    for (const phase of ['config', 'health', 'auth']) assert.ok(stdout.includes(`[${phase}] PASS:`));
    assert.ok(stdout.includes(`url=${origin}`) && stdout.includes('expected_commit=123456789abc'));
    assert.ok(stdout.includes('index_sha256='));
  } finally { await new Promise(resolve => server.close(resolve)); }
});
test('CLI health failure exits nonzero while reporting auth independently and suppressing response body', async () => {
  const { server, origin } = await startServer({ '/api/health': () => new Response('private provider body', { status: 502 }) });
  try {
    await assert.rejects(execute(process.execPath, [script, '--url', origin, '--dist', dir]), error => error.code === 1 && error.stderr.includes('[health] FAIL:') && error.stdout.includes('[auth] PASS:') && !error.stderr.includes('private provider body'));
  } finally { await new Promise(resolve => server.close(resolve)); }
});
for (const args of [['--mode', 'health'], ['--mode', 'bad'], ['--not-an-option'], ['--mode'], ['--commit', 'bad-ref']]) test(`CLI rejects invalid invocation ${args.join(' ')}`, async () => assert.rejects(execute(process.execPath, [script, ...args]), error => error.code === 1));
test('CLI help does not require configuration or network', async () => assert.match((await execute(process.execPath, [script, '--help'])).stdout, /Usage:/));
