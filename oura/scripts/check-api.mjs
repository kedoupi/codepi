const origin = new URL(process.argv[2] || 'https://oura.kdp.cool').origin;
// Expected build SHA for the just-deployed Worker. When provided, /api/health
// must report it; this turns the smoke check into a real deploy gate.
const expectedBuild = process.env.OURA_EXPECT_BUILD || '';
// The zone's edge challenges datacenter IPs on this hostname (cf-mitigated:
// challenge) and the free-plan rules cannot exempt a path. The Worker is also
// reachable on its workers.dev hostname, which has no zone bot rules, so that
// hostname verifies the same Worker from a blocked vantage point.
const altOrigin = process.env.OURA_CHECK_ALT_ORIGIN
  ? new URL(process.env.OURA_CHECK_ALT_ORIGIN).origin
  : '';
// OURA_CHECK_EDGE_BLOCK=warn downgrades "edge 403 HTML" (WAF/Bot Fight
// challenging datacenter IPs such as GitHub runners) to a warning. It is NOT a
// free pass: once the edge blocks this client, the whole contract has to pass
// on OURA_CHECK_ALT_ORIGIN, otherwise the run fails — nothing would have been
// verified at all.
const edgeBlockMode = process.env.OURA_CHECK_EDGE_BLOCK || 'fail';
// OAuth redirect_uri stays pinned to the deployed public hostname even when the
// fallback hostname answers the probe: that is the value the Worker was given.
// A deployment whose Worker is configured with another public hostname can pin
// it explicitly instead of relying on this default.
const callbackOrigin = process.env.OURA_CHECK_PUBLIC_ORIGIN
  ? new URL(process.env.OURA_CHECK_PUBLIC_ORIGIN).origin
  : origin;
const authOrigin = new URL(process.env.OURA_CHECK_AUTH_ORIGIN || 'https://auth.kdp.cool').origin;

