// Explicit production acceptance test: sends ONE OTP to the configured owner.
// Credentials, OTPs, cookies, callback URLs and business payloads stay in memory.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createInterface } from 'node:readline/promises';

const owner = (await readFile(new URL('../../../apps/gu/worker/lib.ts', import.meta.url), 'utf8'))
  .match(/OWNER_EMAIL\s*=\s*"([^"]+)"/)?.[1];
if (!owner || !process.env.RESEND_API_KEY) throw Error('Owner/mail test configuration unavailable');
const origins = { gu: 'https://gu.codepi.app', gu_pages: 'https://codepi-gu.pages.dev', oura: 'https://health.codepi.app', gzh: 'https://gzh.codepi.app' };
const authOrigin = 'https://auth.codepi.app';
const jars = new Map();
async function request(url, data) {
  const u = new URL(url), jar = jars.get(u.origin) || new Map();
  jars.set(u.origin, jar);
  const res = await fetch(url, {
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
  const res = await fetch('https://api.resend.com' + path, {
    headers: { Authorization: 'Bearer ' + process.env.RESEND_API_KEY },
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) throw Error('Mail verification access failed: HTTP ' + res.status);
  return res.json();
}
async function begin(id) {
  const response = await request(origins[id] + '/api/auth/login');
  assert.equal(response.status, 302, id + ' login starts');
  const location = new URL(response.headers.get('Location'));
  assert.equal(location.origin, authOrigin);
  return request(location.href);
}
async function callback(id, url) {
  assert.equal(new URL(url).origin, origins[id]);
  const res = await request(url);
  assert.equal(res.status, 303, id + ' code exchange');
  const me = await request(origins[id] + '/api/me');
  assert.equal(me.status, 200, id + ' authenticated API');
  const data = await me.json();
  assert.ok(data.authenticated === true || data.account, id + ' authenticated identity');
  if (id === 'oura') assert.equal(data.source, 'sso');
  if (id.startsWith('gu')) {
    const dashboard = await request(origins[id] + '/api/dashboard');
    assert.equal(dashboard.status, 200, id + ' existing investment data accessible');
    const payload = await dashboard.json();
    assert.ok(payload.batch_id && Array.isArray(payload.data?.account), id + ' existing dashboard schema');
  }
  console.log('PASS ' + id + ': production callback, secure cookies and authenticated API');
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
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
  assert.ok(message, 'New owner OTP email exists');
  const detail = await mail('/emails/' + message.id);
  const code = detail.text?.match(/验证码是\s*(\d{6})/)?.[1];
  assert.ok(code, 'OTP present in sent mail');
  assert.ok(detail.html?.includes(code), 'HTML and text contain the same OTP');
  assert.ok(detail.html?.includes('kedoupi（codepi）'), 'Shared brand in actual sent HTML');
  assert.ok(detail.from?.includes('kedoupi（codepi）'), 'Branded sender in actual mail');
  console.log('PASS mail: branded sender, HTML and text alternatives, matching OTP');
  const verified = await request(authOrigin + '/api/auth/verify-otp', { code });
  assert.equal(verified.status, 200, 'Actual production OTP verification');
  await callback('gu', (await verified.json()).redirect);
  loggedIn = true;
  if (process.argv.includes('--pause-after-gu')) {
    const input = createInterface({ input: process.stdin, output: process.stdout });
    await input.question('GU_VERIFIED: deploy the remaining apps, then press Enter to continue.\n');
    input.close();
  }
  for (const id of ['gu_pages', 'oura', 'gzh']) {
    const authorization = await begin(id);
    assert.equal(authorization.status, 302, id + ' reuses center session without another OTP');
    await callback(id, authorization.headers.get('Location'));
  }
  const logout = await request(origins.gu + '/api/auth/logout', {});
  assert.equal(logout.status, 200);
  for (const id of Object.keys(origins)) {
    const res = await request(origins[id] + '/api/me');
    const data = await res.json();
    assert.ok(res.status === 401 || data.authenticated === false, id + ' must reject revoked session');
    console.log('PASS ' + id + ': global logout observed');
  }
  const revokedCenter = await begin('oura');
  assert.equal(revokedCenter.status, 200);
  assert.match(await revokedCenter.text(), /id="send"/);
  console.log('PASS center: revoked cookie cannot silently create a new client session');
  loggedIn = false;
  console.log('PRODUCTION_SSO_VERIFIED: one real OTP, GU on both domains, all three apps, global logout');
} finally {
  if (loggedIn) {
    const cleanup = await request(origins.gu + '/api/auth/logout', {});
    if (!cleanup.ok) console.error('Test session cleanup needs retry');
  }
}
