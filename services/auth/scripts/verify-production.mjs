// Explicit production acceptance test: sends ONE OTP to the configured owner.
// Credentials, OTPs, cookies, callback URLs and business payloads stay in memory.
import assert from 'node:assert/strict';
import { createInterface } from 'node:readline/promises';
import { pathToFileURL } from 'node:url';

export const authOrigin = 'https://auth.codepi.app';
export const clients = {
  gu: { origin: 'https://gu.codepi.app', me: '/api/me' },
  oura: { origin: 'https://health.codepi.app', me: '/api/me' },
  desk: { origin: 'https://codepi.app', me: '/api/desk/me' },
  mcp: { origin: 'https://mcp.codepi.app', me: '/connections' },
  project: { origin: 'https://project.codepi.app', me: '/api/me' },
  me: { origin: 'https://me.codepi.app', me: '/api/me' },
};

export async function verifyProduction({
  owner,
  fetchImpl = fetch,
  pauseAfterGu = false,
  prompt = async () => {
    const input = createInterface({ input: process.stdin, output: process.stdout });
    try { await input.question('GU_VERIFIED: deploy the remaining apps, then press Enter to continue.\n'); }
    finally { input.close(); }
  },
  sleep = ms => new Promise(resolve => setTimeout(resolve, ms)),
  log = console.log,
} = {}) {
  if (!owner || !process.env.RESEND_API_KEY) throw Error('Owner/mail test configuration unavailable');
  const jars = new Map();
  async function request(url, data) {
  const u = new URL(url), jar = jars.get(u.origin) || new Map();
  jars.set(u.origin, jar);
  const res = await fetchImpl(url, {
    method: data === undefined ? 'GET' : 'POST', redirect: 'manual', signal: AbortSignal.timeout(20000),
    headers: { Cookie: [...jar].map(([k, v]) => `${k}=${v}`).join('; '),
      ...(data === undefined ? {} : { Origin: u.origin, 'Content-Type': 'application/json' }) },
    ...(data === undefined ? {} : { body: JSON.stringify(data) }),
  });
  for (const line of res.headers.getSetCookie()) {
    const pair = line.split(';')[0], pos = pair.indexOf('='), name = pair.slice(0, pos), value = pair.slice(pos + 1);
    if (name.includes('kdp_')) {
      assert.ok(/;\s*Secure/i.test(line) && /;\s*HttpOnly/i.test(line), 'Production cookie security');
      assert.ok(!/;\s*Domain=/i.test(line), 'Production cookies must be host-only');
    }
    if (/Max-Age=0(?:;|$)/i.test(line)) jar.delete(name);
    else jar.set(name, value);
  }
  return res;
  }
  async function mail(path) {
    const res = await fetchImpl('https://api.resend.com' + path, {
      headers: { Authorization: 'Bearer ' + process.env.RESEND_API_KEY },
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) throw Error('Mail verification access failed: HTTP ' + res.status);
    return res.json();
  }
  async function begin(id) {
    const response = await request(clients[id].origin + '/api/auth/login');
    assert.equal(response.status, 302, id + ' login starts');
    const location = new URL(response.headers.get('Location'));
    assert.equal(location.origin, authOrigin);
    return request(location.href);
  }
  async function callback(id, url) {
    assert.equal(new URL(url).origin, clients[id].origin);
    const res = await request(url);
    assert.equal(res.status, 303, id + ' code exchange');
    const me = await request(clients[id].origin + clients[id].me);
    assert.equal(me.status, 200, id + ' authenticated identity endpoint');
    if (id !== 'mcp') {
      const data = await me.json();
      assert.ok(data.authenticated === true || data.account, id + ' authenticated identity');
      if (id === 'oura') assert.equal(data.source, 'sso');
    }
    log('PASS ' + id + ': production callback, secure cookies and authenticated identity endpoint');
  }
  let loggedIn = false;
  try {
    const first = await begin('gu');
    assert.equal(first.status, 200, 'Fresh browser sees login form');
    assert.match(await first.text(), /id="send"/);
    const prior = new Set((await mail('/emails?limit=20')).data.map(v => v.id));
    const sent = await request(authOrigin + '/api/auth/request-otp', {});
    assert.equal(sent.status, 200, 'Production OTP send');
    const sendData = await sent.json();
    assert.equal(sendData.dev_otp, undefined, 'Production must never disclose OTP');
    let message;
    for (let attempt = 0; attempt < 8; attempt++) {
      const items = (await mail('/emails?limit=20')).data;
      message = items.find(item => !prior.has(item.id) && item.subject === 'kedoupi（codepi） 登录验证码'
        && (Array.isArray(item.to) ? item.to : [item.to]).includes(owner));
      if (message) break;
      await sleep(1000);
    }
    assert.ok(message, 'New owner OTP email exists');
    const detail = await mail('/emails/' + message.id);
    const code = detail.text?.match(/验证码是\s*(\d{6})/)?.[1];
    assert.ok(code, 'OTP present in sent mail');
    assert.ok(detail.html?.includes(code), 'HTML and text contain the same OTP');
    assert.ok(detail.html?.includes('kedoupi（codepi）'), 'Shared brand in actual sent HTML');
    assert.ok(detail.from?.includes('kedoupi（codepi）'), 'Branded sender in actual mail');
    log('PASS mail: branded sender, HTML and text alternatives, matching OTP');
    const verified = await request(authOrigin + '/api/auth/verify-otp', { code });
    assert.equal(verified.status, 200, 'Actual production OTP verification');
    await callback('gu', (await verified.json()).redirect);
    loggedIn = true;
    if (pauseAfterGu) await prompt();
    for (const id of Object.keys(clients).filter(id => id !== 'gu')) {
      const authorization = await begin(id);
      assert.equal(authorization.status, 302, id + ' reuses center session without another OTP');
      await callback(id, authorization.headers.get('Location'));
    }
    const logout = await request(clients.gu.origin + '/api/auth/logout', {});
    assert.equal(logout.status, 200);
    for (const [id, client] of Object.entries(clients)) {
      const res = await request(client.origin + client.me);
      if (id === 'mcp') {
        assert.equal(res.status, 302, 'mcp revoked management session redirects to login');
        assert.equal(new URL(res.headers.get('Location'), client.origin).pathname, '/api/auth/login');
      } else {
        const data = await res.json();
        assert.ok(res.status === 401 || data.authenticated === false, id + ' must reject revoked session');
      }
      log('PASS ' + id + ': global logout observed');
    }
    const revokedCenter = await begin('oura');
    assert.equal(revokedCenter.status, 200);
    assert.match(await revokedCenter.text(), /id="send"/);
    log('PASS center: revoked cookie cannot silently create a new client session');
    loggedIn = false;
    log('PRODUCTION_SSO_VERIFIED: one real OTP, all six current clients, global logout');
  } finally {
    if (loggedIn) {
      const cleanup = await request(clients.gu.origin + '/api/auth/logout', {});
      if (!cleanup.ok) console.error('Test session cleanup needs retry');
    }
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await verifyProduction({
    owner: process.env.AUTH_ACCEPTANCE_OWNER_EMAIL,
    pauseAfterGu: process.argv.includes('--pause-after-gu'),
  });
}