async function check(targetOrigin, path, expectedStatus = 200, blocked, ssoEnabled = false) {
  try {
    const response = await fetch(new URL(path, targetOrigin), {
      headers: { Accept: 'application/json' },
      redirect: 'manual',
      signal: AbortSignal.timeout(15_000),
    });
    const contentType = response.headers.get('content-type') || '';
    // A 403 HTML page is served by the edge BEFORE our Worker runs (WAF,
    // Access, or bot rules). In 'fail' mode this blocks the pipeline; in
    // 'warn' mode the contract is re-verified on the fallback hostname.
    if (response.status === 403 && contentType.includes('text/html')) {
      blocked.seen = true;
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

    if (path === '/api/auth/oura/start' && ssoEnabled) {
      const payload = await response.json().catch(() => null);
      return { path, ok: response.status === 401 && payload?.error === 'unauthorized',
        detail: `HTTP ${response.status}; provider connection requires website login` };
    }
    if (path === '/api/auth/login' && ssoEnabled) {
      const location = response.headers.get('location');
      const target = location ? new URL(location, targetOrigin) : null;
      const ok = response.status === 302 && target?.origin === authOrigin
        && target.pathname === '/authorize' && target.searchParams.get('client_id') === 'oura'
        && target.searchParams.get('code_challenge_method') === 'S256'
        && Boolean(target.searchParams.get('code_challenge')) && Boolean(target.searchParams.get('state'))
        && target.searchParams.get('redirect_uri') === `${targetOrigin}/api/auth/callback`;
      return { path, ok, detail: `HTTP ${response.status}; SSO redirect host=${target?.hostname || 'none'}` };
    }
    if (path === '/api/auth/oura/start' || path === '/api/auth/login') {
      const location = response.headers.get('location');
      const target = location ? new URL(location, targetOrigin) : null;
      const expectedCallback = new URL('/api/auth/oura/callback', callbackOrigin).href;
      const ok = [302, 303].includes(response.status)
        && target?.origin === 'https://cloud.ouraring.com'
        && target.pathname === '/oauth/authorize'
        && Boolean(target.searchParams.get('client_id'))
        && Boolean(target.searchParams.get('state'))
        && ['heartrate', 'workout', 'tag', 'session', 'spo2', 'heart_health'].every(scope =>
          target.searchParams.get('scope')?.split(' ').includes(scope))
        && target.searchParams.get('redirect_uri') === expectedCallback;
      // Do not print the authorize URL: it includes an OAuth state token.
      return { path, ok, detail: `HTTP ${response.status}; redirect host=${target?.hostname || 'none'}` };
    }

    const payload = contentType.includes('application/json')
      ? await response.json().catch(() => null)
      : null;
    if (path.endsWith('/.well-known/oauth-protected-resource')) {
      return { path, ok: response.status === 200 && payload?.resource === `${targetOrigin}/mcp`, detail: `HTTP ${response.status}; resource=${payload?.resource ?? 'missing'}` };
    }
    if (path.endsWith('/.well-known/oauth-authorization-server')) {
      const ok = response.status === 200 && payload?.authorization_endpoint === `${targetOrigin}/oauth/authorize`
        && payload?.registration_endpoint === `${targetOrigin}/oauth/register`;
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
        && payload?.capabilities?.personal === false && payload?.capabilities?.weeklyFull === false
        && (!ssoEnabled || (payload?.ssoEnabled === true && payload?.websiteAccount === null && payload?.ouraConnection === null))
        && Object.hasOwn(payload, 'localePref'));
    const buildNote = path === '/api/health' ? `; build=${payload?.build ?? 'missing'}` : '';
    return { path, ok, ssoEnabled: payload?.ssoEnabled === true, detail: `HTTP ${response.status}; content-type=${contentType}${buildNote}` };
  } catch (error) {
    return { path, ok: false, detail: error instanceof Error ? error.message : 'Request failed' };
  }
}

/**
 * The MCP endpoint must answer an unauthenticated POST with 401 + a
 * resource_metadata challenge; that is what lets Claude/ChatGPT start OAuth.
 * GET is a 405 by design, so this probe cannot reuse the generic checker.
 */
async function checkMcp(targetOrigin, blocked) {
  try {
    const response = await fetch(new URL('/mcp', targetOrigin), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
      redirect: 'manual',
      signal: AbortSignal.timeout(15_000),
    });
    const contentType = response.headers.get('content-type') || '';
    if (response.status === 403 && contentType.includes('text/html')) {
      blocked.seen = true;
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

const CONTRACT = [
  ['/api/me'],
  ['/api/auth/oura/start'],
  ['/api/auth/login'],
  ['/api/me/daily?days=30', 401],
  ['/api/me/ai?days=7', 401],
  ['/api/me/insights/weekly', 401],
  ['/api/me/insights/compare?mode=week', 401],
  ['/api/me/insights/compare?mode=range', 401],
  ['/api/me/prefs', 405],
  ['/api/me/health-records/status', 401],
  ['/api/me/health-records/automatic', 401],
  ['/api/me/health-records?collection=sleep', 401],
  ['/.well-known/oauth-protected-resource'],
  ['/.well-known/oauth-authorization-server'],
];

/**
 * Runs the whole contract against one hostname. `withHealth` adds /api/health,
 * which carries the build SHA the deploy gate asserts.
 */
async function contractFor(targetOrigin, blocked, { withHealth = false } = {}) {
  const health = await check(targetOrigin, '/api/health', 200, blocked);
  const results = await Promise.all(
    CONTRACT.map(([path, status]) => check(targetOrigin, path, status, blocked, health.ssoEnabled)),
  );
  if (withHealth) results.push(health);
  results.push(await checkMcp(targetOrigin, blocked));
  return results;
}

const blocked = { seen: false };
const results = await contractFor(origin, blocked);

/**
 * A worker version switch is not instantaneous worldwide, so asserting the
 * exact build can race the deploy by a few seconds. Retry before failing.
 * A blocked request is never retried: the edge answered, the Worker did not.
 */
async function checkHealth() {
  const deadline = Date.now() + Number(process.env.OURA_CHECK_HEALTH_TIMEOUT_MS || 60_000);
  let last = await check(origin, '/api/health', 200, blocked);
  while (!last.ok && !blocked.seen && Date.now() < deadline) {
    await new Promise(resolve => setTimeout(resolve, Math.min(5_000, Math.max(0, deadline - Date.now()))));
    last = await check(origin, '/api/health', 200, blocked);
  }
  return last;
}
results.push(await checkHealth());

/**
 * Fail closed: when the edge challenged this client, "every path answered 403"
 * must never read as "everything is fine". The same Worker is verified end to
 * end on the fallback hostname, and without one the run fails.
 */
if (blocked.seen && edgeBlockMode === 'warn') {
  if (altOrigin) {
    // The build assertion matters most here: without /api/health on the
    // fallback, a blocked primary would leave the deployed version unchecked.
    const fallbackBlocked = { seen: false };
    const fallback = await contractFor(altOrigin, fallbackBlocked, { withHealth: true });
    results.push(...fallback.map(result => ({ ...result, path: `${result.path} [${altOrigin}]` })));
    if (fallbackBlocked.seen) {
      results.push({
        path: 'edge-block-fallback',
        ok: false,
        detail: 'the fallback hostname also returned an edge challenge: the API contract was NOT verified',
      });
    }
  } else {
    results.push({
      path: 'edge-block-fallback',
      ok: false,
      detail: 'the edge answered every request with 403 HTML and OURA_CHECK_ALT_ORIGIN is not set: the API contract was NOT verified',
    });
  }
}

for (const result of results) {
  console.log(`${result.ok ? 'PASS' : 'FAIL'} ${result.path}: ${result.detail}`);
}
const allOk = results.every((result) => result.ok);
if (blocked.seen) {
  const level = edgeBlockMode === 'warn' ? 'WARN' : 'FAIL';
  console[level === 'WARN' ? 'warn' : 'error'](
    `${level}: edge returned 403 HTML before the Worker (likely WAF/Bot Fight on this client IP). `
    + (altOrigin && edgeBlockMode === 'warn'
      ? `The contract above was verified on ${altOrigin} instead.`
      : 'The deployment itself is pinned by the version step; verify the contract from an allowed network.'),
  );
}
process.exitCode = allOk ? 0 : 1;
