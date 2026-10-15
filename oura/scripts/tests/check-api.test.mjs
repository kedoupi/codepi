import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

const script = fileURLToPath(new URL('../check-api.mjs', import.meta.url));
// The deployed Worker was configured with the public hostname, so the mock
// always advertises it no matter which hostname answers the probe.
const PUBLIC_ORIGIN = 'https://oura.kdp.cool';
const SCOPES = 'heartrate workout tag session spo2 heart_health';

/** Minimal stand-in for the Worker + zone edge. */
async function listen(handler) {
  const server = createServer(handler);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  return {
    origin: `http://127.0.0.1:${port}`,
    // The probe uses keep-alive, so plain close() would wait on idle sockets.
    close: () => new Promise(resolve => {
      server.closeAllConnections();
      server.close(resolve);
    }),
  };
}

function json(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json' }).end(JSON.stringify(body));
}

/** A healthy Worker: every path the contract probes answers correctly. */
async function healthyWorker() {
  return listen((req, res) => {
    const url = new URL(req.url, `http://${req.headers.host}`);
    // The script probes each origin in turn; the mock reflects its own origin
    // in discovery documents, exactly like the Worker derives issuer(request).
    const selfOrigin = `http://${req.headers.host}`;
    if (url.pathname === '/api/health') {
      return json(res, 200, { ok: true, oauthConfigured: true, allowDevLogin: false, release: 'test-release', build: process.env.OURA_EXPECT_BUILD || 'local' });
    }
    if (url.pathname === '/api/me') {
      return json(res, 200, { authenticated: false, oauthConfigured: true, allowDevLogin: false, localePref: null, capabilities: { personal: false, weeklyFull: false, compare: false } });
    }
    if (url.pathname === '/api/auth/oura/start') {
      const target = new URL('https://cloud.ouraring.com/oauth/authorize');
      target.searchParams.set('client_id', 'test-client');
      target.searchParams.set('state', 'state');
      target.searchParams.set('scope', SCOPES);
      target.searchParams.set('redirect_uri', `${PUBLIC_ORIGIN}/api/auth/oura/callback`);
      res.writeHead(302, { Location: target.href }).end();
      return;
    }
    if (url.pathname === '/api/me/prefs') return json(res, 405, { error: 'method not allowed' });
    if (url.pathname === '/mcp') {
      res.writeHead(401, { 'Content-Type': 'application/json', 'WWW-Authenticate': `Bearer resource_metadata="${selfOrigin}/.well-known/oauth-protected-resource"` }).end(JSON.stringify({ error: 'unauthorized' }));
      return;
    }
    if (url.pathname === '/.well-known/oauth-protected-resource') return json(res, 200, { resource: `${selfOrigin}/mcp` });
    if (url.pathname === '/.well-known/oauth-authorization-server') {
      return json(res, 200, { authorization_endpoint: `${selfOrigin}/oauth/authorize`, registration_endpoint: `${selfOrigin}/oauth/register` });
    }
    return json(res, 401, { error: 'unauthorized' });
  });
}

/** The zone edge challenging this client: 403 HTML before the Worker runs. */
async function blockingEdge() {
  return listen((_req, res) => {
    res.writeHead(403, { 'Content-Type': 'text/html', 'cf-mitigated': 'challenge' }).end('<html>blocked</html>');
  });
}

function runCheck(origin, env = {}) {
  // Deliberately not spawnSync: the mock Worker runs in this process, and
  // blocking the event loop would deadlock the child's own requests.
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [script, origin], {
      env: {
        ...process.env, OURA_EXPECT_BUILD: '', OURA_CHECK_ALT_ORIGIN: '', OURA_CHECK_EDGE_BLOCK: '',
        // A contract failure must not turn into a real 60s retry loop in tests.
        OURA_CHECK_HEALTH_TIMEOUT_MS: '200',
        // The mock Worker advertises this hostname as its configured callback,
        // like the deployed Worker does with OURA_REDIRECT_URI.
        OURA_CHECK_PUBLIC_ORIGIN: PUBLIC_ORIGIN,
        ...env,
      },
    });
    let output = '';
    child.stdout.on('data', chunk => { output += chunk; });
    child.stderr.on('data', chunk => { output += chunk; });
    child.on('error', reject);
    child.on('close', status => resolve({ status, output }));
  });
}

test('a reachable Worker passes the contract in strict mode', async t => {
  const worker = await healthyWorker();
  t.after(() => worker.close());
  const run = await runCheck(worker.origin);
  assert.equal(run.status, 0, run.output);
  assert.match(run.output, /PASS \/api\/me/);
  assert.match(run.output, /PASS \/mcp/);
});

test('strict mode fails when the edge answers instead of the Worker', async t => {
  const edge = await blockingEdge();
  t.after(() => edge.close());
  const run = await runCheck(edge.origin);
  assert.equal(run.status, 1);
  assert.match(run.output, /403 HTML from edge/);
});

test('warn mode without a fallback hostname fails closed', async t => {
  const edge = await blockingEdge();
  t.after(() => edge.close());
  const run = await runCheck(edge.origin, { OURA_CHECK_EDGE_BLOCK: 'warn' });
  assert.equal(run.status, 1, run.output);
  assert.match(run.output, /FAIL edge-block-fallback: .*NOT verified/);
});

test('warn mode verifies the same Worker on the fallback hostname', async t => {
  const edge = await blockingEdge();
  const worker = await healthyWorker();
  t.after(() => Promise.all([edge.close(), worker.close()]));
  const run = await runCheck(edge.origin, { OURA_CHECK_EDGE_BLOCK: 'warn', OURA_CHECK_ALT_ORIGIN: worker.origin });
  assert.equal(run.status, 0, run.output);
  assert.match(run.output, new RegExp(`PASS /api/me \\[${worker.origin}\\]`));
  assert.match(run.output, /WARN: edge returned 403 HTML/);
});

test('warn mode fails when the fallback hostname is also challenged', async t => {
  const edge = await blockingEdge();
  const fallback = await blockingEdge();
  t.after(() => Promise.all([edge.close(), fallback.close()]));
  const run = await runCheck(edge.origin, { OURA_CHECK_EDGE_BLOCK: 'warn', OURA_CHECK_ALT_ORIGIN: fallback.origin });
  assert.equal(run.status, 1, run.output);
  assert.match(run.output, /FAIL edge-block-fallback: .*fallback hostname also returned an edge challenge/);
});

test('a fallback hostname serving the wrong build still fails the gate', async t => {
  const edge = await blockingEdge();
  const worker = await healthyWorker();
  t.after(() => Promise.all([edge.close(), worker.close()]));
  const run = await runCheck(edge.origin, {
    OURA_CHECK_EDGE_BLOCK: 'warn',
    OURA_CHECK_ALT_ORIGIN: worker.origin,
    OURA_EXPECT_BUILD: 'deadbeef1234',
  });
  assert.equal(run.status, 1, run.output);
  assert.match(run.output, /FAIL \/api\/health/);
});

test('a broken contract on a healthy host fails with or without a fallback', async t => {
  const broken = await listen((_req, res) => json(res, 200, { authenticated: true }));
  t.after(() => broken.close());
  const run = await runCheck(broken.origin);
  assert.equal(run.status, 1);
  assert.match(run.output, /FAIL \/api\/me/);
});
