import assert from 'node:assert/strict';
import test from 'node:test';
import { checkMcp, MCP_ORIGIN, MCP_SCOPES } from './mcp-checks.mjs';

const json = (body, status = 200) => new Response(JSON.stringify(body), {
  status, headers: { 'content-type': 'application/json' },
});

function fixture({ protectedScopes = MCP_SCOPES, authorizationScopes = MCP_SCOPES } = {}) {
  return async (url, options = {}) => {
    const target = new URL(url);
    if (target.pathname === '/api/health') {
      return json({ ok: true, service: 'codepi-mcp', build: 'a'.repeat(12) });
    }
    if (target.pathname === '/.well-known/oauth-protected-resource/mcp') {
      return json({
        resource: MCP_ORIGIN + '/mcp', authorization_servers: [MCP_ORIGIN],
        scopes_supported: protectedScopes,
      });
    }
    if (target.pathname === '/.well-known/oauth-authorization-server') {
      return json({
        issuer: MCP_ORIGIN, authorization_endpoint: MCP_ORIGIN + '/oauth/authorize',
        token_endpoint: MCP_ORIGIN + '/oauth/token', code_challenge_methods_supported: ['S256'],
        scopes_supported: authorizationScopes,
      });
    }
    if (target.pathname === '/mcp') {
      return new Response(JSON.stringify({ error: 'unauthorized' }), {
        status: 401,
        headers: {
          'content-type': 'application/json',
          'www-authenticate': `Bearer resource_metadata="${MCP_ORIGIN}/.well-known/oauth-protected-resource/mcp"`,
        },
      });
    }
    if (target.pathname === '/connections') {
      assert.equal(options.method, undefined);
      return new Response(null, { status: 302, headers: { location: '/api/auth/login?return=%2Fconnections' } });
    }
    throw new Error(`unexpected request ${target.pathname}`);
  };
}

test('MCP discovery advertises the exact ordered domain scopes on both documents', async () => {
  const results = await checkMcp({ request: fixture() });
  assert.ok(results.every(result => result.ok), JSON.stringify(results));
});

test('MCP discovery rejects reordered or incomplete scope lists', async () => {
  const reversed = [...MCP_SCOPES].reverse();
  const results = await checkMcp({
    request: fixture({ protectedScopes: reversed, authorizationScopes: MCP_SCOPES.slice(0, -1) }),
  });
  assert.equal(results.find(result => result.name === 'mcp protected-resource discovery')?.ok, false);
  assert.equal(results.find(result => result.name === 'mcp authorization-server discovery')?.ok, false);
});
