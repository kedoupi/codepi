import assert from 'node:assert/strict';
import { test, after } from 'node:test';
import { createRequire } from 'node:module';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
const require = createRequire(new URL('../../auth/package.json', import.meta.url));
const { build } = require('esbuild');
const dir = await mkdtemp(path.join(tmpdir(), 'codepi-client-metadata-'));
after(() => rm(dir, { recursive: true, force: true }));
await build({
  entryPoints: [fileURLToPath(new URL('../src/client-metadata.ts', import.meta.url))],
  bundle: true, format: 'esm', platform: 'node',
  outfile: path.join(dir, 'client-metadata.mjs'),
});
const { resolveMetadataClient } = await import(pathToFileURL(path.join(dir, 'client-metadata.mjs')));

const CLIENT = 'https://client.example.com/oauth/client.json';
const document = (overrides = {}) => ({
  client_id: CLIENT,
  client_name: 'Example MCP Client',
  redirect_uris: ['https://client.example.com/callback'],
  token_endpoint_auth_method: 'none',
  ...overrides,
});
const jsonResponse = (body, init = {}) => new Response(JSON.stringify(body), {
  status: init.status ?? 200,
  headers: { 'content-type': init.type ?? 'application/json' },
});

function installDns(addresses) {
  const dns = process.getBuiltinModule('node:dns/promises');
  const original = dns.lookup;
  const list = (Array.isArray(addresses) ? addresses : [addresses])
    .map(address => ({ address, family: address.includes(':') ? 6 : 4 }));
  dns.lookup = async () => list;
  return () => { dns.lookup = original; };
}

test('a matching public metadata document becomes a public client for this request only', async () => {
  const restore = installDns('1.1.1.1');
  const calls = [];
  try {
    const client = await resolveMetadataClient(CLIENT, async (url, init) => {
      calls.push({ url, init });
      return jsonResponse(document());
    });
    assert.deepEqual(client, {
      client_id: CLIENT,
      client_name: 'Example MCP Client',
      redirect_uris: JSON.stringify(['https://client.example.com/callback']),
      token_endpoint_auth_method: 'none',
      client_secret_hash: null,
    });
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, CLIENT);
    assert.equal(calls[0].init.method, 'GET');
    assert.equal(calls[0].init.redirect, 'manual');
    assert.equal(calls[0].init.cache, 'no-store');
    assert.equal(calls[0].init.headers.accept, 'application/json');
    assert.ok(calls[0].init.signal);
    assert.equal('credentials' in calls[0].init, false);
  } finally { restore(); }
});

test('client identifiers that are not exact public HTTPS documents are not fetched', async () => {
  let fetched = false;
  const request = async () => { fetched = true; return jsonResponse(document()); };
  const rejected = [
    'mcp_registered_client',
    'http://client.example.com/oauth/client.json',
    'https://client.example.com',
    'https://client.example.com/',
    'https://client.example.com/oauth/./client.json',
    'https://client.example.com/oauth/../client.json',
    'https://user:secret@client.example.com/oauth/client.json',
    'https://client.example.com/oauth/client.json#fragment',
    'https://127.0.0.1/oauth/client.json',
    'https://2130706433/oauth/client.json',
    'https://[::1]/oauth/client.json',
    'https://[::ffff:127.0.0.1]/oauth/client.json',
    'https://[fe80::1]/oauth/client.json',
    'https://localhost/oauth/client.json',
    'https://printer.local/oauth/client.json',
    'https://client.localhost/oauth/client.json',
    'https://service.internal/oauth/client.json',
    'https://metadata.arpa/oauth/client.json',
  ];
  for (const clientId of rejected) assert.equal(await resolveMetadataClient(clientId, request), null, clientId);
  assert.equal(fetched, false);
});

