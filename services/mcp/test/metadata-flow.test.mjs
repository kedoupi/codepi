import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, rm, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fixture, ORIGIN, REDIRECT, hash } from './runtime.mjs';

test('HTTPS metadata client completes consent, code+PKCE, refresh and revocation without DCR', async t => {
  const clientId = 'https://agent.example/oauth/client.json';
  const dir = await mkdtemp(path.join(tmpdir(), 'codepi-metadata-flow-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const source = await readFile(new URL('../dist/index.js', import.meta.url), 'utf8');
  const stub = source.replace(
    /return typeof loaded\?\.lookup === "function" \? loaded\.lookup\.bind\(loaded\) : void 0;/,
    'return async () => [{ address: "1.1.1.1", family: 4 }];',
  );
  if (stub === source) throw new Error('metadata DNS hook was not found in the bundle');
  await writeFile(path.join(dir, 'index.js'), stub);
  const metadata = { [clientId]: { client_id: clientId, client_name: 'Metadata agent',
    redirect_uris: [REDIRECT], token_endpoint_auth_method: 'none' } };
  const f = await fixture(t, { metadata, bundle: path.join(dir, 'index.js') });
  const discovery = await (await f.at('/.well-known/oauth-authorization-server')).json();
  assert.equal(discovery.client_id_metadata_document_supported, true);
  const pending = await f.grant({ client: { client_id: clientId }, consentOnly: true });
  assert.ok(pending.html.includes(clientId));
  assert.ok(pending.html.includes(REDIRECT));
  const granted = await f.grant({ client: { client_id: clientId } });
  assert.equal((await f.rpc(granted.access_token, 'tools/list')).status, 200);
  assert.equal((await f.db.prepare('SELECT COUNT(*) n FROM oauth_clients').first()).n, 0);
  const refreshed = await f.post('/oauth/token', { grant_type: 'refresh_token', client_id: clientId,
    refresh_token: granted.refresh_token, resource: ORIGIN + '/mcp' });
  assert.equal(refreshed.status, 200);
  const pair = await refreshed.json();
  await f.post('/oauth/revoke', { client_id: clientId, token: pair.access_token });
  assert.equal((await f.rpc(pair.access_token, 'tools/list')).status, 401);
  metadata[clientId].redirect_uris = ['https://other.example/callback'];
  const bad = await f.at('/oauth/authorize?' + new URLSearchParams({ client_id: clientId, redirect_uri: REDIRECT,
    response_type: 'code', code_challenge_method: 'S256', code_challenge: await hash('x'.repeat(43)) }));
  assert.equal((await bad.json()).error, 'invalid_redirect_uri');
});
