const origin = new URL(process.argv[2] || 'https://oura.kdp.cool').origin;
// Expected build SHA for the just-deployed Worker. When provided, /api/health
// must report it; this turns the smoke check into a real deploy gate.
const expectedBuild = process.env.OURA_EXPECT_BUILD || '';
// OURA_CHECK_EDGE_BLOCK=warn downgrades "edge 403 HTML" (WAF/Bot Fight
// challenging datacenter IPs such as GitHub runners) to a warning. The Worker
// version is already pinned by the deploy step, so the gate's remaining job —
// "did the new build come up healthy" — is verified separately by the local
// strict run and by the frontend publish step that follows.
const edgeBlockMode = process.env.OURA_CHECK_EDGE_BLOCK || 'fail';
let blockedBeforeWorker = false;

async function check(path, expectedStatus = 200) {
  try {
    const response = await fetch(new URL(path, origin), {
      headers: { Accept: 'application/json' },
      redirect: 'manual',
      signal: AbortSignal.timeout(15_000),
    });
    const contentType = response.headers.get('content-type') || '';
    // A 403 HTML page is served by the edge BEFORE our Worker runs (WAF,
    // Access, or bot rules). In 'fail' mode this blocks the pipeline; in
    // 'warn' mode it is surfaced loudly but does not flip the result.
    if (response.status === 403 && contentType.includes('text/html')) {
      blockedBeforeWorker = true;
      const ok = edgeBlockMode === 'warn';
      // Record why the edge refused, so a future block can be diagnosed
      // instead of assumed: cf-mitigated identifies a challenge/block rule.
      const mitigated = response.headers.get('cf-mitigated') || 'none';
      const ray = response.headers.get('cf-ray') || 'none';
      return {
        path, ok,
        detail: `HTTP 403 HTML from edge (request never reached the Worker); cf-mitigated=${mitigated}; cf-ray=${ray}${ok ? ' [warn mode]' : ''}`,
      };
    }

    if (path === '/api/auth/oura/start') {
      const location = response.headers.get('location');
      const target = location ? new URL(location, origin) : null;
      const expectedCallback = new URL('/api/auth/oura/callback', origin).href;
      const ok = [302, 303].includes(response.status)
        && target?.origin === 'https://cloud.ouraring.com'
        && target.pathname === '/oauth/authorize'
        && Boolean(target.searchParams.get('client_id'))
        && Boolean(target.searchParams.get('state'))
        && target.searchParams.get('redirect_uri') === expectedCallback;
      // Do not print the authorize URL: it includes an OAuth state token.
      return { path, ok, detail: `HTTP ${response.status}; redirect host=${target?.hostname || 'none'}` };
    }

    const payload = contentType.includes('application/json')
      ? await response.json().catch(() => null)
      : null;
    if (path.endsWith('/.well-known/oauth-protected-resource')) {
      return { path, ok: response.status === 200 && payload?.resource === `${origin}/mcp`, detail: `HTTP ${response.status}; resource=${payload?.resource ?? 'missing'}` };
    }
    if (path.endsWith('/.well-known/oauth-authorization-server')) {
      const ok = response.status === 200 && payload?.authorization_endpoint === `${origin}/oauth/authorize`
        && payload?.registration_endpoint === `${origin}/oauth/register`;
      return { path, ok, detail: `HTTP ${response.status}; issuer=${payload?.issuer ?? 'missing'}` };
    }
    if (expectedStatus !== 200) {
      return {
        path,
        ok: response.status === expectedStatus && typeof payload?.error === 'string',
        detail: `HTTP ${response.status}; expected ${expectedStatus}; content-type=${contentType}`,
      };
    }
    const ok = response.status === 200 && (path === '/api/health'
      ? payload?.ok === true && payload?.oauthConfigured === true && payload?.allowDevLogin === false
        && typeof payload?.release === 'string'
        && (!expectedBuild || payload?.build === expectedBuild)
      : payload?.authenticated === false && payload?.oauthConfigured === true && payload?.allowDevLogin === false
        && typeof payload?.subscribed === 'boolean' && typeof payload?.stripeConfigured === 'boolean'
        && Object.hasOwn(payload, 'localePref'));
    const buildNote = path === '/api/health' ? `; build=${payload?.build ?? 'missing'}` : '';
    return { path, ok, detail: `HTTP ${response.status}; content-type=${contentType}${buildNote}` };
  } catch (error) {
    return { path, ok: false, detail: error instanceof Error ? error.message : 'Request failed' };
  }
}

/**
 * The MCP endpoint must answer an unauthenticated POST with 401 + a
 * resource_metadata challenge; that is what lets Claude/ChatGPT start OAuth.
 * GET is a 405 by design, so this probe cannot reuse the generic checker.
 */
async function checkMcp() {
  try {
    const response = await fetch(new URL('/mcp', origin), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
      redirect: 'manual',
      signal: AbortSignal.timeout(15_000),
    });
    const contentType = response.headers.get('content-type') || '';
    if (response.status === 403 && contentType.includes('text/html')) {
      blockedBeforeWorker = true;
      const ok = edgeBlockMode === 'warn';
      return { path: '/mcp', ok, detail: `HTTP 403 HTML from edge (request never reached the Worker)${ok ? ' [warn mode]' : ''}` };
    }
    const challenge = response.headers.get('www-authenticate') || '';
    const ok = response.status === 401 && /resource_metadata=/.test(challenge);
    return { path: '/mcp', ok, detail: `HTTP ${response.status}; WWW-Authenticate=${challenge ? 'present' : 'missing'}` };
  } catch (error) {
    return { path: '/mcp', ok: false, detail: error instanceof Error ? error.message : 'Request failed' };
  }
}

const results = await Promise.all(
  [
    ['/api/health'],
    ['/api/me'],
    ['/api/auth/oura/start'],
    ['/api/me/daily?days=30', 401],
    ['/api/me/ai?days=7', 401],
    ['/api/me/insights/weekly', 401],
    ['/api/me/insights/compare?mode=week', 401],
    ['/api/me/insights/compare?mode=range', 401],
    ['/api/me/prefs', 405],
    ['/.well-known/oauth-protected-resource'],
    ['/.well-known/oauth-authorization-server'],
  ].map(([path, status]) => check(path, status)),
);
results.push(await checkMcp());
for (const result of results) {
  console.log(`${result.ok ? 'PASS' : 'FAIL'} ${result.path}: ${result.detail}`);
}
const allOk = results.every((result) => result.ok);
if (blockedBeforeWorker) {
  const level = edgeBlockMode === 'warn' ? 'WARN' : 'FAIL';
  console[level === 'WARN' ? 'warn' : 'error'](
    `${level}: edge returned 403 HTML before the Worker (likely WAF/Bot Fight on this client IP). `
    + 'The deployment itself is pinned by the version step; verify the contract from an allowed network.',
  );
}
process.exitCode = allOk ? 0 : 1;
