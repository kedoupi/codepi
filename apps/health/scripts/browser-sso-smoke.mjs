// Shared Chrome/ego journey; central/provider services and data are local fixtures.
const { default: assert } = await import('node:assert/strict');
const options = globalThis.ouraSmokeOptions || {};
const task = await taskSpace(options.spaceId || 'Oura SSO regression');
console.log({ spaceId: task.spaceId });
const page = task.page(options.page || 'p1');
const origin = `http://127.0.0.1:${process.env.HEALTH_BROWSER_PORT || '4178'}`;
const instrument = await page.cdp('Page.addScriptToEvaluateOnNewDocument', {
  source: `window.__ssoConsole = [];
    for (const level of ['error','warn']) {
      const original = console[level].bind(console);
      console[level] = (...args) => { window.__ssoConsole.push(args.map(String).join(' ')); original(...args); };
    }
    window.addEventListener('error', e => window.__ssoConsole.push(e.message));
    window.addEventListener('unhandledrejection', () => window.__ssoConsole.push('Unhandled rejection'));`,
});
try {
  await page.cdp('Emulation.clearDeviceMetricsOverride');
  await page.goto(`${origin}/__test/login`);
  await page.waitForFunction(() => document.querySelector('h1')?.textContent.includes('连接你的 Oura'));
  console.log(await page.snapshot());
  const initial = await page.evaluate(async () => ({
    me: await (await fetch('/api/me')).json(),
    hasCharts: Boolean(document.querySelector('.today-scores, .journal-chart')),
    hasConnect: Boolean(document.querySelector('a[href="/api/auth/oura/start"]')),
  }));
  assert.equal(initial.me.source, 'sso');
  assert.equal(initial.me.ouraConnection.status, 'disconnected');
  assert.equal(initial.hasCharts, false, 'no DEV/sample charts for an unconnected SSO owner');
  assert.equal(initial.hasConnect, true);
  await page.screenshot({ path: '/tmp/oura-sso-disconnected-desktop.png' });
  await page.cdp('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  await page.screenshot({ path: '/tmp/oura-sso-disconnected-mobile.png' });
  await page.cdp('Emulation.clearDeviceMetricsOverride');
  await page.click('loc=css:button:text-is("设置")');
  await page.waitForSelector('#account');
  assert.match(await page.evaluate(() => document.querySelector('#account').textContent), /网站账号.*test-user.*KDP SSO.*Oura：尚未连接/s);
  assert.equal(await page.evaluate(() => Boolean(document.querySelector('.health-data'))), false);
  console.log('PASS SSO disconnected shows connect, settings separates website and Oura, no DEV charts');

  await page.goto(`${origin}/api/auth/callback?error=access_denied`);
  await page.waitForSelector('.auth-feedback[role="alert"]');
  assert.match(await page.evaluate(() => document.querySelector('.auth-feedback').textContent), /登录未完成或链接已过期/);
  assert.equal(await page.evaluate(async () => (await (await fetch('/api/me')).json()).authenticated), true);
  await page.goto(`${origin}/?error=oura_account_mismatch`);
  await page.waitForSelector('.auth-feedback[role="alert"]');
  assert.match(await page.evaluate(() => document.querySelector('.auth-feedback').textContent), /Oura/);
  await page.screenshot({ path: '/tmp/oura-sso-provider-error.png' });
  await page.click('loc=css:button:text-is("设置")');
  await page.waitForSelector('#account');
  console.log('PASS callback errors stay visible for an already signed-in SSO owner');

  // A central outage at boot must retain the route and render retry, not a login gate.
  await page.evaluate(async () => { await fetch('/__test/central?unavailable=1', { method: 'POST' }); });
  await page.reload();
  await page.waitForSelector('.global-feedback[role="alert"] button');
  assert.equal(await page.evaluate(() => Boolean(document.querySelector('#landing-view'))), false);
  assert.equal(new URL(await page.url()).pathname, '/settings');
  await page.evaluate(async () => {
    await fetch('/__test/central', { method: 'POST' });
    // Browser activation can trigger focus recovery before a native click.
    document.querySelector('.global-feedback button')?.click();
  });
  await page.waitForSelector('#account');
  await page.evaluate(async () => {
    await fetch('/__test/connect', { method: 'POST' });
    window.dispatchEvent(new Event('focus'));
  });
  await page.waitForFunction(() => document.querySelector('#account')?.textContent.includes('Oura：已连接'));
  await page.click('loc=css:button:text-is("返回看板")');
  await page.waitForSelector('.today-scores');
  await page.waitForFunction(() => document.querySelector('.journal-score-body strong')?.textContent === '80');
  console.log('PASS boot 503 retries without logout; provider connection loads actual provider fixture scores');
  const original = await page.evaluate(async () => (await (await fetch('/api/me/daily?days=90')).json()).days);

  // While mounted, an auth outage preserves already visible private state.
  await page.evaluate(async () => {
    await fetch('/__test/central?unavailable=1', { method: 'POST' });
    window.dispatchEvent(new Event('focus'));
  });
  await page.waitForSelector('.global-feedback');
  assert.equal(await page.evaluate(() => Boolean(document.querySelector('.today-scores'))), true);
  await page.evaluate(async () => {
    await fetch('/__test/central', { method: 'POST' });
    window.dispatchEvent(new Event('focus'));
  });
  await page.waitForFunction(() => !document.querySelector('.global-feedback'));

  // Central revocation is discovered on focus and removes charts and sensitive state.
  await page.evaluate(async () => {
    await fetch('/__test/central?revoke=1', { method: 'POST' });
    window.dispatchEvent(new Event('focus'));
  });
  await page.waitForSelector('#landing-view');
  assert.equal(await page.evaluate(() => Boolean(document.querySelector('.today-scores, .journal-main, .health-data'))), false);
  assert.match(await page.evaluate(() => document.querySelector('.landing-btn.primary').textContent), /登录健康空间/);
  console.log('PASS focus revocation clears private workspace and immediately retains KDP login');
  await page.goto(`${origin}/__test/login`);
  await page.waitForSelector('.today-scores');
  assert.deepEqual(await page.evaluate(async () => (await (await fetch('/api/me/daily?days=90')).json()).days), original);
  await page.click('loc=css:.journal-account > summary');
  await page.click('loc=css:nav button:text-is("退出")');
  await page.waitForSelector('#landing-view');
  assert.match(await page.evaluate(() => document.querySelector('.landing-btn.primary').textContent), /登录健康空间/);
  await page.screenshot({ path: '/tmp/oura-sso-logout.png' });
  console.log('PASS logout uses POST and immediately retains KDP login; cached history survives login');

  for (const [code, message] of [['retry', '登录未完成或链接已过期'], ['unavailable', '登录服务暂时不可用']]) {
    await page.goto(`${origin}/?auth_error=${code}`);
    await page.waitForSelector('.landing-error[role="alert"]');
    assert.ok((await page.evaluate(() => document.querySelector('.landing-error').textContent)).includes(message));
    assert.match(await page.evaluate(() => document.querySelector('.landing-btn.primary').textContent), /登录健康空间/);
  }
  await page.screenshot({ path: '/tmp/oura-sso-callback-error.png' });
  console.log('PASS signed-out callback failures show safe retry/unavailable UI and KDP login');

  // Check a direct API 401 path, independently of the focus/periodic watcher.
  await page.goto(`${origin}/__test/login`);
  await page.waitForSelector('.today-scores');
  await page.waitForFunction(() => document.querySelector('.journal-sync-line button')?.disabled === false);
  await page.waitForSelector('.automatic-sync');
  await page.waitForFunction(() => [...document.querySelectorAll('.journal-hrv, .journal-sleep')]
    .every(element => element.getAttribute('aria-busy') === 'false'));
  await page.evaluate(async () => {
    const originalFetch = window.fetch;
    window.fetch = async (...args) => {
      const response = await originalFetch(...args);
      if (new URL(response.url).pathname === '/api/me/health-records/automatic'
        && args[1]?.method === 'POST' && response.status === 401) window.__directApi401 = true;
      return response;
    };
    await fetch('/__test/central?revoke=1', { method: 'POST' });
    document.querySelector('.journal-sync-line button').click();
  });
  await page.waitForSelector('#landing-view');
  assert.match(await page.evaluate(() => document.querySelector('.landing-btn.primary').textContent), /登录健康空间/);
  const final = await page.evaluate(() => ({
    meaningful: document.body.textContent.trim().length > 100,
    overlay: Boolean(document.querySelector('vite-error-overlay')),
    errors: window.__ssoConsole,
    api401: window.__directApi401 === true,
  }));
  assert.equal(final.meaningful, true);
  assert.equal(final.overlay, false);
  assert.deepEqual(final.errors, []);
  assert.equal(final.api401, true, 'the automatic update POST must receive an actual website-session 401');
  assert.equal(new URL(await page.url()).pathname, '/');
  assert.equal(await page.title(), '健康 Health · kedoupi（codepi）');
  console.log('PASS API 401 clears private state, no overlay/console failures; SSO browser journey');

  // Repair is a separate navigation journey; keep the mounted-session outage
  // and revocation checks on their original page lifecycle.
  await page.goto(`${origin}/__test/login`);
  await page.waitForSelector('.today-scores');
  await page.goto(`${origin}/settings`);
  await page.waitForSelector('.connection-repair summary');
  await page.click('loc=css:.connection-repair summary');
  const repairForm = await page.evaluate(() => {
    const form = document.querySelector('.connection-repair form');
    return { method: form.method, action: new URL(form.action).pathname, text: form.textContent };
  });
  assert.equal(repairForm.method, 'post');
  assert.equal(repairForm.action, '/api/auth/oura/start');
  assert.match(repairForm.text, /确认是原账号并重新授权/);
  await page.screenshot({ path: '/tmp/oura-sso-identity-repair-desktop.png' });
  await page.cdp('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  await page.screenshot({ path: '/tmp/oura-sso-identity-repair-mobile.png' });
  await page.cdp('Emulation.clearDeviceMetricsOverride');
  await page.waitForFunction(() => innerWidth >= 1200);
  await page.evaluate(() => new Promise(resolve =>
    requestAnimationFrame(() => requestAnimationFrame(resolve))));
  await page.evaluate(async () => { await fetch('/__test/provider-identity', { method: 'POST' }); });
  // The settings component may be rebuilt after a focus-triggered session refresh.
  await page.evaluate(() => {
    const details = document.querySelector('.connection-repair');
    if (!details) throw new Error('connection repair details are missing');
    details.open = true;
  });
  await page.click('loc=css:.connection-repair button[type="submit"]');
  await page.waitForFunction(async () => {
    const me = await (await fetch('/api/me')).json();
    return location.pathname === '/settings' && me.ouraConnection?.ouraUserId === 'replacement-provider-id';
  });
  const repaired = await page.evaluate(async () => (await fetch('/api/me')).json());
  assert.equal(repaired.userId, 'test-user');
  assert.equal(repaired.ouraConnection.status, 'connected');
  assert.deepEqual(await page.evaluate(async () => (await (await fetch('/api/me/daily?days=90')).json()).days), original);
  await page.click('loc=css:button:text-is("返回看板")');
  await page.waitForSelector('.today-scores');
  console.log('PASS explicit owner repair submits real same-origin form and preserves local owner and history');


} finally {
  await page.cdp('Page.removeScriptToEvaluateOnNewDocument', { identifier: instrument.identifier });
}
if (!options.spaceId) await task.finish({ keep: [] });
