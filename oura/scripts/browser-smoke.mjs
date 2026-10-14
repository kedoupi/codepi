// Executed by ego-browser nodejs, not plain Node.
const { default: assert } = await import('node:assert/strict');
const options = globalThis.ouraSmokeOptions || {};
const existingSpace = options.spaceId;
const task = await taskSpace(existingSpace || 'Oura browser regression');
console.log({ spaceId: task.spaceId });
const page = task.page(options.page || 'p1');
const origin = 'http://127.0.0.1:4178';
const instrumentation = await page.cdp('Page.addScriptToEvaluateOnNewDocument', {
  source: `window.__smokeFailures = [];
    window.addEventListener('error', e => { if(e.message) window.__smokeFailures.push(e.message); });
    window.addEventListener('unhandledrejection', () => window.__smokeFailures.push('Unhandled rejection'));
    const originalFetch = window.fetch;
    window.fetch = async (...args) => {
      const response = await originalFetch(...args);
      const url = new URL(response.url);
      if (url.pathname.startsWith('/api/') && !response.ok)
        window.__smokeFailures.push(url.pathname + ': HTTP ' + response.status);
      return response;
    };`,
});
async function healthy(label) {
  const result = await page.evaluate(() => ({
    errors: window.__smokeFailures || [],
    banners: [...document.querySelectorAll('.status.err')].map(el => el.textContent),
  }));
  assert.deepEqual(result.errors, [], label);
  assert.deepEqual(result.banners, [], label);
  console.log(`PASS ${label}`);
}
async function navigate(path) {
  await page.click(`loc=css:nav a[href="${path}"]`);
  await page.waitForURL(`${origin}${path}`);
}

try {
  // Journey 1: free account (no owner match, no subscription) sees paywalls.
  await page.goto(`${origin}/__test/login?free=1`);
  await page.waitForFunction(() => document.querySelector('.status')?.textContent?.includes('90'));
  // Snapshot establishes page state and actionable controls before the journey.
  console.log(await page.snapshot());
  for (const days of [30, 90]) {
    await page.click(`loc=css:.range button:text-is("${days}")`);
    await page.waitForSelector(`.range[data-on="${days}"]`);
    await page.waitForFunction(n => document.querySelector('.sub')?.textContent?.includes(String(n)), days);
    await healthy(`dashboard ${days} days`);
  }
  await navigate('/insights');
  await page.waitForSelector('.insight-lines li');
  assert.equal(await page.evaluate(() => document.querySelectorAll('.insight-lines li').length), 3);
  // Billing is disabled in the fixture, so free users see a notice, not a checkout card.
  await page.waitForFunction(() => {
    const text = document.body.textContent;
    return text.includes('完整建议需要个人账号权限') || text.includes('Full advice requires personal access');
  });
  assert.equal(await page.evaluate(() => document.querySelectorAll('.paywall-card').length), 0);
  await healthy('free weekly locked notice');
  await navigate('/compare');
  await page.waitForFunction(() => {
    const text = document.body.textContent;
    return text.includes('尚未开放完整对比') || text.includes('Full comparison is not enabled');
  });
  await healthy('free compare locked notice');
  await navigate('/settings');
  await page.waitForSelector('button[role="radio"]');
  console.log(await page.snapshot());
  await page.click('loc=css:button[role="radio"]:text-is("English")');
  await page.waitForFunction(async () => (await (await fetch('/api/me')).json()).localePref === 'en');
  await page.waitForSelector('button[role="radio"]:not([disabled])');
  await page.reload();
  await page.waitForFunction(() => document.documentElement.lang === 'en' && document.querySelector('h1')?.textContent === 'Settings');
  await healthy('language persisted across reload');
  await page.click('loc=css:button[role="radio"]:text-is("中文")');
  await page.waitForFunction(async () => (await (await fetch('/api/me')).json()).localePref === 'zh');
  await page.reload();
  await page.waitForFunction(() => document.documentElement.lang.startsWith('zh'));
  await healthy('language restored');
  await page.goto(`${origin}/__test/login?subscribed=1`);
  await page.waitForSelector('.range');
  await navigate('/insights');
  await page.waitForFunction(() => document.querySelectorAll('.insight-lines').length === 2);
  await healthy('subscribed weekly advice');
  await navigate('/compare');
  await page.waitForSelector('.compare-grid');
  console.log(await page.snapshot());
  assert.equal(await page.evaluate(() => document.querySelectorAll('.compare-grid article').length), 2);
  await healthy('week comparison');
  await page.click('loc=css:button:text-is("近 7 天 vs 近 30 天")');
  await page.waitForFunction(() => document.querySelectorAll('.compare-grid h2')[1]?.textContent === '近 30 天');
  await healthy('7 vs 30 day comparison');
  await page.reload();
  await page.waitForSelector('.compare-grid');
  await healthy('direct compare URL reload');
  await page.click('loc=css:nav button:text-is("退出")');
  await page.waitForSelector('#landing-view');
  assert.equal(await page.evaluate(async () => (await (await fetch('/api/me')).json()).authenticated), false);
  await healthy('logout returns to landing and invalidates session');

  // Journey 2: personal owner has full reports without billing UI.
  await page.goto(`${origin}/__test/login`);
  await page.waitForSelector('.range');
  await navigate('/insights');
  await page.waitForFunction(() => document.querySelectorAll('.insight-lines').length === 2);
  assert.equal(await page.evaluate(() => document.querySelectorAll('.paywall-card').length), 0);
  await healthy('owner weekly full without paywall');
  await navigate('/compare');
  await page.waitForSelector('.compare-grid');
  assert.equal(await page.evaluate(() => document.querySelectorAll('.paywall-card').length), 0);
  await healthy('owner compare without paywall');
  await navigate('/settings');
  await page.waitForFunction(() => document.body.textContent.includes('个人工作区'));
  assert.equal(await page.evaluate(() => document.querySelectorAll('.landing-btn.primary').length), 0);
  await healthy('owner settings shows personal workspace, no billing');
  await page.waitForFunction(() => document.querySelectorAll('.health-data .collection').length === 18);
  console.log(await page.snapshot({ scope: 'full_page' }));
  await page.click('loc=css:.health-data button:text-is("同步最近 7 天")');
  await page.waitForFunction(() => document.querySelector('.health-data')?.textContent.includes('同步完成。'));
  assert.equal(await page.evaluate(() => document.querySelectorAll('.health-data .error').length), 0);
  await healthy('owner syncs 18 health collections, including empty results');
  await page.goto(`${origin}/settings?sync=90`);
  await page.waitForFunction(() => document.querySelector('.health-data')?.textContent.includes('同步完成。')
    && !document.querySelector('.health-data button[disabled]'), undefined, { timeout: 60000 });
  assert.equal(await page.url(), `${origin}/settings`, 'automatic backfill flag is consumed once');
  await healthy('owner completes 90-day backfill');
  await page.cdp('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true, 'settings fits mobile viewport');
  await page.cdp('Emulation.clearDeviceMetricsOverride');
  await page.click('loc=css:nav button:text-is("退出")');
  await page.waitForSelector('#landing-view');
  await healthy('owner logout');
  console.log('PASS browser journey');
} finally {
  await page.cdp('Page.removeScriptToEvaluateOnNewDocument', { identifier: instrumentation.identifier });
}
if (!existingSpace) await task.finish({ keep: [] });