test('a query is permitted and a non-default port is not normalized away', async () => {
  const restore = installDns('1.1.1.1');
  try {
    const queried = 'https://client.example.com/oauth/client.json?v=1';
    const explicitPort = 'https://client.example.com:8443/oauth/client.json';
    for (const clientId of [queried, explicitPort]) {
      const client = await resolveMetadataClient(clientId, async url => {
        assert.equal(url, clientId);
        return jsonResponse(document({ client_id: clientId }));
      });
      assert.equal(client?.client_id, clientId);
    }
  } finally { restore(); }
});

test('private, local and unresolved DNS answers are refused before fetch', async () => {
  const blocked = [
    [],
    ['127.0.0.1'],
    ['10.1.2.3'],
    ['192.168.1.1'],
    ['169.254.169.254'],
    ['0.0.0.0'],
    ['100.64.0.1'],
    ['198.18.0.1'],
    ['203.0.113.10'],
    ['1.1.1.1', '127.0.0.1'],
    ['::1'],
    ['fe80::1'],
    ['fc00::1'],
    ['::ffff:10.0.0.1'],
    ['::ffff:127.0.0.1'],
  ];
  for (const addresses of blocked) {
    const restore = installDns(addresses);
    let fetched = false;
    try {
      assert.equal(await resolveMetadataClient(CLIENT, async () => { fetched = true; return jsonResponse(document()); }), null);
      assert.equal(fetched, false);
    } finally { restore(); }
  }
});

test('redirects are returned to the caller and never followed', async () => {
  const restore = installDns('1.1.1.1');
  let calls = 0;
  try {
    const client = await resolveMetadataClient(CLIENT, async () => {
      calls += 1;
      return new Response(null, { status: 302, headers: { location: 'https://127.0.0.1/secret' } });
    });
    assert.equal(client, null);
    assert.equal(calls, 1);
  } finally { restore(); }
});

test('status, media type, size and JSON shape failures return null', async () => {
  const restore = installDns('1.1.1.1');
  const cases = [
    new Response('missing', { status: 404, headers: { 'content-type': 'application/json' } }),
    new Response('{}', { status: 200, headers: { 'content-type': 'text/plain' } }),
    new Response('not-json', { status: 200, headers: { 'content-type': 'application/json' } }),
    new Response('{}', { status: 200, headers: { 'content-type': 'application/json', 'content-length': String(32 * 1024 + 1) } }),
    jsonResponse([document()]),
    jsonResponse(document({ client_id: 'https://attacker.example/oauth/client.json' })),
    jsonResponse(document({ client_name: '' })),
    jsonResponse(document({ client_name: 'x'.repeat(121) })),
    jsonResponse(document({ redirect_uris: [] })),
    jsonResponse(document({ redirect_uris: ['javascript:alert(1)'] })),
    jsonResponse(document({ redirect_uris: Array(11).fill('https://client.example.com/callback') })),
    jsonResponse(document({ token_endpoint_auth_method: 'client_secret_basic' })),
    jsonResponse(document({ token_endpoint_auth_method: 'private_key_jwt' })),
    jsonResponse(document({ client_secret: 'present' })),
  ];
  try {
    for (const response of cases) {
      assert.equal(await resolveMetadataClient(CLIENT, async () => response), null);
    }
    const oversized = new Response(new Uint8Array(32 * 1024 + 1), {
      status: 200, headers: { 'content-type': 'application/json' },
    });
    assert.equal(await resolveMetadataClient(CLIENT, async () => oversized), null);
  } finally { restore(); }
});

test('a slow metadata response is aborted within the five second limit', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const restore = installDns('1.1.1.1');
  try {
    let settled = false;
    const pending = resolveMetadataClient(CLIENT, (_url, init) => new Promise((_resolve, reject) => {
      init.signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
    })).then(client => { settled = true; return client; });
    t.mock.timers.tick(4_999);
    await Promise.resolve();
    assert.equal(settled, false);
    t.mock.timers.tick(1);
    assert.equal(await pending, null);
  } finally { restore(); }
});

