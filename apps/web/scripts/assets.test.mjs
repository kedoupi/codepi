import assert from 'node:assert/strict';
import test from 'node:test';
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { experimental_readRawConfig } from 'wrangler';

const require = createRequire(new URL('../../../services/auth/package.json', import.meta.url));
const { build } = require('esbuild');
const { Miniflare, convertV4MiniflareOptions } = createRequire(require.resolve('wrangler'))('miniflare');

test('real Worker assets preserve the public site and cannot shadow Desk APIs', { timeout: 60000 }, async t => {
  const branding = ['brand/codepi-logo.png', 'brand/codepi-logo-450w.png', 'brand/codepi-logo-900w.png', 'brand/codepi-logo-dark.png', 'brand/wordmark-light.png', 'brand/wordmark-dark.png'];
  for (const asset of branding) {
    const body = await readFile(new URL(`../dist/${asset}`, import.meta.url));
    assert.ok(body.byteLength > 0, asset);
  }
  const dir = await mkdtemp(join(tmpdir(), 'codepi-web-assets-'));
  let runtime;
  t.after(async () => {
    await runtime?.dispose();
    await rm(dir, { recursive: true, force: true });
  });
  const assets = join(dir, 'dist');
  await cp(new URL('../dist/', import.meta.url), assets, { recursive: true });
  // Deliberately place stale server output and a colliding static API document.
  await writeFile(join(assets, '_worker.js'), 'server-source-must-not-be-public');
  await writeFile(join(assets, '_routes.json'), '{"legacy":true}');
  await mkdir(join(assets, 'api/desk'), { recursive: true });
  await writeFile(join(assets, 'api/desk/me.html'), '<html>API routing bypass</html>');
  const { rawConfig: config } = experimental_readRawConfig({ config: 'wrangler.toml' });
  const bundle = await build({
    entryPoints: [config.main], bundle: true, format: 'esm', platform: 'neutral', write: false,
  });
  runtime = new Miniflare(convertV4MiniflareOptions({
    modules: true, script: bundle.outputFiles[0].text,
    compatibilityDate: config.compatibility_date, compatibilityFlags: config.compatibility_flags,
    assets: {
      ...config.assets, directory: assets, routerConfig: { has_user_worker: true },
      assetConfig: { not_found_handling: config.assets.not_found_handling },
    },
    d1Databases: { DB: 'synthetic-assets-test' },
    serviceBindings: { AUTH: () => { throw Error('Anonymous asset checks must not call Auth'); } },
    bindings: { ...config.vars, AUTH_CLIENT_SECRET: 'synthetic-assets-test-' + 'x'.repeat(32) },
    outboundService: () => { throw Error('Asset checks must not access the network'); },
  }));
  const get = path => runtime.dispatchFetch('https://codepi.app' + path, { redirect: 'manual' });
  for (const path of ['/', '/apps/', '/about/', '/privacy/', '/terms/', '/contact/', '/desk/']) {
    const response = await get(path);
    assert.equal(response.status, 200, path);
    assert.match(response.headers.get('Content-Type'), /^text\/html/);
    assert.equal(response.headers.get('X-Frame-Options'), 'DENY');
    assert.equal(response.headers.get('X-Content-Type-Options'), 'nosniff');
    const expected = await readFile(join(assets, path, 'index.html'), 'utf8');
    assert.equal(await response.text(), expected);
    if (path === '/desk/') {
      assert.equal(response.headers.get('Cache-Control'), 'no-store');
      assert.equal(response.headers.get('X-Robots-Tag'), 'noindex, nofollow');
      assert.ok(response.headers.get('Referrer-Policy').includes('no-referrer'));
    }
  }
  for (const path of ['/desk', '/about']) {
    const response = await get(path);
    assert.equal(response.status, 307, path);
    assert.equal(new URL(response.headers.get('Location'), 'http://localhost').pathname, path + '/');
    await response.body?.cancel();
  }
  for (const path of ['/_worker.js', '/_routes.json', '/_headers', '/.assetsignore', '/not-a-real-page']) {
    const response = await get(path);
    assert.equal(response.status, 404, path);
    await response.body?.cancel();
  }
  assert.equal(await (await get('/not-a-real-page')).text(), await readFile(join(assets, '404.html'), 'utf8'));
  const privacy = await get('/privacy-policy/');
  assert.equal(privacy.status, 301);
  assert.equal(privacy.headers.get('Location'), '/privacy/');
  await privacy.body?.cancel();
  for (const path of ['/api/desk/me', '/api/desk/overview', '/api/missing']) {
    const response = await get(path);
    assert.equal(response.status, 401, path);
    assert.match(response.headers.get('Content-Type'), /^application\/json/);
    assert.equal(response.headers.get('Cache-Control'), 'no-store');
    assert.deepEqual(await response.json(), { error: 'unauthorized' });
  }
  for (const path of ['/desk', '/desk/', '/api/auth/login']) {
    const response = await runtime.dispatchFetch('https://www.codepi.app' + path, { redirect: 'manual' });
    assert.equal(response.status, 302, path);
    assert.equal(response.headers.get('Location'), 'https://codepi.app' + (path === '/desk' ? '/desk/' : path));
    await response.body?.cancel();
  }
});
