// Invariants of the shared public registries (products, SSO clients, redirects, sitemap filter).
// Pure data checks: no network, no Cloudflare, no private data.
import test from 'node:test';
import assert from 'node:assert/strict';
import { products } from './products.ts';
import { SSO_CLIENTS, isSsoClientId } from './auth/clients.ts';
import { privacyRedirects } from './privacy-redirects.js';
import { ignoreDoorwayLocales } from './sitemap-filter.js';
import { defaultLocale, localeCodes, translatedLocaleCodes } from './i18n/config.js';

const required = ['id', 'name', 'shortName', 'description', 'detail', 'href', 'hostname', 'icon', 'access', 'note'];

test('every product has the public fields and a unique id and hostname', () => {
  assert.ok(products.length > 0);
  for (const product of products) {
    for (const key of required) {
      assert.equal(typeof product[key], 'string', `${product.id}.${key}`);
      assert.ok(product[key].trim(), `${product.id}.${key} is empty`);
    }
    assert.match(product.id, /^[a-z][a-z0-9-]*$/);
  }
  assert.equal(new Set(products.map(p => p.id)).size, products.length, 'duplicate product id');
  assert.equal(new Set(products.map(p => p.hostname)).size, products.length, 'duplicate product hostname');
});

test('product links are https on the codepi.app hostname they declare', () => {
  for (const product of products) {
    const url = new URL(product.href);
    assert.equal(url.protocol, 'https:', product.id);
    assert.equal(url.hostname, product.hostname, `${product.id} href and hostname disagree`);
    assert.ok(product.hostname === 'codepi.app' || product.hostname.endsWith('.codepi.app'), product.id);
  }
});

test('SSO clients only name secrets and use https callbacks on registered hosts', () => {
  const hosts = new Set(['mcp.codepi.app', ...products.map(p => p.hostname)]);
  for (const [id, client] of Object.entries(SSO_CLIENTS)) {
    assert.ok(isSsoClientId(id));
    assert.match(client.secret, /^SSO_CLIENT_SECRET_[A-Z0-9_]+$/, `${id} secret must be a binding name`);
    if (client.callback) {
      const url = new URL(client.callback);
      assert.equal(url.protocol, 'https:', id);
      assert.equal(url.pathname, '/api/auth/callback', id);
      assert.ok(hosts.has(url.hostname), `${id} callback host ${url.hostname} is not a registered product`);
    }
  }
  assert.equal(new Set(Object.values(SSO_CLIENTS).map(c => c.secret)).size, Object.keys(SSO_CLIENTS).length,
    'two clients share a secret binding');
  assert.equal(isSsoClientId('toString'), false, 'prototype keys are not clients');
  assert.equal(isSsoClientId('unknown'), false);
});

test('privacy redirects keep the canonical page and send locale homes to the root', () => {
  assert.equal(privacyRedirects['/privacy-policy/'], '/privacy/');
  assert.equal(privacyRedirects[`/${defaultLocale}/`], undefined, 'default locale is not redirected');
  for (const code of translatedLocaleCodes) {
    assert.deepEqual(privacyRedirects[`/${code}/`], { status: 301, destination: '/' }, code);
  }
  assert.equal(Object.keys(privacyRedirects).length, translatedLocaleCodes.length + 1);
});

test('sitemap drops translated locale doorways but keeps real pages', () => {
  assert.deepEqual(translatedLocaleCodes, localeCodes.filter(code => code !== defaultLocale));
  for (const code of translatedLocaleCodes) {
    assert.equal(ignoreDoorwayLocales(`https://codepi.app/${code}/`), false, code);
    assert.equal(ignoreDoorwayLocales(`https://codepi.app/${code}/about/`), false, code);
  }
  for (const path of ['/', '/privacy/', '/blog/', '/blog/zhong-wen/', '/esports/']) {
    assert.equal(ignoreDoorwayLocales(`https://codepi.app${path}`), true, path);
  }
});
