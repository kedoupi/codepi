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
  await page.waitForSelector('.today-scores article');
  assert.equal(await page.evaluate(() => document.querySelectorAll('.today-scores article').length), 3);
  await page.waitForFunction(() => document.querySelector('.sleep-preview')?.textContent.includes('近 30 天还没有保存'));
  await healthy('overview shows official scores and unsynced sleep entry');
  await navigate('/sleep');
  await page.waitForFunction(() => document.querySelector('[data-testid="sleep-empty"]')?.textContent.includes('还没有保存'));
  await healthy('sleep distinguishes unsynced archive');
  await page.evaluate(async () => { await fetch('/__test/sleep-scenario?mode=empty', { method: 'POST' }); });
  await page.reload();
  await page.waitForFunction(() => document.querySelector('[data-testid="sleep-empty"]')?.textContent.includes('此区间暂无睡眠记录'));
  await healthy('sleep distinguishes verified empty range');
  await page.evaluate(async () => { await fetch('/__test/sleep-scenario?mode=records', { method: 'POST' }); });
  await page.reload();
  await page.waitForSelector('[data-testid="sleep-detail"]');
  console.log(await page.snapshot({ scope: 'full_page' }));
  assert.equal(await page.evaluate(() => document.querySelector('[data-testid="sleep-duration"]').textContent), '8 小时 0 分');
  assert.equal(await page.evaluate(() => document.querySelectorAll('.period-picker button').length), 2);
  await page.click('loc=css:.period-picker button:text-is("短睡眠 / 小睡 14:00")');
  await page.waitForFunction(() => document.querySelector('[data-testid="sleep-duration"]')?.textContent === '0 小时 30 分');
  assert.equal(await page.evaluate(() => document.querySelector('.recovery-metrics p').textContent), '—');
  await page.click('loc=css:.sleep-controls button:text-is("30 天")');
  await page.waitForFunction(() => document.querySelector('.sleep-coverage')?.textContent.includes('58 段记录'));
  assert.equal(await page.evaluate(() => document.querySelectorAll('.sleep-bars button').length), 30);
  await page.click('loc=css:.sleep-bars button.missing');
  await page.waitForFunction(() => document.querySelector('.sleep-empty')?.textContent.includes('这一天没有保存'));
  await healthy('sleep paginates all periods and preserves missing metrics and days');
  await page.click('loc=css:.sleep-bars button:last-child');
  await page.waitForSelector('[data-testid="sleep-detail"]');
  await page.screenshot({ path: '/tmp/oura-sleep-desktop.png' });
  await page.cdp('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
  assert.equal(await page.evaluate(() => [...document.querySelectorAll('main *')].every(el => el.getBoundingClientRect().right <= innerWidth + 1)), true, 'sleep content fits mobile');
  await page.screenshot({ path: '/tmp/oura-sleep-mobile.png' });
  await navigate('/');
  await page.waitForSelector('.today-scores');
  assert.equal(await page.evaluate(() => [...document.querySelectorAll('main *')].every(el => el.getBoundingClientRect().right <= innerWidth + 1)), true, 'overview content fits mobile');
  await page.screenshot({ path: '/tmp/oura-overview-mobile.png' });
  await page.cdp('Emulation.clearDeviceMetricsOverride');
  await page.screenshot({ path: '/tmp/oura-overview-desktop.png' });
  await page.evaluate(async () => { await fetch('/__test/sleep-scenario?mode=failure', { method: 'POST' }); });
  await navigate('/sleep');
  await page.waitForFunction(() => document.querySelector('[role="alert"]')?.textContent.includes('暂时无法'));
  await page.evaluate(async () => { await fetch('/__test/sleep-scenario?mode=records', { method: 'POST' }); window.__smokeFailures = []; });
  console.log(await page.snapshot());
  await page.click('loc=css:button:text-is("重试")');
  await page.waitForSelector('[data-testid="sleep-detail"]');
  await healthy('sleep recovers from failed archive request');
  await page.evaluate(async () => { await fetch('/api/auth/logout'); });
  await page.click('loc=css:.sleep-controls button:text-is("同步此区间")');
  await page.waitForSelector('#landing-view');
  console.log('PASS sleep returns to login when session expires');
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
  await page.evaluate(async () => { await fetch('/__test/backfill-scenario', { method: 'POST' }); });
  await page.reload();
  await page.waitForSelector('.sync-issues');
  console.log(await page.snapshot({ scope: 'full_page' }));
  await page.screenshot({ path: '/tmp/oura-backfill-retry.png' });
  await page.click('loc=css:.health-data button:text-is("继续未完成部分")');
  await page.waitForFunction(() => document.querySelector('.health-data')?.textContent.includes('同步完成。')
    && !document.querySelector('.health-data button[disabled]'), undefined, { timeout: 60000 });
  const splitResult = await page.evaluate(async () => {
    const status = await (await fetch('/api/me/health-records/status')).json();
    const heart = status.collections.find(row => row.name === 'heartrate');
    const failures = window.__smokeFailures;
    window.__smokeFailures = [];
    return { heart, failures, progress: document.querySelector('.health-data progress').value };
  });
  assert.equal(splitResult.heart.records, 7);
  assert.equal(splitResult.heart.failed_windows, 0);
  assert.equal(splitResult.progress, 100);
  assert.equal(splitResult.failures.length, 6, 'seven days split into seven one-day windows after six oversized requests');
  assert.ok(splitResult.failures.every(f => f === '/api/me/health-records: HTTP 422'));
  assert.equal(await page.evaluate(() => document.querySelectorAll('.sync-issues').length), 0);
  await healthy('oversized backfill automatically splits, saves every day and clears old failures');
  await page.screenshot({ path: '/tmp/oura-backfill-desktop.png' });
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
  assert.equal(await page.evaluate(() => [...document.querySelectorAll('.health-data *')].every(el => el.getBoundingClientRect().right <= innerWidth + 1)), true, 'sync controls and messages fit mobile');
  await page.screenshot({ path: '/tmp/oura-backfill-mobile.png' });
  await page.cdp('Emulation.clearDeviceMetricsOverride');
  await page.click('loc=css:nav button:text-is("退出")');
  await page.waitForSelector('#landing-view');
  await healthy('owner logout');
  console.log('PASS browser journey');
} finally {
  await page.cdp('Page.removeScriptToEvaluateOnNewDocument', { identifier: instrumentation.identifier });
}
if (!existingSpace) await task.finish({ keep: [] });
