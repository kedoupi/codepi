import assert from 'node:assert/strict';
import test from 'node:test';
import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { experimental_readRawConfig } from 'wrangler';

const require = createRequire(new URL('../../../../../services/auth/package.json', import.meta.url));
const { build } = require('esbuild');
const { Miniflare, convertV4MiniflareOptions } = createRequire(require.resolve('wrangler'))('miniflare');

test('real Worker assets serve the SPA and forward API/MCP/OAuth to the API Worker', { timeout: 60000 }, async t => {
  const dir = await mkdtemp(join(tmpdir(), 'codepi-health-assets-'));
  let runtime;
  t.after(async () => {
    await runtime?.dispose();
    await rm(dir, { recursive: true, force: true });
  });
  const assets = join(dir, 'dist');
  await cp(new URL('../dist/', import.meta.url), assets, { recursive: true });
  // Stale server artifacts must never be served as public assets.
  await writeFile(join(assets, '_worker.js'), 'server-source-must-not-be-public');
  await writeFile(join(assets, '_routes.json'), '{"legacy":true}');
  const { rawConfig: config } = experimental_readRawConfig({ config: new URL('../wrangler.toml', import.meta.url).pathname });
  const bundle = await build({
    entryPoints: [new URL('../worker/index.ts', import.meta.url).pathname],
    bundle: true, format: 'esm', platform: 'neutral', write: false,
  });
  // The upstream API Worker records the path it was asked for so the test can
  // assert both forwarding and the /well-known/* → /.well-known/* rewrite.
  const upstreamCalls = [];
  runtime = new Miniflare(convertV4MiniflareOptions({
    modules: true, script: bundle.outputFiles[0].text,
    compatibilityDate: config.compatibility_date, compatibilityFlags: config.compatibility_flags,
    assets: {
      ...config.assets, directory: assets, routerConfig: { has_user_worker: true },
      assetConfig: { not_found_handling: config.assets.not_found_handling },
    },
    serviceBindings: {
      WORKER: request => {
        upstreamCalls.push(new URL(request.url).pathname);
        return new Response(JSON.stringify({ ok: true }), { headers: { 'content-type': 'application/json' } });
      },
    },
    bindings: { ...config.vars },
    outboundService: () => { throw Error('Asset checks must not access the network'); },
  }));
  const get = (path, options) => runtime.dispatchFetch('https://health.codepi.app' + path, { redirect: 'manual', ...options });

  // Public SPA: index.html served at /, client routes fall back to index.html.
  const index = await readFile(join(assets, 'index.html'), 'utf8');
  for (const path of ['/', '/dashboard', '/settings/not-a-real-route']) {
    const response = await get(path);
    assert.equal(response.status, 200, path);
    assert.match(response.headers.get('content-type') || '', /^text\/html/);
    assert.equal(await response.text(), index, `${path}: SPA must serve index.html`);
  }
  // Real static assets served directly.
  const icon = await get('/icon.svg');
  assert.equal(icon.status, 200);
  assert.match(icon.headers.get('content-type') || '', /image\/svg/);
  await icon.body?.cancel();
  // Server artifacts must never reach the API Worker (they are not API paths).
  // .assetsignore excludes them from the uploaded asset manifest, which local
  // Miniflare does not apply, so this only asserts routing, not upload filtering.
  upstreamCalls.length = 0;
  for (const path of ['/_worker.js', '/_routes.json']) {
    await get(path).then(r => r.body?.cancel());
  }
  assert.deepEqual(upstreamCalls, [], 'server artifacts must not be forwarded to the API Worker');

  // API/MCP/OAuth paths forward to the WORKER binding, not the SPA.
  for (const path of ['/api/me', '/api/auth/oura/callback', '/mcp', '/oauth/register', '/.well-known/oauth-protected-resource']) {
    const response = await get(path);
    assert.equal(response.status, 200, path);
    assert.deepEqual(await response.json(), { ok: true }, path);
  }
  // /well-known/* is rewritten to /.well-known/* before forwarding.
  upstreamCalls.length = 0;
  await get('/well-known/oauth-protected-resource');
  assert.deepEqual(upstreamCalls, ['/.well-known/oauth-protected-resource']);
});
