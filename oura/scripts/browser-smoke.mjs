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
  await page.goto(`${origin}/__test/login`);
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
  await page.waitForSelector('.paywall-card');
  await healthy('free weekly report');
  await navigate('/compare');
  await page.waitForSelector('.paywall-card');
  await healthy('free compare paywall');
  await navigate('/settings');
  await page.waitForSelector('button[role="radio"]');
  console.log(await page.snapshot());
  await page.click('loc=css:button[role="radio"]:text-is("English")');
  await page.waitForFunction(async () => (await (await fetch('/api/me')).json()).localePref === 'en');
  await page.reload();
  await page.waitForFunction(() => document.documentElement.lang === 'en' && document.querySelector('h1')?.textContent === 'Settings');
  await healthy('language persisted across reload');
  await page.click('loc=css:button[role="radio"]:text-is("中文")');
  await page.waitForFunction(async () => (await (await fetch('/api/me')).json()).localePref === 'zh');
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
  console.log('PASS browser journey');
} finally {
  await page.cdp('Page.removeScriptToEvaluateOnNewDocument', { identifier: instrumentation.identifier });
}
if (!existingSpace) await task.finish({ keep: [] });
