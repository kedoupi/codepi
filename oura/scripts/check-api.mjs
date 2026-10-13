const origin = new URL(process.argv[2] || 'https://oura.kdp.cool').origin;
// Expected build SHA for the just-deployed Worker. When provided, /api/health
// must report it; this turns the smoke check into a real deploy gate.
const expectedBuild = process.env.OURA_EXPECT_BUILD || '';
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
    // Access, or bot rules). That is a failed check: callers cannot reach the
    // API, so the deployment is not verified. Never count it as success.
    if (response.status === 403 && contentType.includes('text/html')) {
      blockedBeforeWorker = true;
      return { path, ok: false, detail: 'HTTP 403 HTML from edge (request never reached the Worker)' };
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
  ].map(([path, status]) => check(path, status)),
);
for (const result of results) {
  console.log(`${result.ok ? 'PASS' : 'FAIL'} ${result.path}: ${result.detail}`);
}
const allOk = results.every((result) => result.ok);
if (blockedBeforeWorker) {
  console.error('FAIL: edge returned 403 HTML before the Worker; check Cloudflare WAF/Access rules for this client, or run the check from a network that can reach the origin.');
}
process.exitCode = allOk ? 0 : 1;
