import assert from 'node:assert/strict';
import test from 'node:test';
import { pairMcpSecret } from './pair-mcp-secret.mjs';
import { checkMcpHealth } from './mcp-checks.mjs';

const env = { CLOUDFLARE_ACCOUNT_ID: 'acct', CLOUDFLARE_API_TOKEN: 'synthetic-api-token' };
const version = '11111111-1111-4111-8111-111111111111';
const updated = '22222222-2222-4222-8222-222222222222';
const ok = result => Response.json({ success: true, result });

function fixture({ failAt, unready = false, undeployed = false } = {}) {
  const writes = [];
  const request = async (url, init = {}) => {
    const target = new URL(url);
    if (target.hostname === 'mcp.codepi.app') return Response.json({
      ok: !unready, service: 'codepi-mcp', build: 'a'.repeat(12),
    }, { status: unready ? 503 : 200 });
    const script = target.pathname.match(/scripts\/([^/]+)/)[1];
    if (target.pathname.endsWith('/deployments')) return ok({ deployments: [{ versions: [
      { version_id: writes.some(w => w.script === script) ? updated : version, percentage: 100 },
    ] }] });
    if (target.pathname.endsWith('/versions')) return ok({ items: [{ id: undeployed ? updated : version }] });
    assert.equal(init.method, 'PUT');
    assert.equal(target.pathname.endsWith('/secrets'), true);
    const body = JSON.parse(init.body);
    writes.push({ script, ...body });
    return script === failAt
      ? Response.json({ success: false, errors: [{ message: `PRIVATE ${body.text}` }] }, { status: 403 })
      : ok({ name: body.name, type: 'secret_text' });
  };
  return { request, writes };
}

test('pairing generates one value, touches only two named secrets, and verifies runtime readiness', async () => {
  const f = fixture();
  const result = await pairMcpSecret({ env, request: f.request });
  assert.deepEqual(f.writes.map(w => [w.script, w.name, w.type]), [
    ['codepi-auth', 'SSO_CLIENT_SECRET_MCP', 'secret_text'], ['codepi-mcp', 'AUTH_CLIENT_SECRET', 'secret_text'],
  ]);
  assert.match(f.writes[0].text, /^[a-zA-Z0-9_-]{43}$/);
  assert.equal(f.writes[0].text, f.writes[1].text);
  assert.equal(result.paired, true);
  assert.equal(result.after['codepi-mcp'], updated);
  assert.ok(!JSON.stringify(result).includes(f.writes[0].text));
});

test('preflight rejects undeployed versions and missing credentials before secret writes', async () => {
  const f = fixture({ undeployed: true });
  await assert.rejects(pairMcpSecret({ env, request: f.request }), /undeployed latest version/);
  assert.equal(f.writes.length, 0);
  await assert.rejects(pairMcpSecret({ env: {}, request: f.request }), /required/);
  assert.equal(f.writes.length, 0);
});

test('partial writes fail explicitly without logging provider messages, secrets or claiming rollback', async () => {
  for (const script of ['codepi-auth', 'codepi-mcp']) {
    const f = fixture({ failAt: script });
    await assert.rejects(pairMcpSecret({ env, request: f.request }), error => {
      assert.match(error.message, /incomplete or uncertain/);
      assert.match(error.message, /BOTH Workers/);
      assert.doesNotMatch(error.message, /PRIVATE|synthetic-api-token/);
      assert.ok(!error.message.includes(f.writes[0].text));
      return true;
    });
    assert.equal(f.writes.length, script === 'codepi-auth' ? 1 : 2);
  }
});

test('two successful writes are insufficient when the live pair still returns 503', async () => {
  const f = fixture({ unready: true });
  await assert.rejects(pairMcpSecret({ env, request: f.request }), /Both secret writes completed.*readiness/);
  assert.equal(f.writes.length, 2);
});

test('MCP readiness requires ok, identity and build, rather than just HTTP 200', async () => {
  for (const body of [
    { ok: false, service: 'codepi-mcp', build: 'a'.repeat(12) },
    { ok: true, service: 'wrong', build: 'a'.repeat(12) },
    { ok: true, service: 'codepi-mcp', build: 'local' },
  ]) await assert.rejects(checkMcpHealth({ request: async () => Response.json(body) }));
  await assert.rejects(checkMcpHealth({ expectedBuild: 'b'.repeat(12), request: fixture().request }), /differs/);
});
