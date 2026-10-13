const origin = new URL(process.argv[2] || 'https://oura.kdp.cool').origin;
const allowCfAccess = process.env.OURA_CHECK_ALLOW_CF_ACCESS === '1';
let protectedByCfAccess = false;

async function check(path, expectedStatus = 200) {
  try {
    const response = await fetch(new URL(path, origin), {
      headers: { Accept: 'application/json' },
      redirect: 'manual',
      signal: AbortSignal.timeout(15_000),
    });
    const contentType = response.headers.get('content-type') || '';
    // Cloudflare Access challenges CI clients with 403 HTML. Treat it as a
    // blocked deployment check, not as an application contract failure.
    if (allowCfAccess && response.status === 403 && contentType.includes('text/html')) {
      protectedByCfAccess = true;
      return { path, ok: true, detail: 'HTTP 403; CI client is protected by Cloudflare Access' };
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
      : payload?.authenticated === false && payload?.oauthConfigured === true && payload?.allowDevLogin === false
        && typeof payload?.subscribed === 'boolean' && typeof payload?.stripeConfigured === 'boolean'
        && Object.hasOwn(payload, 'localePref'));
    return { path, ok, detail: `HTTP ${response.status}; content-type=${contentType}` };
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
if (protectedByCfAccess) {
  console.warn('WARN deployment check blocked by Cloudflare Access; verify with the logged-in browser');
}
process.exitCode = allOk ? 0 : 1;
