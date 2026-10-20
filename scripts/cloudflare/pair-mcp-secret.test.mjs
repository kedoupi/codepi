import assert from 'node:assert/strict';
import test from 'node:test';
import { pairClientSecret, pairMcpSecret } from './pair-mcp-secret.mjs';
import { checkMcpHealth } from './mcp-checks.mjs';

const env = { CLOUDFLARE_ACCOUNT_ID: 'acct', CLOUDFLARE_API_TOKEN: 'synthetic-api-token' };
const version = '11111111-1111-4111-8111-111111111111';
const updated = '22222222-2222-4222-8222-222222222222';
const ok = result => Response.json({ success: true, result });

function fixture({ failAt, unready = false, undeployed = false, client = 'mcp', pairingReady = true } = {}) {
  const writes = [];
  const worker = `codepi-${client}`;
  const origin = `https://${client}.codepi.app`;
  const request = async (url, init = {}) => {
    const target = new URL(url);
    if (target.origin === origin) {
      const health = client === 'mcp'
        ? { ok: !unready, service: worker, build: 'a'.repeat(12) }
        : client === 'project'
          ? { ok: !unready, build: 'a'.repeat(12), sso_enabled: true, sso_ready: pairingReady }
          : { ok: !unready, source: 'me', sso_enabled: true, sso_ready: pairingReady };
      return Response.json(health, { status: unready ? 503 : 200 });
    }
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

test('pairing selects exactly one new client and never rotates another Auth registration', async () => {
  for (const [client, authSecret] of [
    ['project', 'SSO_CLIENT_SECRET_PROJECT'],
    ['me', 'SSO_CLIENT_SECRET_ME'],
  ]) {
    const f = fixture({ client });
    await pairClientSecret({ client, env, request: f.request });
    assert.deepEqual(f.writes.map(w => [w.script, w.name]), [
      ['codepi-auth', authSecret],
      [`codepi-${client}`, 'AUTH_CLIENT_SECRET'],
    ]);
    assert.equal(f.writes[0].text, f.writes[1].text);
    assert.ok(!f.writes.some(write => /MCP|GU|OURA|GZH|DESK/.test(write.name)));
  }
  await assert.rejects(pairClientSecret({ client: 'other', env, request: fixture().request }), /mcp, project or me/);
});

test('new clients cannot report successful pairing from local liveness alone', async () => {
  for (const client of ['project', 'me']) {
    const f = fixture({ client, pairingReady: false });
    await assert.rejects(pairClientSecret({ client, env, request: f.request }), /readiness did not pass/);
    assert.equal(f.writes.length, 2);
  }
});

test('preflight rejects undeployed versions and missing credentials before secret writes', async () => {
  const f = fixture({ undeployed: true });
  await assert.rejects(pairMcpSecret({ env, request: f.request }), /undeployed latest version/);
  assert.equal(f.writes.length, 0);
  await assert.rejects(pairMcpSecret({ env: {}, request: f.request }), /required/);
  assert.equal(f.writes.length, 0);
});

test('partial writes fail explicitly without logging provider messages, secrets or claiming rollback', async () => {
  for (const script of ['codepi-auth', 'codepi-project']) {
    const f = fixture({ failAt: script, client: 'project' });
    await assert.rejects(pairClientSecret({ client: 'project', env, request: f.request }), error => {
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
