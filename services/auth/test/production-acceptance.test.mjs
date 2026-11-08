import assert from 'node:assert/strict';
import { test } from 'node:test';
import { authOrigin, clients, verifyProduction } from '../scripts/verify-production.mjs';

function cookie(name, value, maxAge = 3600) {
  return `${name}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}; Secure`;
}

test('production SSO acceptance covers all current clients and global logout without live side effects', async t => {
  const originalMailKey = process.env.RESEND_API_KEY;
  process.env.RESEND_API_KEY = 'synthetic-mail-key';
  t.after(() => {
    if (originalMailKey === undefined) delete process.env.RESEND_API_KEY;
    else process.env.RESEND_API_KEY = originalMailKey;
  });
  const requests = [], sent = [], center = { active: false };
  let delivered = false;
  const response = (status, body, headers = {}) => new Response(body, { status, headers });
  const fetchImpl = async (input, init = {}) => {
    const url = new URL(input), requestCookies = new Map((init.headers?.Cookie ?? '').split('; ').filter(Boolean)
      .map(value => value.split('=')));
    requests.push({ url: url.href, method: init.method ?? 'GET' });
    if (url.origin === 'https://api.resend.com') {
      assert.equal(init.headers.Authorization, 'Bearer synthetic-mail-key');
      if (url.pathname === '/emails/synthetic-message') {
        return Response.json({ text: '验证码是 123456', html: 'kedoupi（codepi）：验证码是 123456', from: 'kedoupi（codepi）' });
      }
      if (sent.length && !delivered) {
        delivered = true;
        return Response.json({ data: [] });
      }
      return Response.json({ data: sent });
    }
    if (url.origin === authOrigin) {
      if (url.pathname === '/authorize') {
        const id = url.searchParams.get('client_id');
        assert.ok(clients[id]);
        assert.equal(url.searchParams.get('redirect_uri'), clients[id].origin + '/api/auth/callback');
        if (!center.active) return response(200, '<form id="send"></form>');
        return response(302, null, { Location: `${clients[id].origin}/api/auth/callback?code=synthetic-${id}` });
      }
      if (url.pathname === '/api/auth/request-otp') {
        sent.push({ id: 'synthetic-message', subject: 'kedoupi（codepi） 登录验证码', to: ['owner@example.invalid'] });
        return Response.json({ ok: true });
      }
      if (url.pathname === '/api/auth/verify-otp') {
        assert.deepEqual(JSON.parse(init.body), { code: '123456' });
        center.active = true;
        return Response.json({ redirect: clients.gu.origin + '/api/auth/callback?code=synthetic-gu' }, {
          headers: { 'Set-Cookie': cookie('kdp_center', 'synthetic-center') },
        });
      }
    }
    const client = Object.entries(clients).find(([, value]) => value.origin === url.origin);
    assert.ok(client, `unexpected origin ${url.origin}`);
    const [id, config] = client;
    if (url.pathname === '/api/auth/login') {
      return response(302, null, { Location: `${authOrigin}/authorize?client_id=${id}&redirect_uri=${encodeURIComponent(config.origin + '/api/auth/callback')}` });
    }
    if (url.pathname === '/api/auth/callback') {
      assert.equal(url.searchParams.get('code'), `synthetic-${id}`);
      assert.equal(center.active, true);
      return response(303, null, { 'Set-Cookie': cookie(`kdp_${id}_session`, `synthetic-${id}`) });
    }
    if (url.pathname === '/api/auth/logout') {
      assert.equal(init.method, 'POST');
      assert.equal(init.headers.Origin, config.origin);
      center.active = false;
      return Response.json({ ok: true });
    }
    if (url.pathname === config.me) {
      const authenticated = center.active && requestCookies.get(`kdp_${id}_session`) === `synthetic-${id}`;
      if (id === 'mcp') return authenticated ? response(200, '<h1>connections</h1>')
        : response(302, null, { Location: '/api/auth/login?return=%2Fconnections' });
      return Response.json(authenticated
        ? { authenticated: true, ...(id === 'oura' ? { source: 'sso' } : {}) }
        : { authenticated: false }, { status: authenticated ? 200 : 401 });
    }
    throw Error(`Unexpected request ${url.href}`);
  };
  const output = [];
  await verifyProduction({
    owner: 'owner@example.invalid', fetchImpl, sleep: async () => {}, log: line => output.push(line),
  });
  assert.deepEqual(Object.keys(clients), ['gu', 'oura', 'desk', 'mcp', 'project', 'me']);
  assert.equal(requests.filter(request => new URL(request.url).pathname === '/api/auth/request-otp').length, 1);
  assert.equal(requests.filter(request => new URL(request.url).pathname === '/api/auth/verify-otp').length, 1);
  for (const id of Object.keys(clients)) {
    assert.ok(requests.some(request => new URL(request.url).href === clients[id].origin + '/api/auth/callback?code=synthetic-' + id));
    assert.ok(output.includes(`PASS ${id}: global logout observed`));
  }
  assert.equal(output.at(-1), 'PRODUCTION_SSO_VERIFIED: one real OTP, all six current clients, global logout');
});
