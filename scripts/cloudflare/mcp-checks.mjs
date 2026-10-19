import assert from 'node:assert/strict';

export const MCP_ORIGIN = 'https://mcp.codepi.app';

export async function checkMcpHealth({ origin = MCP_ORIGIN, expectedBuild, request = fetch } = {}) {
  const response = await request(`${origin}/api/health`, {
    redirect: 'manual', cache: 'no-store', signal: AbortSignal.timeout(15000),
  });
  assert.equal(response.status, 200, `MCP readiness/SSO credential pair failed (HTTP ${response.status})`);
  const status = await response.json();
  assert.ok(status?.ok === true && status.service === 'codepi-mcp', 'invalid MCP health response');
  assert.ok(typeof status.build === 'string' && /^[a-f0-9]{7,40}$/.test(status.build), 'MCP health must report a source SHA');
  if (expectedBuild) assert.ok(status.build === expectedBuild, 'MCP health BUILD_SHA differs from the release');
  return status.build;
}

export async function checkMcp({ origin = MCP_ORIGIN, expectedBuild, request = fetch } = {}) {
  const results = [];
  const check = async (name, run) => {
    try { await run(); results.push({ name, ok: true }); }
    catch (error) { results.push({ name, ok: false, detail: error.message }); }
  };
  const get = (path, options = {}) => request(origin + path, {
    redirect: 'manual', cache: 'no-store', signal: AbortSignal.timeout(15000), ...options,
  });
  await check('mcp health validates the Auth credential pair', () => checkMcpHealth({ origin, expectedBuild, request }));
  await check('mcp protected-resource discovery', async () => {
    const res = await get('/.well-known/oauth-protected-resource/mcp');
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.ok(body.resource === origin + '/mcp'
      && Array.isArray(body.authorization_servers) && body.authorization_servers.includes(origin),
    'MCP resource or authorization server mismatch');
  });
  await check('mcp authorization-server discovery', async () => {
    const res = await get('/.well-known/oauth-authorization-server');
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.ok(body.issuer === origin && body.authorization_endpoint === origin + '/oauth/authorize'
      && body.token_endpoint === origin + '/oauth/token'
      && body.code_challenge_methods_supported?.includes('S256'), 'MCP OAuth discovery mismatch');
  });
  await check('mcp anonymous tools are rejected', async () => {
    const res = await get('/mcp', {
      method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
    });
    await res.body?.cancel();
    assert.equal(res.status, 401, `MCP anonymous request returned HTTP ${res.status}`);
    assert.ok(res.headers.get('www-authenticate')?.includes(`resource_metadata="${origin}/.well-known/oauth-protected-resource/mcp"`),
      'MCP challenge must reference its own protected-resource metadata');
  });
  await check('mcp connections require login', async () => {
    const res = await get('/connections');
    await res.body?.cancel();
    assert.equal(res.status, 302);
    const url = new URL(res.headers.get('location') || '/', origin);
    assert.ok(url.origin === origin && url.pathname === '/api/auth/login', 'MCP connections must redirect to local SSO entry');
  });
  return results;
}
