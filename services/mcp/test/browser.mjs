import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fixture, hash } from './runtime.mjs';
import { launchBrowser } from '../../../apps/health/scripts/browser-cdp.mjs';

const cleanup = [];
const artifacts = process.env.MCP_BROWSER_ARTIFACTS || await mkdtemp(path.join(tmpdir(), 'codepi-mcp-browser-'));
let f;
let browser;
let failure;
let callback;
let callbackReferrer;
try {
  let cookie;
  const server = createServer(async (request, response) => {
    try {
      const url = new URL(request.url, 'http://localhost');
      if (url.pathname === '/favicon.ico') { response.writeHead(204); response.end(); return; }
      const chunks = [];
      for await (const chunk of request) chunks.push(chunk);
      const headers = new Headers(request.headers);
      headers.delete('Host');
      // Pre-authenticate only this synthetic browser fixture. The real SSO
      // adapter is covered by connector.test.mjs.
      headers.set('Cookie', cookie);
      const result = await f.at(request.url, {
        method: request.method, headers,
        ...(!['GET', 'HEAD'].includes(request.method) ? { body: Buffer.concat(chunks) } : {}),
      });
      response.writeHead(result.status, Object.fromEntries(result.headers));
      response.end(Buffer.from(await result.arrayBuffer()));
    } catch {
      response.writeHead(500);
      response.end('Synthetic fixture failed');
    }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  cleanup.push(() => new Promise(resolve => server.close(resolve)));
  const origin = `http://127.0.0.1:${server.address().port}`;
  f = await fixture({ after: fn => cleanup.push(fn) }, { origin });
  cookie = await f.login();
  // Real clients (Meta agent, Cursor) answer the OAuth callback with a redirect to
  // their own app origin. Browsers apply the consent page's CSP form-action to every
  // hop of the POST navigation, so this third origin is what exposed the bug.
  const landingServer = createServer((request, response) => {
    response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    response.end('<!doctype html><title>Synthetic client app</title><p>Connected</p>');
  });
  await new Promise(resolve => landingServer.listen(0, 'localhost', resolve));
  cleanup.push(() => new Promise(resolve => landingServer.close(resolve)));
  const landing = `http://localhost:${landingServer.address().port}/connected`;
  const callbackServer = createServer((request, response) => {
    const url = new URL(request.url, 'http://localhost');
    if (url.pathname !== '/callback') { response.writeHead(204); response.end(); return; }
    callback = url.searchParams;
    callbackReferrer = request.headers.referer;
    response.writeHead(302, { Location: landing });
    response.end();
  });
  await new Promise(resolve => callbackServer.listen(0, '127.0.0.1', resolve));
  cleanup.push(() => new Promise(resolve => callbackServer.close(resolve)));
  const redirectUri = `http://127.0.0.1:${callbackServer.address().port}/callback`;
  const registered = await f.at('/oauth/register', { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ client_name: 'Browser <client> "& with a long synthetic display name',
      redirect_uris: [redirectUri] }) });
  const client = await registered.json();
  const verifier = Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString('base64url');
  const authorize = origin + '/oauth/authorize?' + new URLSearchParams({
    client_id: client.client_id, redirect_uri: redirectUri, response_type: 'code',
    code_challenge: await hash(verifier), code_challenge_method: 'S256',
    resource: origin + '/mcp', state: 'browser-state',
  });
  browser = await launchBrowser(artifacts);
  const { page } = browser;
  await page.goto(authorize);
  assert.equal(await page.evaluate(() => document.querySelector('strong')?.textContent),
    'Browser <client> "& with a long synthetic display name');
  assert.equal(await page.evaluate(() => Boolean(document.querySelector('client'))), false, 'client names are escaped');
  assert.equal(await page.evaluate(() => document.querySelectorAll('input[name="scope"]').length), 0);
  for (const scope of f.allScopes.split(' ')) {
    assert.ok(await page.evaluate(needle => document.body.textContent.includes(needle), scope), scope);
  }
  await page.screenshot({ path: 'consent-desktop.png' });
  await page.cdp('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
  const fits = () => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth);
  assert.equal(await fits(), true);
  await page.screenshot({ path: 'consent-mobile.png' });
  await page.click('loc=css:button[value="approve"]');
  await page.waitForFunction(() => location.pathname === '/connected');
  assert.equal(callback.get('state'), 'browser-state');
  assert.ok(callback.get('code'));
  assert.equal(callbackReferrer, undefined, 'cross-origin callbacks must not receive consent URLs as referrers');
  const exchanged = await f.post('/oauth/token', { client_id: client.client_id, redirect_uri: redirectUri,
    grant_type: 'authorization_code', code_verifier: verifier, code: callback.get('code'), resource: origin + '/mcp' });
  assert.equal(exchanged.status, 200);
  const pair = await exchanged.json();
  assert.equal(pair.scope, f.allScopes);
  await page.goto(origin + '/connections');
  assert.equal(await fits(), true);
  assert.equal(await page.evaluate(() => document.querySelectorAll('form[action="/connections"]').length), 1);
  await page.screenshot({ path: 'connections-mobile.png' });
  await page.click('loc=css:form[action="/connections"] button');
  await page.waitForFunction(() => document.body.textContent.includes('还没有已授权客户端'));
  assert.equal((await f.rpc(pair.access_token, 'tools/list')).status, 401, 'browser revocation retires the client grant');
  await page.goto(authorize);
  await page.click('loc=css:button[value="deny"]');
  await page.waitForFunction(() => location.pathname === '/connected');
  assert.equal(callback.get('error'), 'access_denied');
  assert.deepEqual(page.diagnostics.filter(event => event.method === 'Runtime.exceptionThrown'
    || event.method === 'Network.loadingFailed'
    || event.method === 'Log.entryAdded' && event.params.entry.source === 'security'
    || event.method === 'Runtime.consoleAPICalled' && ['error', 'warning'].includes(event.params.type)), []);
  console.log(`MCP browser acceptance passed: desktop/mobile consent, approve, deny, management and revoke. Artifacts: ${artifacts}`);
} catch (error) {
  failure = error;
  throw error;
} finally {
  if (browser) {
    await browser.page.saveDiagnostics(failure);
    await browser.close();
  }
  for (const dispose of cleanup.reverse()) await dispose();
}
